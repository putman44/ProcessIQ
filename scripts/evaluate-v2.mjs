import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { golden } from '../eval/golden.mjs';
import { scoreLiveV2 } from '../eval/scorer-v2.mjs';
import { openInvestigation } from '../src/lib/investigation.ts';
import { investigate } from '../src/lib/investigation-agent.ts';

const mode = process.argv[2];
if (!['offline','live'].includes(mode)) throw new Error('Use offline or live');
const capture = process.argv.includes('--capture-responses');
if (capture && mode !== 'live') throw new Error('--capture-responses requires live mode');
if (mode === 'live' && !process.argv.includes('--confirm-paid')) {
  console.error('Live evaluation makes paid OpenAI requests. Run npm run eval:live -- --confirm-paid to proceed.');
  process.exit(2);
}
if (mode === 'live' && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for live evaluation');
const dbPath = resolve('data/processiq.sqlite');
const db = new DatabaseSync(dbPath, { readOnly:true });
const tools = openInvestigation(dbPath);
const failures = [];
const results = [];
const diagnostics = [];
const totals = { event_tp:0, event_expected:0, exposure_tp:0, exposure_predicted:0, exposure_expected:0, citations_valid:0, citations_total:0, unsupported_claims:0, completed:0 };
const ref = x => `${x.source_type}:${x.source_id}`;
const sorted = xs => [...xs].sort();
const same = (a,b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const table = {error:['errors','id'],maintenance:['maintenance','id'],failure:['failures','id'],synthetic_processing:['wafer_processing','processing_id'],synthetic_note:['operator_incident_notes','note_id']};
function exists(key) {
  const [type,id] = key.split(':');
  if (type === 'telemetry') {
    const match = id.match(/^(\d+):(.*)$/);
    return !!match && !!db.prepare('SELECT 1 FROM telemetry WHERE machine_id=? AND recorded_at=?').get(Number(match[1]),match[2]);
  }
  const pair = table[type];
  return !!pair && !!db.prepare(`SELECT 1 FROM ${pair[0]} WHERE ${pair[1]}=?`).get(type.startsWith('synthetic') ? id : Number(id));
}
function sourceRows(s) {
  const [start,end]=s.window;
  const types=s.kind==='failures' ? [['failures','failure']] : [['errors','error'],['maintenance','maintenance']];
  return types.flatMap(([tableName,type]) => db.prepare(`SELECT id FROM ${tableName} WHERE machine_id=? AND recorded_at>=? AND recorded_at<?`).all(s.machine,start,end).map(r=>`${type}:${r.id}`));
}
function groundTruth(s) {
  if (s.kind==='events'||s.kind==='failures') return same(sourceRows(s),s.events) ? [] : ['Golden event rows differ from SQLite'];
  if (s.kind==='history') {
    const wafer=db.prepare('SELECT lot_id FROM wafers WHERE wafer_id=?').get(s.wafer);
    const steps=db.prepare('SELECT processing_id FROM wafer_processing WHERE wafer_id=? ORDER BY process_start,processing_id').all(s.wafer).map(x=>x.processing_id);
    return (wafer?.lot_id??null)===s.lot && same(steps,s.processing) ? [] : ['Golden wafer history differs from SQLite'];
  }
  if (s.kind==='exposure') {
    const [start,end]=s.window;
    const steps=db.prepare('SELECT processing_id,wafer_id,process_start,process_end FROM wafer_processing WHERE machine_id=? AND process_start<? AND process_end>?').all(s.machine,end,start);
    const actual=steps.filter(p=>{
      const event=db.prepare(`SELECT 1 FROM errors WHERE machine_id=? AND recorded_at>=? AND recorded_at<? AND recorded_at>=? AND recorded_at<? UNION ALL SELECT 1 FROM failures WHERE machine_id=? AND recorded_at>=? AND recorded_at<? AND recorded_at>=? AND recorded_at<? LIMIT 1`).get(s.machine,start,end,p.process_start,p.process_end,s.machine,start,end,p.process_start,p.process_end);
      return !!event;
    }).map(p=>p.processing_id);
    const problems=same(actual,s.processing.map(p=>p.id))?[]:['Golden exposure steps differ from SQLite'];
    for(const p of s.processing){
      const row=steps.find(x=>x.processing_id===p.id);
      if(!row||row.wafer_id!==p.wafer) problems.push(`Golden wafer pair differs: ${p.id}`);
      const events=['errors','failures'].flatMap((t,i)=>db.prepare(`SELECT id FROM ${t} WHERE machine_id=? AND recorded_at>=? AND recorded_at<? AND recorded_at>=? AND recorded_at<?`).all(s.machine,start,end,row?.process_start??start,row?.process_end??start).map(x=>`${i?'failure':'error'}:${x.id}`));
      if(!same(events,p.events)) problems.push(`Golden overlap events differ: ${p.id}`);
    }
    return problems;
  }
  return [];
}
function addMetric(expected,predicted,kind){
  const match=new Set(predicted.filter(x=>expected.includes(x))).size;
  if(kind==='event'){totals.event_tp+=match;totals.event_expected+=expected.length;}
  else {totals.exposure_tp+=match;totals.exposure_expected+=expected.length;totals.exposure_predicted+=predicted.length;}
}
async function scoreOffline(s){
  if(s.kind==='safety'){
    const checks=[
      ()=>tools.getMachineEvents(0,'2015-01-03T00:00:00','2015-01-04T00:00:00'),
      ()=>tools.getAffectedWafers(1,'2015-01-04T00:00:00','2015-01-03T00:00:00'),
      ()=>tools.getWaferHistory('bad'),
      ()=>tools.getIncidentNotes(1,'2015-01-03T00:00:00','2015-01-04T00:00:00','bad'),
    ];
    const problems=checks.flatMap((fn,i)=>{try{fn();return [`Invalid input ${i+1} accepted`]}catch{return []}});
    const args=JSON.stringify({machineId:1,startTime:'2015-01-03T06:30:00',endTime:'2015-01-03T08:00:00'});
    const response=(output=[],output_text='')=>({id:'offline-mock',status:'completed',output,output_text});
    const call={type:'function_call',name:'getMachineEvents',arguments:args,call_id:'events',status:'completed'};
    for(const [label,answer,evidence] of [
      ['fabricated citation','Machine 1 had an error.',[{source_type:'error',source_id:'999999'}]],
      ['unsupported defect','Machine 1 confirmed wafer defect.',[{source_type:'error',source_id:'1'}]],
    ]){
      const rejected=response([],JSON.stringify({answer,evidence,uncertainty:[],exposure_findings:[]}));
      const queue=[response([call]),response(),rejected,rejected];
      const mock={responses:{create:async()=>queue.shift()}};
      try{await investigate('Assess Machine 1 source evidence.',mock,dbPath);problems.push(`${label} accepted`);}
      catch(e){if(!['UnsupportedEvidenceReference','Error'].includes(e.errorType))problems.push(`${label} rejected for unexpected reason: ${e.errorType}`);}
    }
    return problems;
  }
  if(s.kind==='events'||s.kind==='failures'){
    const actual=s.kind==='events' ? tools.getMachineEvents(s.machine,...s.window).events.map(ref) : tools.getFailureHistory(s.machine,...s.window).failures.map(x=>`failure:${x.source_id}`);
    addMetric(s.events,actual,'event');
    return same(actual,s.events)?[]:[`Expected ${s.events.join(',')||'none'}; got ${actual.join(',')||'none'}`];
  }
  if(s.kind==='history'){
    const value=tools.getWaferHistory(s.wafer);
    return (value.wafer?.lot_id??null)===s.lot && same(value.steps.map(x=>x.processing_id),s.processing) ? []:['Wafer or lot history mismatch'];
  }
  const actual=tools.getAffectedWafers(s.machine,...s.window).wafers;
  const exposed=actual.filter(x=>x.potential_exposure_status==='potentially_exposed');
  const ids=exposed.map(x=>x.processing_id);
  addMetric(s.processing.map(x=>x.id),ids,'exposure');
  const problems=same(ids,s.processing.map(x=>x.id))?[]:[`Exposure IDs differ: ${ids.join(',')}`];
  for(const p of s.processing){const row=exposed.find(x=>x.processing_id===p.id);if(!row||row.wafer_id!==p.wafer||!same(row.overlapping_source_events.map(ref),p.events))problems.push(`Exposure relationship differs: ${p.id}`);}
  return problems;
}
function scoreLive(s,r){
  const { problems, metrics } = scoreLiveV2(s,r,exists);
  totals.completed++;
  totals.citations_total+=metrics.citationsTotal;
  totals.citations_valid+=metrics.citationsValid;
  totals.unsupported_claims+=metrics.unsupportedClaims;
  totals.event_tp+=metrics.eventTp;
  totals.event_expected+=metrics.eventExpected;
  totals.exposure_tp+=metrics.exposureTp;
  totals.exposure_predicted+=metrics.exposurePredicted;
  totals.exposure_expected+=metrics.exposureExpected;
  return problems;
}
try {
  let client;
  if(mode==='live') {const {default:OpenAI}=await import('openai');client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});}
  for(const s of golden){
    const reasons=groundTruth(s);
    if(!reasons.length){
      try {
        if(mode==='offline') reasons.push(...await scoreOffline(s));
        else {
          const response=await investigate(s.question,client,dbPath);
          if(capture) diagnostics.push({id:s.id,question:s.question,answer:response.answer,evidence:response.evidence,uncertainty:response.uncertainty,exposure_findings:response.exposure_findings});
          reasons.push(...scoreLive(s,response));
        }
      }
      catch(e){reasons.push(`${e.name}: ${e.message}`);}
    }
    results.push({id:s.id,status:reasons.length?'FAIL':'PASS',reasons});
    if(reasons.length) failures.push(s.id);
  }
} finally {tools.close();db.close();}
const ratio=(n,d)=>d?n/d:1;
const report={scorer_version:2,mode,scenario_count:results.length,passed:results.length-failures.length,failed:failures.length,metrics:{event_recall:ratio(totals.event_tp,totals.event_expected),exposure_precision:ratio(totals.exposure_tp,totals.exposure_predicted),exposure_recall:ratio(totals.exposure_tp,totals.exposure_expected),evidence_citation_validity:mode==='live'?ratio(totals.citations_valid,totals.citations_total):null,unsupported_claims:mode==='live'?totals.unsupported_claims:null,completion_rate:mode==='live'?ratio(totals.completed,results.length):null},results};
await mkdir('eval/reports',{recursive:true});
await writeFile(`eval/reports/${mode}-v2.json`,JSON.stringify(report,null,2)+'\n',{mode:0o600});
await writeFile(`eval/reports/${mode}-v2.md`,[`# ProcessIQ ${mode} evaluation (scorer v2)`,'',`${report.passed}/${report.scenario_count} scenarios passed.`,'',...Object.entries(report.metrics).map(([k,v])=>`- ${k}: ${v===null?'not measured':v}`),'','| Scenario | Result | Reason |','| --- | --- | --- |',...results.map(r=>`| ${r.id} | ${r.status} | ${r.reasons.join('; ')||'—'} |`),''].join('\n'),{mode:0o600});
if(capture) await writeFile('eval/reports/live-v2-diagnostic.json',JSON.stringify({scorer_version:2,warning:'Local sensitive diagnostic: review before sharing',responses:diagnostics.map(d=>({...d,result:results.find(r=>r.id===d.id)}))},null,2)+'\n',{mode:0o600});
console.log(`ProcessIQ ${mode} v2: ${report.passed}/${report.scenario_count} passed; report: eval/reports/${mode}-v2.md`);
if(failures.length) process.exitCode=1;
