export const schema = `
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
