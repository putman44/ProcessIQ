/**
 * ProcessIQ Selector Agent
 *
 * Decides whether the user's question
 * requires information from our SQLite database.
 *
 * Does not run SQL or answer questions.
 */

import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { openai } from "../openai";

type Message = {
  role: "user" | "assistant";
  content: string;
};

// Examples teach the selector how to route questions.
const FEW_SHOT_EXAMPLES = [
  {
    query: "What errors occurred on Machine 1?",
    plan: {
      useSql: true,
      needsSearch: true,
    },
  },
  {
    query: "How many failures did Machine 5 have?",
    plan: {
      useSql: true,
      needsSearch: true,
    },
  },
  {
    query: "Which wafers were potentially exposed on Machine 1?",
    plan: {
      useSql: true,
      needsSearch: true,
    },
  },
  {
    query: "Show the processing history for SYN-WAF-00001.",
    plan: {
      useSql: true,
      needsSearch: true,
    },
  },
  {
    query: "What is semiconductor lithography?",
    plan: {
      useSql: false,
      needsSearch: false,
    },
  },
  {
    query: "What does vibration mean in predictive maintenance?",
    plan: {
      useSql: false,
      needsSearch: false,
    },
  },
];

// Define the structure of the selector's response.
export const PlanSchema = z.object({
  useSql: z
    .boolean()
    .describe(
      "Whether the question needs structured manufacturing database records.",
    ),

  needsSearch: z
    .boolean()
    .describe("Whether the question requires ProcessIQ database information."),
});

export type Plan = z.infer<typeof PlanSchema>;

const ROUTING_PROMPT = `
You are a routing agent for ProcessIQ,
a semiconductor manufacturing investigation assistant.

Do not answer the user's question.

Decide whether the question requires SQL database information.

Rules:
- Use SQL for machine errors, failures, maintenance,
  telemetry, wafers, manufacturing lots, and processing history.
- Use SQL for counts, dates, filters, and relationships
  between machine events and wafer processing.
- Set needsSearch to false for general knowledge questions.
- Do not invent database facts.
- Return only the structured routing plan.

Examples:
${JSON.stringify(FEW_SHOT_EXAMPLES, null, 2)}
`;

export async function select(
  query: string,
  history: Message[] = [],
): Promise<Plan> {
  const response = await openai.responses.parse({
    model: "gpt-4.1-mini",

    input: [
      {
        role: "system",
        content: ROUTING_PROMPT,
      },

      ...history.map((message) => ({
        role: message.role,
        content: message.content,
      })),

      {
        role: "user",
        content: query,
      },
    ],

    text: {
      format: zodTextFormat(PlanSchema, "selector_plan"),
    },
  });

  return PlanSchema.parse(response.output_parsed);
}
