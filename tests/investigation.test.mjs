import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { originalSchema } from "../scripts/lib/schema.mjs";
import { openInvestigation } from "../src/lib/investigation.ts";

test("read-only investigation tools filter, order, bound, and trace records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "processiq-investigation-"));
  const path = join(dir, "fixture.sqlite");
  try {
    const db = new DatabaseSync(path);
    db.exec(originalSchema);
    for (let id = 1; id <= 4; id++) {
      db.prepare("INSERT INTO machines VALUES(?, 'model1', 3)").run(id);
      db.prepare(
        "INSERT INTO telemetry VALUES(?, '2015-01-01T00:00:00', 1, 1, 1, 1)",
      ).run(id);
      db.prepare(
        "INSERT INTO telemetry VALUES(?, '2015-12-31T23:00:00', 1, 1, 1, 1)",
      ).run(id);
    }
    db.prepare(
      "INSERT INTO telemetry VALUES(1, '2015-02-01T11:00:00', 10, 20, 30, 40)",
    ).run();
    db.prepare(
      "INSERT INTO telemetry VALUES(1, '2015-02-01T12:00:00', 20, 30, 40, 50)",
    ).run();
    db.prepare(
      "INSERT INTO telemetry VALUES(2, '2015-02-01T11:00:00', 99, 99, 99, 99)",
    ).run();
    const insertDense = db.prepare(
      "INSERT INTO telemetry VALUES(1, ?, 1, 1, 1, 1)",
    );
    for (let i = 0; i < 1001; i++)
      insertDense.run(
        new Date(Date.UTC(2015, 2, 1, 0, 0, i)).toISOString().slice(0, 19),
      );
    db.prepare(
      "INSERT INTO errors(machine_id, recorded_at, error_code) VALUES(1, '2015-02-01T12:00:00', 'error1')",
    ).run();
    db.prepare(
      "INSERT INTO maintenance(machine_id, recorded_at, component) VALUES(1, '2015-02-01T11:00:00', 'comp2')",
    ).run();
    db.prepare(
      "INSERT INTO failures(machine_id, recorded_at, component) VALUES(1, '2015-08-01T12:00:00', 'comp1')",
    ).run();
    db.prepare(
      "INSERT INTO errors(machine_id, recorded_at, error_code) VALUES(2, '2015-02-01T12:00:00', 'error2')",
    ).run();
    db.close();
    const generated = spawnSync(
      process.execPath,
      ["scripts/generate-wafers.mjs", "--db", path],
      { encoding: "utf8" },
    );
    assert.equal(generated.status, 0, generated.stderr);

    const tools = openInvestigation(path);
    try {
      const t = tools.getMachineTelemetry(
        1,
        "2015-02-01 11:00:00",
        "2015-02-01T12:00:00",
      );
      assert.equal(t.readings.length, 1);
      assert.equal(t.readings[0].volt, 10);
      assert.equal(t.summary.count, 1);
      assert.equal(t.summary.vibration_avg, 40);
      assert.equal(t.truncated, false);
      const dense = tools.getMachineTelemetry(
        1,
        "2015-03-01T00:00:00",
        "2015-03-01T01:00:00",
      );
      assert.equal(dense.summary.count, 1001);
      assert.equal(dense.readings.length, 1000);
      assert.equal(dense.truncated, true);
      assert.deepEqual(
        tools.getMachineTelemetry(
          999,
          "2015-02-01T11:00:00",
          "2015-02-01T12:00:00",
        ).readings,
        [],
      );
      assert.throws(
        () =>
          tools.getMachineTelemetry(
            1,
            "2015-01-01T00:00:00",
            "2015-03-01T00:00:00",
          ),
        /31 days/,
      );
      assert.throws(
        () =>
          tools.getMachineTelemetry(
            1,
            "2015-02-01T12:00:00",
            "2015-02-01T12:00:00",
          ),
        /before/,
      );
      assert.throws(
        () =>
          tools.getMachineTelemetry(
            1,
            "2015-02-30T00:00:00",
            "2015-03-01T00:00:00",
          ),
        /Invalid timestamp/,
      );
      const e = tools.getMachineEvents(
        1,
        "2015-02-01T11:00:00",
        "2015-02-01T13:00:00",
      );
      assert.deepEqual(
        e.events.map((x) => x.source_type),
        ["maintenance", "error"],
      );
      assert.deepEqual(
        e.events.map((x) => x.recorded_at),
        ["2015-02-01T11:00:00", "2015-02-01T12:00:00"],
      );
      assert.equal(e.events[1].source_id, 1);
      assert.deepEqual(
        tools
          .getMachineEvents(2, "2015-02-01T11:00:00", "2015-02-01T13:00:00")
          .events.map((x) => x.detail),
        ["error2"],
      );
      assert.deepEqual(
        tools
          .getMachineEvents(1, "2015-02-01T12:00:00", "2015-02-01T13:00:00")
          .events.map((x) => x.source_type),
        ["error"],
      );
      const f = tools.getFailureHistory(1);
      assert.deepEqual(
        f.failures.map((x) => x.component),
        ["comp1"],
      );
      assert.equal(f.failures[0].source_id, 1);
      assert.equal(
        tools.getFailureHistory(1, undefined, "2015-08-01T12:00:00").failures
          .length,
        0,
      );
      assert.equal(
        tools.getFailureHistory(1, "2015-08-01T12:00:00").failures.length,
        1,
      );
      assert.deepEqual(tools.getFailureHistory(999).failures, []);

      const overlap = tools.getAffectedWafers(
        1,
        "2015-02-01T12:00:00",
        "2015-02-01T12:00:01",
      );
      const affected = overlap.wafers.find((x) =>
        x.overlapping_source_events.some(
          (e) => e.source_type === "error" && e.source_id === 1,
        ),
      );
      assert.ok(
        affected,
        "real source error overlaps a synthetic processing step",
      );
      assert.equal(affected.potential_exposure_status, "potentially_exposed");
      const failureOverlap = tools.getAffectedWafers(
        1,
        "2015-08-01T12:00:00",
        "2015-08-01T12:00:01",
      );
      assert.ok(
        failureOverlap.wafers.some((x) =>
          x.overlapping_source_events.some(
            (e) => e.source_type === "failure" && e.source_id === 1,
          ),
        ),
      );
      assert.equal(
        affected.lot_id,
        tools.getWaferHistory(affected.wafer_id).wafer.lot_id,
      );
      const history = tools.getWaferHistory(affected.wafer_id);
      assert.equal(history.steps.length, 4);
      assert.equal(new Set(history.steps.map((x) => x.machine_id)).size, 4);
      assert.ok(
        history.steps.every(
          (x) =>
            x.lot_id === history.wafer.lot_id &&
            x.operator_id &&
            x.status === "completed",
        ),
      );
      assert.deepEqual(
        history.steps.map((x) => x.process_start),
        [...history.steps.map((x) => x.process_start)].sort(),
      );
      assert.equal(tools.getWaferHistory("SYN-WAF-99999").wafer, null);
      assert.deepEqual(
        tools.getAffectedWafers(
          999,
          "2015-02-01T12:00:00",
          "2015-02-01T12:00:01",
        ).wafers,
        [],
      );
      assert.equal(
        tools
          .getAffectedWafers(1, affected.process_end, "2015-02-01T13:00:00")
          .wafers.some((x) => x.processing_id === affected.processing_id),
        false,
      );
    } finally {
      tools.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
