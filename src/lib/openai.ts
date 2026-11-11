import { createOpenAI } from "@ai-sdk/openai";
import { wrapOpenAI } from "langsmith/wrappers/openai";
import OpenAI from "openai";

const baseOpenAI = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
  timeout: 20_000,
  maxRetries: 1,
});

// Avoid installing tracing hooks when tracing is explicitly disabled. Besides
// reducing overhead, this keeps a LangSmith outage from delaying local RAG
// debugging. When enabled, one wrapped client still traces every OpenAI call.
export const openai =
  process.env.LANGSMITH_TRACING === "true"
    ? wrapOpenAI(baseOpenAI)
    : baseOpenAI;

// The Vercel AI SDK provider (for streamText in the aggregator), honoring the
// same OPENAI_BASE_URL proxy as the OpenAI SDK client above. Exported here so
// there's ONE place that configures how we talk to OpenAI.
export const openaiProvider = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

// The embedding size. A one-way door: every vector in an index must have this
// many dimensions, so changing it means a new index and re-embedding everything.
export const EMBEDDING_DIMENSIONS = 1536;

export async function createEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  return response.data[0].embedding;
}

export async function createEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  return response.data.map((d) => d.embedding);
}
