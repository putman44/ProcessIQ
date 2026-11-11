export function isLangSmithEnabled(): boolean {
  return (
    process.env.LANGSMITH_TRACING === "true" &&
    Boolean(process.env.LANGSMITH_API_KEY)
  );
}

export const LANGSMITH_PROJECT = process.env.LANGSMITH_PROJECT || "medical-rag";
