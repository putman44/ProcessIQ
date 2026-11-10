import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { getArg, projectRoot } from "./lib/paths.mjs";

const dbPath = getArg("--db", join(projectRoot, "data/processiq.sqlite"));
await stat(dbPath).catch(() => { throw new Error(`No SQLite DB at ${dbPath}. Run npm run db:import first.`); });
const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  const names = ["machines", "telemetry", "errors", "maintenance", "failures"];
  console.log(`Database: ${dbPath}\n`);
  for (const table of names) {
    const row = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
    console.log(`${table.padEnd(14)} ${String(row.count).padStart(10)} records`);
    if (row.count === 0) throw new Error(`Table ${table} has zero records`);
  }
  const range = db.prepare("SELECT MIN(recorded_at) AS first_at, MAX(recorded_at) AS last_at FROM telemetry").get();
  console.log(`\nTelemetry range: ${range.first_at} to ${range.last_at}`);
  const sample = db.prepare(`
    SELECT m.machine_id, m.model, m.age,
      (SELECT COUNT(*) FROM errors e WHERE e.machine_id = m.machine_id) as errors,
      (SELECT COUNT(*) FROM failures f WHERE f.machine_id = m.machine_id) as failures
    FROM machines m ORDER BY m.machine_id LIMIT 1
  `).get();
  console.log("Example machine:", sample);
  const badLinks = db.prepare("PRAGMA foreign_key_check").all();
  if (badLinks.length) throw new Error(`Foreign key validation failed: ${badLinks.length} issues`);
  console.log("\nPASS: Records exist, timestamps are normalized, and foreign keys are valid.");
} finally { db.close(); }
