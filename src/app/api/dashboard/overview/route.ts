import { overviewResponse } from "../../../../lib/dashboard";
export const runtime = "nodejs";
export function GET(request: Request) { return overviewResponse(request.url); }
