import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const root = resolve(import.meta.dirname, "..");
const fixtures = join(root, "tests/fixtures");

test("imports all 5 CSVs, normalizes timestamps and makes correct joins", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "processiq-test-"));
  const dbPath = join(tmp, "test.sqlite");
  try {
    const importResult = spawnSync(process.execPath, ["scripts/import-data.mjs", "--data-dir", fixtures, "--db", dbPath], { cwd: root, encoding: "utf8" });
    assert.equal(importResult.status, 0, importResult.stderr);
    const verifyResult = spawnSync(process.execPath, ["scripts/verify-db.mjs", "--db", dbPath], { cwd: root, encoding: "utf8" });
    assert.equal(verifyResult.status, 0, verifyResult.stderr);
    assert.match(verifyResult.stdout, /PASS:/);
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const counts = db.prepare("SELECT COUNT(*) n FROM telemetry").get();
      assert.equal(counts.n, 3);
      const first = db.prepare("SELECT machine_id, recorded_at FROM telemetry ORDER BY recorded_at LIMIT 1").get();
      assert.equal(first.recorded_at, "2015-01-01T06:00:00");
      const results = db.prepare("SELECT e.error_code FROM errors e JOIN machines m USING(machine_id) WHERE m.machine_id = 1").all();
      assert.deepEqual(results.map((x) => x.error_code), ["error1"]);
    } finally { db.close(); }
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test("invalid data does not overwrite a previously valid database", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "processiq-rollback-"));
  const dbPath = join(tmp, "existing.sqlite");
  try {
    let result = spawnSync(process.execPath, ["scripts/import-data.mjs", "--data-dir", fixtures, "--db", dbPath], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const original = await readFile(dbPath);
    result = spawnSync(process.execPath, ["scripts/import-data.mjs", "--data-dir", join(tmp, "missing-data"), "--db", dbPath], { cwd: root, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    const after = await readFile(dbPath);
    assert.deepEqual(after, original);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});
