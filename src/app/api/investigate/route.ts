import OpenAI from "openai";
import { investigate } from "../../../lib/investigation-agent";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return Response.json({ error: "Request too large" }, { status: 413 });
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 4096) return Response.json({ error: "Request too large" }, { status: 413 });
    body = JSON.parse(raw);
  } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      typeof (body as Record<string, unknown>).question !== "string" ||
      (body as Record<string, string>).question.trim().length < 3 ||
      (body as Record<string, string>).question.length > 2000) {
    return Response.json({ error: "question must contain 3 to 2000 characters" }, { status: 400 });
  }
  if (!process.env.OPENAI_API_KEY) return Response.json({ error: "OpenAI is not configured" }, { status: 503 });
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 1, timeout: 30000 });
    return Response.json(await investigate((body as { question: string }).question, client));
  } catch {
    return Response.json({ error: "Investigation failed" }, { status: 502 });
  }
}
