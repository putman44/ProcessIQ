import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { isoLocalTimestamp } from "../../scripts/lib/csv.mjs";

type Row = Record<string, unknown>;
const MAX_TELEMETRY_ROWS = 1000;
const MAX_TELEMETRY_DAYS = 31;

function machineIdValue(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("machineId must be a positive integer");
  return value;
}
function timestamp(value: string): string {
  if (typeof value !== "string") throw new Error("Timestamp must be a string");
  return isoLocalTimestamp(value);
}
function window(startTime: string, endTime: string) {
  const start = timestamp(startTime);
  const end = timestamp(endTime);
  if (start >= end) throw new Error("startTime must be before endTime");
  return { start, end };
}
function rows(db: DatabaseSync, sql: string, ...params: (string | number | null)[]): Row[] {
  return db.prepare(sql).all(...params) as Row[];
}
function one(db: DatabaseSync, sql: string, ...params: (string | number)[]): Row | undefined {
  return db.prepare(sql).get(...params) as Row | undefined;
}

export function listMachines(dbPath = resolve("data/processiq.sqlite")) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return rows(db, "SELECT machine_id, model, age FROM machines ORDER BY machine_id"); }
  finally { db.close(); }
}

/** Open a local SQLite database in read-only mode; close the returned handle when done. */
export function openInvestigation(dbPath = resolve("data/processiq.sqlite")) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  function machine(machineId: number) {
    const id = machineIdValue(machineId);
    return one(db, "SELECT machine_id, model, age FROM machines WHERE machine_id = ?", id);
  }
  function sourceEvents(machineId: number, start: string, end: string) {
    return rows(db, `SELECT source_type, source_id, machine_id, recorded_at, detail FROM (
      SELECT 'error' source_type, id source_id, machine_id, recorded_at, error_code detail FROM errors
      UNION ALL SELECT 'failure', id, machine_id, recorded_at, component FROM failures
    ) WHERE machine_id = ? AND recorded_at >= ? AND recorded_at < ?
    ORDER BY recorded_at, source_type, source_id`, machineId, start, end);
  }
  return {
    close: () => db.close(),
    getMachineTelemetry(machineId: number, startTime: string, endTime: string) {
      const id = machineIdValue(machineId);
      const { start, end } = window(startTime, endTime);
      if ((Date.parse(`${end}Z`) - Date.parse(`${start}Z`)) > MAX_TELEMETRY_DAYS * 86400000) {
        throw new Error(`Telemetry window cannot exceed ${MAX_TELEMETRY_DAYS} days`);
      }
      const found = machine(id);
      if (!found) return { machine: null, window: { start, end }, summary: null, readings: [], limit: MAX_TELEMETRY_ROWS, truncated: false };
      const summary = one(db, `SELECT COUNT(*) count,
        MIN(volt) volt_min, MAX(volt) volt_max, AVG(volt) volt_avg,
        MIN(rotate) rotate_min, MAX(rotate) rotate_max, AVG(rotate) rotate_avg,
        MIN(pressure) pressure_min, MAX(pressure) pressure_max, AVG(pressure) pressure_avg,
        MIN(vibration) vibration_min, MAX(vibration) vibration_max, AVG(vibration) vibration_avg
        FROM telemetry WHERE machine_id = ? AND recorded_at >= ? AND recorded_at < ?`, id, start, end);
      const readings = rows(db, `SELECT machine_id, recorded_at, volt, rotate, pressure, vibration FROM telemetry
        WHERE machine_id = ? AND recorded_at >= ? AND recorded_at < ? ORDER BY recorded_at LIMIT ?`, id, start, end, MAX_TELEMETRY_ROWS);
      return { machine: found, window: { start, end }, summary, readings, limit: MAX_TELEMETRY_ROWS, truncated: Number(summary?.count) > readings.length };
    },
    getMachineEvents(machineId: number, startTime: string, endTime: string) {
      const id = machineIdValue(machineId);
      const { start, end } = window(startTime, endTime);
      const found = machine(id);
      const events = found ? rows(db, `SELECT source_type, source_id, machine_id, recorded_at, detail FROM (
        SELECT 'error' source_type, id source_id, machine_id, recorded_at, error_code detail FROM errors
        UNION ALL SELECT 'maintenance', id, machine_id, recorded_at, component FROM maintenance
      ) WHERE machine_id = ? AND recorded_at >= ? AND recorded_at < ?
      ORDER BY recorded_at, source_type, source_id`, id, start, end) : [];
      return { machine: found ?? null, window: { start, end }, events };
    },
    getFailureHistory(machineId: number, startTime?: string, endTime?: string) {
      const id = machineIdValue(machineId);
      const start = startTime === undefined ? undefined : timestamp(startTime);
      const end = endTime === undefined ? undefined : timestamp(endTime);
      if (start && end && start >= end) throw new Error("startTime must be before endTime");
      const found = machine(id);
      const failures = found ? rows(db, `SELECT id source_id, machine_id, recorded_at, component FROM failures
        WHERE machine_id = ? AND (? IS NULL OR recorded_at >= ?) AND (? IS NULL OR recorded_at < ?)
        ORDER BY recorded_at, id`, id, start ?? null, start ?? null, end ?? null, end ?? null) : [];
      return { machine: found ?? null, window: { start: start ?? null, end: end ?? null }, failures };
    },
    getWaferHistory(waferId: string) {
      if (typeof waferId !== "string" || !/^SYN-WAF-\d{5}$/.test(waferId)) throw new Error("Invalid waferId");
      const wafer = one(db, "SELECT wafer_id, lot_id, is_synthetic FROM wafers WHERE wafer_id = ?", waferId);
      const steps = wafer ? rows(db, `SELECT p.processing_id, p.wafer_id, p.lot_id, p.machine_id, p.operator_id,
        o.display_name operator_name, p.process_start, p.process_end, p.status, p.potentially_exposed, p.is_synthetic
        FROM wafer_processing p JOIN operators o ON o.operator_id = p.operator_id
        WHERE p.wafer_id = ? ORDER BY p.process_start, p.processing_id`, waferId) : [];
      return { wafer: wafer ?? null, steps };
    },
    getAffectedWafers(machineId: number, startTime: string, endTime: string) {
      const id = machineIdValue(machineId);
      const { start, end } = window(startTime, endTime);
      const found = machine(id);
      const processing = found ? rows(db, `SELECT processing_id, wafer_id, lot_id, machine_id, operator_id,
        process_start, process_end, status, potentially_exposed, is_synthetic
        FROM wafer_processing WHERE machine_id = ? AND process_start < ? AND process_end > ?
        ORDER BY process_start, processing_id`, id, end, start) : [];
      const events = found ? sourceEvents(id, start, end) : [];
      const wafers = processing.map((record) => {
        const overlapping_source_events = events.filter((event) =>
          String(event.recorded_at) >= String(record.process_start) && String(event.recorded_at) < String(record.process_end));
        return {
          ...record,
          // Source events inside both the incident and processing windows indicate only possible exposure.
          potential_exposure_status: overlapping_source_events.length ? "potentially_exposed" : "no_source_event_in_incident_overlap",
          overlapping_source_events,
        };
      });
      return { machine: found ?? null, window: { start, end }, wafers };
    },
    getIncidentNotes(machineId: number, startTime: string, endTime: string, waferId?: string) {
      const id = machineIdValue(machineId);
      const { start, end } = window(startTime, endTime);
      if (waferId !== undefined && (typeof waferId !== "string" || !/^SYN-WAF-\d{5}$/.test(waferId))) throw new Error("Invalid waferId");
      const found = machine(id);
      const notes = found ? rows(db, `SELECT n.note_id source_id, n.machine_id, n.observed_at, n.event_type,
        n.operator_id, o.display_name operator_name, n.processing_id, p.wafer_id,
        n.note_text, n.is_synthetic
        FROM operator_incident_notes n
        JOIN operators o ON o.operator_id = n.operator_id
        LEFT JOIN wafer_processing p ON p.processing_id = n.processing_id AND p.machine_id = n.machine_id
        WHERE n.machine_id = ? AND n.observed_at >= ? AND n.observed_at < ?
          AND (? IS NULL OR p.wafer_id = ?)
        ORDER BY n.observed_at, n.note_id`, id, start, end, waferId ?? null, waferId ?? null) : [];
      return { machine: found ?? null, window: { start, end }, wafer_id: waferId ?? null, notes };
    },
  };
}
