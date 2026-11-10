import { DatabaseSync } from "node:sqlite";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { getArg, projectRoot } from "./lib/paths.mjs";
import { manufacturingSchema } from "./lib/schema.mjs";

const dbPath = getArg("--db", join(projectRoot, "data/processiq.sqlite"));
await stat(dbPath).catch(() => { throw new Error(`No SQLite DB at ${dbPath}. Run npm run db:import first.`); });
const seedArg = process.argv.includes("--seed") ? process.argv[process.argv.indexOf("--seed") + 1] : "20251109";
const seed = Number(seedArg);
if (!Number.isSafeInteger(seed) || seed < 1 || seed > 0xffffffff) throw new Error("--seed must be a positive 32-bit integer");
let randomState = seed;
function random() {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return (randomState >>> 0) / 0x100000000;
}
const minute = 60_000;
const parseTime = (value) => Date.parse(`${value}Z`); // Arithmetic only; source timestamps remain zone-unspecified.
const formatTime = (value) => new Date(value).toISOString().slice(0, 19);
const padded = (value, width) => String(value).padStart(width, "0");
const overlaps = (a, b) => a.start < b.end && b.start < a.end;

const db = new DatabaseSync(dbPath);
try {
  db.exec("PRAGMA foreign_keys = ON");
  const machines = db.prepare("SELECT machine_id FROM machines ORDER BY machine_id").all().map((row) => row.machine_id);
  const range = db.prepare("SELECT MIN(recorded_at) first_at, MAX(recorded_at) last_at FROM telemetry").get();
  if (machines.length < 4 || !range.first_at || !range.last_at) throw new Error("At least four original machines and telemetry are required");
  const first = parseTime(range.first_at);
  const last = parseTime(range.last_at);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last - first < 4 * 25 * 90 * minute) {
    throw new Error("Telemetry range is too short for four nonoverlapping processing stages");
  }
  const events = db.prepare(`
    SELECT machine_id, recorded_at, event_type FROM (
      SELECT machine_id, recorded_at, 'error' event_type FROM errors
      UNION ALL
      SELECT machine_id, recorded_at, 'failure' event_type FROM failures
    ) ORDER BY machine_id, recorded_at, event_type
  `).all().map((row) => ({ ...row, time: parseTime(row.recorded_at) }));
  const eventsByMachine = new Map(machines.map((id) => [id, []]));
  for (const event of events) eventsByMachine.get(event.machine_id)?.push(event);

  // Each machine runs 25 single-wafer jobs in each of four sequential periods.
  // Rotating the wafer assignment by machine guarantees four distinct machines per wafer.
  const slots = [];
  const period = (last - first) / 4;
  for (let stage = 0; stage < 4; stage++) {
    const periodStart = first + stage * period;
    const periodEnd = stage === 3 ? last : first + (stage + 1) * period;
    for (let machineIndex = 0; machineIndex < machines.length; machineIndex++) {
      const machineId = machines[machineIndex];
      const machineEvents = eventsByMachine.get(machineId).filter((event) => event.time >= periodStart && event.time < periodEnd);
      const machineSlots = [];
      // Spread event anchors through the period and avoid duplicate or overlapping windows.
      for (const event of machineEvents) {
        if (machineSlots.length >= 4) break;
        const start = event.time - 15 * minute;
        const candidate = { start, end: event.time + 45 * minute, machineId, stage };
        if (candidate.start < periodStart || candidate.end > periodEnd || machineSlots.some((slot) => overlaps(slot, candidate))) continue;
        machineSlots.push(candidate);
      }
      let attempts = 0;
      while (machineSlots.length < 25) {
        if (++attempts > 100_000) throw new Error(`Could not schedule machine ${machineId} in stage ${stage + 1}`);
        const duration = (30 + Math.floor(random() * 91)) * minute;
        const start = periodStart + Math.floor(random() * Math.floor((periodEnd - periodStart - duration) / minute)) * minute;
        const candidate = { start, end: start + duration, machineId, stage };
        if (!machineSlots.some((slot) => overlaps(slot, candidate))) machineSlots.push(candidate);
      }
      machineSlots.sort((a, b) => a.start - b.start);
      for (let ordinal = 0; ordinal < machineSlots.length; ordinal++) {
        const waferNumber = ((machineIndex + stage) % machines.length) * 25 + ordinal + 1;
        slots.push({ ...machineSlots[ordinal], waferNumber, lotNumber: Math.ceil(waferNumber / 5), ordinal });
      }
    }
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(manufacturingSchema);
    db.exec("DELETE FROM operator_incident_notes; DELETE FROM wafer_processing; DELETE FROM wafers; DELETE FROM manufacturing_lots; DELETE FROM operators;");
    const insertLot = db.prepare("INSERT INTO manufacturing_lots(lot_id) VALUES(?)");
    const insertWafer = db.prepare("INSERT INTO wafers(wafer_id, lot_id) VALUES(?, ?)");
    const insertOperator = db.prepare("INSERT INTO operators(operator_id, display_name) VALUES(?, ?)");
    const insertProcessing = db.prepare(`INSERT INTO wafer_processing
      (processing_id, wafer_id, lot_id, machine_id, process_start, process_end, operator_id, status, potentially_exposed)
      VALUES(?, ?, ?, ?, ?, ?, ?, 'completed', ?)`);
    const insertNote = db.prepare(`INSERT INTO operator_incident_notes
      (note_id, machine_id, observed_at, operator_id, processing_id, event_type, note_text)
      VALUES(?, ?, ?, ?, ?, ?, ?)`);
    const waferCount = machines.length * 25;
    for (let number = 1; number <= Math.ceil(waferCount / 5); number++) insertLot.run(`SYN-LOT-${padded(number, 4)}`);
    for (let number = 1; number <= waferCount; number++) insertWafer.run(`SYN-WAF-${padded(number, 5)}`, `SYN-LOT-${padded(Math.ceil(number / 5), 4)}`);
    for (let number = 1; number <= 40; number++) insertOperator.run(`SYN-OP-${padded(number, 3)}`, `Synthetic Operator ${padded(number, 2)}`);
    const noteCandidates = [];
    for (const slot of slots) {
      const matching = eventsByMachine.get(slot.machineId).filter((event) => event.time >= slot.start && event.time < slot.end);
      const processingId = `SYN-PROC-${slot.stage + 1}-${padded(slot.machineId, 3)}-${padded(slot.ordinal + 1, 2)}`;
      const operatorId = `SYN-OP-${padded(1 + Math.floor(random() * 40), 3)}`;
      insertProcessing.run(processingId, `SYN-WAF-${padded(slot.waferNumber, 5)}`, `SYN-LOT-${padded(slot.lotNumber, 4)}`,
        slot.machineId, formatTime(slot.start), formatTime(slot.end), operatorId, matching.length ? 1 : 0);
      if (matching.length) noteCandidates.push({ slot, event: matching[0], processingId, operatorId });
    }
    const noteTemplates = {
      error: [
        "Synthetic shift note: machine alarm observed during wafer processing; operator reviewed the tool log and flagged the run for investigation.",
        "Synthetic shift note: transient tool error recorded during the run; process completed and exposure requires review.",
      ],
      failure: [
        "Synthetic shift note: equipment failure recorded while the wafer was in process; quality impact has not been determined.",
        "Synthetic shift note: tool stopped with a component failure during processing; run flagged for engineering review.",
      ],
    };
    const noteCount = Math.min(80, noteCandidates.length);
    for (let index = 0; index < noteCount; index++) {
      const { slot, event, processingId, operatorId } = noteCandidates[Math.floor((index + 0.5) * noteCandidates.length / noteCount)];
      insertNote.run(`SYN-NOTE-${padded(index + 1, 3)}`, slot.machineId, event.recorded_at, operatorId,
        index % 5 === 0 ? null : processingId, event.event_type, noteTemplates[event.event_type][index % 2]);
    }
    const fkIssues = db.prepare("PRAGMA foreign_key_check").all();
    if (fkIssues.length) throw new Error(`Foreign key validation failed: ${fkIssues.length} issues`);
    db.exec("COMMIT");
    console.log(`Generated ${waferCount} wafers, ${slots.length} processing records, and ${noteCount} synthetic notes (seed ${seed}).`);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
} finally { db.close(); }
