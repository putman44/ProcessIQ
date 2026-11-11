import { aggregate } from "@/lib/agents/aggregator";
import { select } from "@/lib/agents/selector";
import { runSql } from "@/lib/agents/sql";
import { z } from "zod";

export type Message = {
  role: "user" | "assistant";
  content: string;
};

const ChatRequestSchema = z.object({
  query: z.string().trim().min(1),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .default([]),
});

export async function POST(request: Request) {
  try {
    const { query, messages } = ChatRequestSchema.parse(await request.json());

    // Step 1: Decide which agent should handle the question
    const plan = await select(query, messages);

    // Step 2: Retrieve database records if needed
    const sqlResults = plan.useSql ? await runSql(query, messages) : "";

    // Step 3: Generate the final answer
    // return aggregate(query, sqlResults).toTextStreamResponse();

    return aggregate(query, messages, sqlResults).toTextStreamResponse();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new Response("Invalid chat request.", {
        status: 400,
      });
    }

    console.error("Investigation error:", error);

    return new Response("Investigation failed.", {
      status: 500,
    });
  }
}
