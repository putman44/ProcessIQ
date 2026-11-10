// Fixed expectations transcribed from read-only inspection of the local SQLite dataset.
// Times are source-local; processing records are synthetic.
const morning = ['2015-01-03T06:30:00', '2015-01-03T08:00:00'];
const evening = ['2015-01-03T19:30:00', '2015-01-03T21:00:00'];
const day = ['2015-01-03T00:00:00', '2015-01-04T00:00:00'];
const jan5 = ['2015-01-05T05:00:00', '2015-01-05T07:00:00'];
export const golden = [
  { id:'morning-error', kind:'events', machine:1, window:morning, events:['error:1'], question:'What error did Machine 1 record on January 3, 2015 between 06:30 and 08:00?' },
  { id:'evening-error', kind:'events', machine:1, window:evening, events:['error:2'], question:'What error did Machine 1 record on January 3, 2015 between 19:30 and 21:00?' },
  { id:'full-day-errors', kind:'events', machine:1, window:day, events:['error:1','error:2'], question:'List Machine 1 errors on January 3, 2015.' },
  { id:'jan5-maintenance', kind:'events', machine:1, window:jan5, events:['maintenance:5','maintenance:6'], question:'What maintenance was recorded for Machine 1 on January 5, 2015 between 05:00 and 07:00?' },
  { id:'jan5-failure', kind:'failures', machine:1, window:jan5, events:['failure:1'], question:'What failure did Machine 1 record on January 5, 2015 between 05:00 and 07:00?' },
  { id:'wafer-one-history', kind:'history', wafer:'SYN-WAF-00001', lot:'SYN-LOT-0001', processing:['SYN-PROC-1-001-01','SYN-PROC-2-100-01','SYN-PROC-3-099-01','SYN-PROC-4-098-01'], question:'Show the processing history and lot for SYN-WAF-00001.' },
  { id:'wafer-two-history', kind:'history', wafer:'SYN-WAF-00002', lot:'SYN-LOT-0001', processing:['SYN-PROC-1-001-02','SYN-PROC-2-100-02','SYN-PROC-3-099-02','SYN-PROC-4-098-02'], question:'Show the processing history and lot for SYN-WAF-00002.' },
  { id:'morning-exposure', kind:'exposure', machine:1, window:morning, processing:[{id:'SYN-PROC-1-001-01',wafer:'SYN-WAF-00001',events:['error:1']}], question:'Which wafers were potentially exposed to Machine 1 events on January 3, 2015 from 06:30 to 08:00?' },
  { id:'evening-exposure', kind:'exposure', machine:1, window:evening, processing:[{id:'SYN-PROC-1-001-02',wafer:'SYN-WAF-00002',events:['error:2']}], question:'Which wafers were potentially exposed to Machine 1 events on January 3, 2015 from 19:30 to 21:00?' },
  { id:'two-wafer-exposure', kind:'exposure', machine:1, window:day, processing:[{id:'SYN-PROC-1-001-01',wafer:'SYN-WAF-00001',events:['error:1']},{id:'SYN-PROC-1-001-02',wafer:'SYN-WAF-00002',events:['error:2']}], question:'Identify all potentially exposed wafers and supporting events for Machine 1 on January 3, 2015.' },
  { id:'jan5-exposure', kind:'exposure', machine:1, window:jan5, processing:[{id:'SYN-PROC-1-001-04',wafer:'SYN-WAF-00004',events:['failure:1']}], question:'Which wafer was potentially exposed during Machine 1 failure on January 5, 2015 from 05:00 to 07:00?' },
  { id:'empty-time-window', kind:'events', machine:1, window:['2015-01-03T08:00:00','2015-01-03T09:00:00'], events:[], question:'Were any Machine 1 errors or maintenance recorded on January 3, 2015 from 08:00 to 09:00?' },
  { id:'missing-machine', kind:'events', machine:999, window:morning, events:[], question:'Are there any recorded events for Machine 999 on January 3, 2015 from 06:30 to 08:00?' },
  { id:'missing-wafer', kind:'history', wafer:'SYN-WAF-99999', lot:null, processing:[], question:'Is there a processing history for SYN-WAF-99999?' },
  { id:'invalid-and-defect-guard', kind:'safety', question:'Did the Machine 1 error on January 3, 2015 prove SYN-WAF-00001 was defective?' },
];
