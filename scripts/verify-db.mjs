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
  const hasManufacturing = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'wafer_processing'").get();
  if (hasManufacturing) {
    const count = (sql) => db.prepare(sql).get().n;
    const machineCount = count("SELECT COUNT(*) n FROM machines");
    const processingCount = count("SELECT COUNT(*) n FROM wafer_processing");
    const waferCount = count("SELECT COUNT(*) n FROM wafers");
    const lotCount = count("SELECT COUNT(*) n FROM manufacturing_lots");
    const operatorCount = count("SELECT COUNT(*) n FROM operators");
    const noteCount = count("SELECT COUNT(*) n FROM operator_incident_notes");
    const exposedCount = count("SELECT COUNT(*) n FROM wafer_processing WHERE potentially_exposed = 1");
    console.log(`\nSynthetic manufacturing: ${lotCount} lots, ${waferCount} wafers, ${operatorCount} operators, ${processingCount} processing records, ${noteCount} notes, ${exposedCount} potentially exposed runs`);
    if (processingCount) {
      if (processingCount !== machineCount * 100 || waferCount !== machineCount * 25 || lotCount !== Math.ceil(waferCount / 5) || operatorCount !== 40) {
        throw new Error("Synthetic manufacturing counts do not match the generation model");
      }
      const invalid = [
        ["non-synthetic rows", `SELECT COUNT(*) n FROM (
          SELECT is_synthetic FROM manufacturing_lots UNION ALL SELECT is_synthetic FROM wafers
          UNION ALL SELECT is_synthetic FROM operators UNION ALL SELECT is_synthetic FROM wafer_processing
          UNION ALL SELECT is_synthetic FROM operator_incident_notes
        ) WHERE is_synthetic != 1`],
        ["timestamp bounds", `SELECT COUNT(*) n FROM wafer_processing WHERE process_start < '${range.first_at}' OR process_end > '${range.last_at}' OR process_start >= process_end`],
        ["lot membership", `SELECT COUNT(*) n FROM wafer_processing p LEFT JOIN wafers w ON w.wafer_id = p.wafer_id AND w.lot_id = p.lot_id WHERE w.wafer_id IS NULL`],
        ["wafer step count", `SELECT COUNT(*) n FROM (SELECT wafer_id FROM wafer_processing GROUP BY wafer_id HAVING COUNT(*) != 4 OR COUNT(DISTINCT machine_id) != 4)`],
        ["machine overlaps", `SELECT COUNT(*) n FROM wafer_processing a JOIN wafer_processing b ON a.machine_id = b.machine_id AND a.processing_id < b.processing_id AND a.process_start < b.process_end AND b.process_start < a.process_end`],
        ["wafer overlaps", `SELECT COUNT(*) n FROM wafer_processing a JOIN wafer_processing b ON a.wafer_id = b.wafer_id AND a.processing_id < b.processing_id AND a.process_start < b.process_end AND b.process_start < a.process_end`],
        ["event exposure mismatch", `SELECT COUNT(*) n FROM wafer_processing p WHERE p.potentially_exposed != CASE WHEN
          EXISTS(SELECT 1 FROM errors e WHERE e.machine_id = p.machine_id AND e.recorded_at >= p.process_start AND e.recorded_at < p.process_end)
          OR EXISTS(SELECT 1 FROM failures f WHERE f.machine_id = p.machine_id AND f.recorded_at >= p.process_start AND f.recorded_at < p.process_end)
          THEN 1 ELSE 0 END`],
        ["unlinked notes", `SELECT COUNT(*) n FROM operator_incident_notes n WHERE NOT EXISTS(
          SELECT 1 FROM errors e WHERE n.event_type = 'error' AND e.machine_id = n.machine_id AND e.recorded_at = n.observed_at
          UNION ALL SELECT 1 FROM failures f WHERE n.event_type = 'failure' AND f.machine_id = n.machine_id AND f.recorded_at = n.observed_at
        )`],
      ];
      for (const [label, sql] of invalid) {
        const n = count(sql);
        if (n) throw new Error(`Invalid ${label}: ${n}`);
      }
      if (exposedCount === 0 || noteCount === 0) throw new Error("Expected event-correlated processing records and notes");
      console.log("PASS: Synthetic counts, links, time bounds, lot membership, nonoverlap, and event exposure are valid.");
    }
  }
  console.log("\nPASS: Records exist, timestamps are normalized, and foreign keys are valid.");
} finally { db.close(); }
