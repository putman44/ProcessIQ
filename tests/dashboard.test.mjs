import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { schema } from "../scripts/lib/schema.mjs";
import { machinesResponse, overviewResponse, waferResponse } from "../src/lib/dashboard.ts";
import { dashboardTimestamp } from "../src/lib/dashboard-time.ts";
const start = "2015-01-03T06:30:00", end = "2015-01-03T08:00:00";
async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), "processiq-dashboard-")), path = join(dir, "test.sqlite");
  try { const db = new DatabaseSync(path); db.exec(schema); db.exec(`INSERT INTO machines VALUES (1,'model1',3),(2,'model2',4);
    INSERT INTO telemetry VALUES (1,'2015-01-03T06:30:00',10,20,30,40),(1,'2015-01-03T07:00:00',11,21,31,41),(1,'2015-01-03T08:00:00',12,22,32,42),(2,'2015-01-03T07:00:00',99,99,99,99);
    INSERT INTO errors(machine_id,recorded_at,error_code) VALUES (1,'2015-01-03T07:00:00','error1'),(1,'2015-01-03T08:00:00','error2'),(2,'2015-01-03T07:00:00','error3');
    INSERT INTO failures(machine_id,recorded_at,component) VALUES (1,'2015-01-03T07:10:00','comp1');
    INSERT INTO maintenance(machine_id,recorded_at,component) VALUES (1,'2015-01-03T07:20:00','comp2');
    INSERT INTO manufacturing_lots VALUES ('SYN-LOT-00001',1);
    INSERT INTO wafers VALUES ('SYN-WAF-00001','SYN-LOT-00001',1),('SYN-WAF-00002','SYN-LOT-00001',1);
    INSERT INTO operators VALUES ('SYN-OP-001','Test Operator',1);
    INSERT INTO wafer_processing(processing_id,wafer_id,lot_id,machine_id,process_start,process_end,operator_id,status,potentially_exposed) VALUES
      ('SYN-PROC-00001','SYN-WAF-00001','SYN-LOT-00001',1,'2015-01-03T06:45:00','2015-01-03T07:15:00','SYN-OP-001','completed',1),
      ('SYN-PROC-00002','SYN-WAF-00001','SYN-LOT-00001',2,'2015-01-04T06:45:00','2015-01-04T07:15:00','SYN-OP-001','completed',0),
      ('SYN-PROC-00003','SYN-WAF-00002','SYN-LOT-00001',1,'2015-01-03T07:30:00','2015-01-03T07:45:00','SYN-OP-001','completed',0);`); db.close(); await run(path); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
const url = (machineId, a = start, b = end) => `http://localhost/api/dashboard/overview?${new URLSearchParams({ machineId: String(machineId), startTime: a, endTime: b })}`;
test("dashboard request timestamps add missing seconds and preserve supplied seconds", () => {
  assert.equal(dashboardTimestamp("2015-01-03T00:00"), "2015-01-03T00:00:00");
  assert.equal(dashboardTimestamp("2015-01-03T00:00:42"), "2015-01-03T00:00:42");
});
test("Machine 1 full-day dashboard request accepts minute and second precision", async () => fixture(async path => {
  for (const [a, b] of [["2015-01-03T00:00", "2015-01-04T00:00"], ["2015-01-03T00:00:00", "2015-01-04T00:00:00"]]) {
    const response = overviewResponse(url(1, a, b), path);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.window, { start: "2015-01-03T00:00:00", end: "2015-01-04T00:00:00" });
    assert.deepEqual(data.telemetry.readings.map(r => r.volt), [10, 11, 12]);
    assert.equal(data.summary.errors, 2);
  }
}));
test("dashboard reads filtered source records and classifies synthetic overlap", async () => fixture(async path => {
  const machines = await machinesResponse(path).json(); assert.deepEqual(machines.machines.map(m => m.machine_id), [1,2]);
  const response = overviewResponse(url(1), path); assert.equal(response.status, 200); const d = await response.json();
  assert.deepEqual(d.summary, { errors: 1, failures: 1, maintenance: 1, potentially_exposed_wafers: 1 });
  assert.deepEqual(d.telemetry.readings.map(r => r.volt), [10,11]);
  assert.deepEqual(d.timeline.map(e => e.source_type), ["error","failure","maintenance"]);
  assert.deepEqual(d.wafers.map(w => w.potential_exposure_status), ["potentially_exposed","no_source_event_in_incident_overlap"]);
  assert.deepEqual(d.wafers[0].overlapping_source_events.map(e => e.source_type), ["error","failure"]);
  const other = await overviewResponse(url(2), path).json(); assert.equal(other.summary.errors, 1); assert.equal(other.wafers.length, 0);
  const empty = await overviewResponse(url(1, "2015-01-05T00:00:00", "2015-01-05T01:00:00"), path).json(); assert.equal(empty.timeline.length, 0); assert.equal(empty.telemetry.readings.length, 0); assert.equal(empty.summary.potentially_exposed_wafers, 0);
}));
test("dashboard validates windows and machine IDs", async () => fixture(async path => {
  for (const bad of [url(0), url("abc"), url(1,end,start), url(1,"2015-02-30T00:00:00",end), url(1,"2015-01-01T00:00:00","2015-03-01T00:00:00")]) assert.equal(overviewResponse(bad,path).status,400);
  assert.equal(overviewResponse(url(999),path).status,404);
}));
test("wafer detail returns ordered machine history and handles missing records", async () => fixture(async path => {
  const d = await waferResponse("SYN-WAF-00001",path).json(); assert.equal(d.wafer.lot_id,"SYN-LOT-00001"); assert.deepEqual(d.steps.map(s => s.machine_id),[1,2]);
  assert.equal(waferResponse("bad",path).status,400); assert.equal(waferResponse("SYN-WAF-99999",path).status,404);
}));
