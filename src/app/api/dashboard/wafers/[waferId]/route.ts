import { waferResponse } from "../../../../../lib/dashboard";
export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ waferId: string }> }) {
  return waferResponse((await context.params).waferId);
}
