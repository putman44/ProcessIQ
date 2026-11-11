import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { originalSchema } from "../scripts/lib/schema.mjs";

const root = resolve(import.meta.dirname, "..");
function run(script, dbPath, ...args) {
  const result = spawnSync(
    process.execPath,
    [script, "--db", dbPath, ...args],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return result;
}

test("wafer generation is deterministic, idempotent, and correlated with original events", async () => {
  const dir = await mkdtemp(join(tmpdir(), "processiq-wafers-"));
  const dbPath = join(dir, "test.sqlite");
  try {
    const source = new DatabaseSync(dbPath);
    source.exec(originalSchema);
    for (let id = 1; id <= 4; id++) {
      source.prepare("INSERT INTO machines VALUES(?, 'model1', 3)").run(id);
      source
        .prepare(
          "INSERT INTO telemetry VALUES(?, '2015-01-01T00:00:00', 1, 1, 1, 1)",
        )
        .run(id);
      source
        .prepare(
          "INSERT INTO telemetry VALUES(?, '2015-12-31T23:00:00', 1, 1, 1, 1)",
        )
        .run(id);
      source
        .prepare(
          "INSERT INTO errors(machine_id, recorded_at, error_code) VALUES(?, '2015-02-01T12:00:00', 'error1')",
        )
        .run(id);
      source
        .prepare(
          "INSERT INTO failures(machine_id, recorded_at, component) VALUES(?, '2015-08-01T12:00:00', 'comp1')",
        )
        .run(id);
      source
        .prepare(
          "INSERT INTO maintenance(machine_id, recorded_at, component) VALUES(?, '2015-04-01T12:00:00', 'comp1')",
        )
        .run(id);
    }
    source.close();

    run("scripts/generate-wafers.mjs", dbPath);
    run("scripts/verify-db.mjs", dbPath);
    const db = new DatabaseSync(dbPath);
    const snapshot = () =>
      JSON.stringify([
        ...[
          "manufacturing_lots",
          "wafers",
          "operators",
          "wafer_processing",
          "operator_incident_notes",
        ].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()),
      ]);
    const first = snapshot();
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM wafer_processing").get().n,
      400,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM wafers").get().n, 100);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM operator_incident_notes").get().n > 0,
      true,
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM wafer_processing WHERE potentially_exposed = 1",
        )
        .get().n > 0,
      true,
    );
    run("scripts/generate-wafers.mjs", dbPath);
    assert.equal(snapshot(), first);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM telemetry").get().n, 8);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM errors").get().n, 4);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM failures").get().n, 4);
    run("scripts/generate-wafers.mjs", dbPath, "--seed", "12345");
    assert.notEqual(snapshot(), first);
    run("scripts/verify-db.mjs", dbPath);
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
