export const originalSchema = `
PRAGMA foreign_keys = ON;
CREATE TABLE machines (
  machine_id INTEGER PRIMARY KEY,
  model TEXT NOT NULL,
  age INTEGER NOT NULL CHECK(age >= 0)
);
CREATE TABLE telemetry (
  machine_id INTEGER NOT NULL REFERENCES machines(machine_id),
  recorded_at TEXT NOT NULL,
  volt REAL NOT NULL,
  rotate REAL NOT NULL,
  pressure REAL NOT NULL,
  vibration REAL NOT NULL,
  PRIMARY KEY (machine_id, recorded_at)
);
CREATE TABLE errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES machines(machine_id),
  recorded_at TEXT NOT NULL,
  error_code TEXT NOT NULL
);
CREATE TABLE maintenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES machines(machine_id),
  recorded_at TEXT NOT NULL,
  component TEXT NOT NULL
);
CREATE TABLE failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES machines(machine_id),
  recorded_at TEXT NOT NULL,
  component TEXT NOT NULL
);
CREATE INDEX errors_machine_time_idx ON errors(machine_id, recorded_at);
CREATE INDEX maintenance_machine_time_idx ON maintenance(machine_id, recorded_at);
CREATE INDEX failures_machine_time_idx ON failures(machine_id, recorded_at);
`;

// Additive schema shared by fresh imports and the generator's existing-DB migration.
export const manufacturingSchema = `
CREATE TABLE IF NOT EXISTS manufacturing_lots (
  lot_id TEXT PRIMARY KEY,
  is_synthetic INTEGER NOT NULL DEFAULT 1 CHECK(is_synthetic = 1)
);
CREATE TABLE IF NOT EXISTS wafers (
  wafer_id TEXT PRIMARY KEY,
  lot_id TEXT NOT NULL REFERENCES manufacturing_lots(lot_id),
  is_synthetic INTEGER NOT NULL DEFAULT 1 CHECK(is_synthetic = 1),
  UNIQUE(wafer_id, lot_id)
);
CREATE INDEX IF NOT EXISTS wafers_lot_idx ON wafers(lot_id);
CREATE TABLE IF NOT EXISTS operators (
  operator_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  is_synthetic INTEGER NOT NULL DEFAULT 1 CHECK(is_synthetic = 1)
);
CREATE TABLE IF NOT EXISTS wafer_processing (
  processing_id TEXT PRIMARY KEY,
  wafer_id TEXT NOT NULL,
  lot_id TEXT NOT NULL,
  machine_id INTEGER NOT NULL REFERENCES machines(machine_id),
  process_start TEXT NOT NULL,
  process_end TEXT NOT NULL,
  operator_id TEXT NOT NULL REFERENCES operators(operator_id),
  status TEXT NOT NULL CHECK(status IN ('completed')),
  potentially_exposed INTEGER NOT NULL CHECK(potentially_exposed IN (0, 1)),
  is_synthetic INTEGER NOT NULL DEFAULT 1 CHECK(is_synthetic = 1),
  FOREIGN KEY(wafer_id, lot_id) REFERENCES wafers(wafer_id, lot_id),
  CHECK(process_start < process_end),
  UNIQUE(processing_id, machine_id)
);
CREATE INDEX IF NOT EXISTS wafer_processing_machine_time_idx ON wafer_processing(machine_id, process_start, process_end);
CREATE INDEX IF NOT EXISTS wafer_processing_wafer_time_idx ON wafer_processing(wafer_id, process_start);
CREATE INDEX IF NOT EXISTS wafer_processing_lot_idx ON wafer_processing(lot_id);
CREATE TABLE IF NOT EXISTS operator_incident_notes (
  note_id TEXT PRIMARY KEY,
  machine_id INTEGER NOT NULL REFERENCES machines(machine_id),
  observed_at TEXT NOT NULL,
  operator_id TEXT NOT NULL REFERENCES operators(operator_id),
  processing_id TEXT,
  event_type TEXT NOT NULL CHECK(event_type IN ('error', 'failure')),
  note_text TEXT NOT NULL,
  is_synthetic INTEGER NOT NULL DEFAULT 1 CHECK(is_synthetic = 1),
  FOREIGN KEY(processing_id, machine_id) REFERENCES wafer_processing(processing_id, machine_id)
);
CREATE INDEX IF NOT EXISTS operator_incident_notes_machine_time_idx ON operator_incident_notes(machine_id, observed_at);
`;

export const schema = originalSchema + manufacturingSchema;
