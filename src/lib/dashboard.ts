import { listMachines, openInvestigation } from "./investigation.ts";

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export function machinesResponse(dbPath?: string) {
  try {
    return Response.json({ machines: listMachines(dbPath) });
  } catch {
    return error(
      "Dashboard data is unavailable. Import the database first.",
      503,
    );
  }
}

export function overviewResponse(url: string, dbPath?: string) {
  const params = new URL(url).searchParams;
  const rawId = params.get("machineId");
  const start = params.get("startTime");
  const end = params.get("endTime");
  if (
    !rawId ||
    !/^[1-9]\d*$/.test(rawId) ||
    !Number.isSafeInteger(Number(rawId))
  )
    return error("machineId must be a positive integer", 400);
  if (!start || !end) return error("startTime and endTime are required", 400);
  let db;
  try {
    db = openInvestigation(dbPath);
  } catch {
    return error(
      "Dashboard data is unavailable. Import the database first.",
      503,
    );
  }
  try {
    const id = Number(rawId);
    const telemetry = db.getMachineTelemetry(id, start, end);
    if (!telemetry.machine) return error("Machine not found", 404);
    const events = db.getMachineEvents(id, start, end);
    const failures = db.getFailureHistory(id, start, end);
    const wafers = db.getAffectedWafers(id, start, end);
    const timeline = (
      [
        ...events.events,
        ...failures.failures.map((item) => ({
          ...item,
          source_type: "failure",
          detail: item.component,
        })),
      ] as Record<string, unknown>[]
    ).sort(
      (a, b) =>
        String(a.recorded_at).localeCompare(String(b.recorded_at)) ||
        String(a.source_type).localeCompare(String(b.source_type)) ||
        Number(a.source_id) - Number(b.source_id),
    );
    return Response.json({
      machine: telemetry.machine,
      window: telemetry.window,
      summary: {
        errors: events.events.filter((item) => item.source_type === "error")
          .length,
        failures: failures.failures.length,
        maintenance: events.events.filter(
          (item) => item.source_type === "maintenance",
        ).length,
        potentially_exposed_wafers: new Set(
          wafers.wafers
            .filter(
              (item) =>
                item.potential_exposure_status === "potentially_exposed",
            )
            .map((item) =>
              String((item as Record<string, unknown>)["wafer_id"]),
            ),
        ).size,
      },
      telemetry: {
        readings: telemetry.readings,
        summary: telemetry.summary,
        truncated: telemetry.truncated,
        limit: telemetry.limit,
      },
      timeline,
      wafers: wafers.wafers,
    });
  } catch (cause) {
    return error(
      cause instanceof Error ? cause.message : "Invalid dashboard request",
      400,
    );
  } finally {
    db.close();
  }
}

export function waferResponse(waferId: string, dbPath?: string) {
  if (!/^SYN-WAF-\d{5}$/.test(waferId)) return error("Invalid waferId", 400);
  let db;
  try {
    db = openInvestigation(dbPath);
  } catch {
    return error(
      "Dashboard data is unavailable. Import the database first.",
      503,
    );
  }
  try {
    const history = db.getWaferHistory(waferId);
    return history.wafer
      ? Response.json(history)
      : error("Wafer not found", 404);
  } finally {
    db.close();
  }
}
