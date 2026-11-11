import { machinesResponse } from "../../../../lib/dashboard";
export const runtime = "nodejs";
export function GET() { return machinesResponse(); }
