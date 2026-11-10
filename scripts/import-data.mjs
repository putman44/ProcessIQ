import { DatabaseSync } from "node:sqlite";
import { createReadStream } from "node:fs";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { getArg, projectRoot } from "./lib/paths.mjs";
import { schema } from "./lib/schema.mjs";
import { parseCsvLine, isoLocalTimestamp, positiveInteger, nonnegativeInteger, finiteNumber } from "./lib/csv.mjs";

const rawDir = getArg("--data-dir", join(projectRoot, "data/raw"));
const dbPath = getArg("--db", join(projectRoot, "data/processiq.sqlite"));
const tempPath = `${dbPath}.importing`;

// Use an entirely new staging DB; failure never overwrites the previously imported DB.
await mkdir(dirname(dbPath), { recursive: true });
const files = ["PdM_machines.csv", "PdM_telemetry.csv", "PdM_errors.csv", "PdM_maint.csv", "PdM_failures.csv"];
for (const filename of files) {
  try { await access(join(rawDir, filename)); }
  catch { throw new Error(`Missing ${join(rawDir, filename)}. Run npm run data:fetch first.`); }
}
await rm(tempPath, { force: true });
const db = new DatabaseSync(tempPath);
let done = false;

const specs = [
  {
    file: "PdM_machines.csv",
    header: ["machineID", "model", "age"],
    sql: "INSERT INTO machines(machine_id, model, age) VALUES(?, ?, ?)",
    convert: ([id, model, age]) => [positiveInteger(id, "machineID"), model.trim(), nonnegativeInteger(age, "age")],
  },
  {
    file: "PdM_telemetry.csv",
    header: ["datetime", "machineID", "volt", "rotate", "pressure", "vibration"],
    sql: "INSERT INTO telemetry(recorded_at, machine_id, volt, rotate, pressure, vibration) VALUES(?, ?, ?, ?, ?, ?)",
    convert: ([time, id, volt, rotate, pressure, vibration]) => [isoLocalTimestamp(time), positiveInteger(id, "machineID"), finiteNumber(volt, "volt"), finiteNumber(rotate, "rotate"), finiteNumber(pressure, "pressure"), finiteNumber(vibration, "vibration")],
  },
  {
    file: "PdM_errors.csv",
    header: ["datetime", "machineID", "errorID"],
    sql: "INSERT INTO errors(recorded_at, machine_id, error_code) VALUES(?, ?, ?)",
    convert: ([time, id, error]) => [isoLocalTimestamp(time), positiveInteger(id, "machineID"), error.trim()],
  },
  {
    file: "PdM_maint.csv",
    header: ["datetime", "machineID", "comp"],
    sql: "INSERT INTO maintenance(recorded_at, machine_id, component) VALUES(?, ?, ?)",
    convert: ([time, id, comp]) => [isoLocalTimestamp(time), positiveInteger(id, "machineID"), comp.trim()],
  },
  {
    file: "PdM_failures.csv",
    header: ["datetime", "machineID", "failure"],
    sql: "INSERT INTO failures(recorded_at, machine_id, component) VALUES(?, ?, ?)",
    convert: ([time, id, failure]) => [isoLocalTimestamp(time), positiveInteger(id, "machineID"), failure.trim()],
  },
];

async function importCsv(spec) {
  const stream = createReadStream(join(rawDir, spec.file), { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const insert = db.prepare(spec.sql);
  let count = 0;
  let lineNumber = 0;
  for await (const rawLine of lines) {
    lineNumber++;
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim()) continue;
    try {
      const fields = parseCsvLine(line);
      if (lineNumber === 1) {
        // Remove BOM if present. Fail loudly if this is a different dataset or schema.
        fields[0] = fields[0].replace(/^\uFEFF/, "");
        if (fields.join("|") !== spec.header.join("|")) {
          throw new Error(`Unexpected CSV header: ${fields.join(", ")}; expected ${spec.header.join(", ")}`);
        }
        continue;
      }
      if (fields.length !== spec.header.length) throw new Error(`Expected ${spec.header.length} columns, got ${fields.length}`);
      const values = spec.convert(fields);
      if (values.some((v) => typeof v === "string" && !v.length)) throw new Error("Required text value is empty");
      insert.run(...values);
      count++;
    } catch (error) {
      lines.close();
      stream.destroy();
      throw new Error(`${spec.file}:${lineNumber}: ${error.message}`, { cause: error });
    }
  }
  if (lineNumber === 0) throw new Error(`${spec.file} is empty`);
  console.log(`${spec.file}: imported ${count.toLocaleString()} rows`);
  return count;
}

try {
  db.exec(schema);
  db.exec("BEGIN IMMEDIATE");
  for (const spec of specs) await importCsv(spec);
  db.exec("COMMIT");
  db.close();
  await rename(tempPath, dbPath);
  done = true;
  console.log(`\nSQLite database ready: ${dbPath}`);
  console.log("Next: npm run db:verify");
} finally {
  if (!done) {
    try { db.exec("ROLLBACK"); } catch {}
    try { db.close(); } catch {}
    await rm(tempPath, { force: true });
  }
}
