/**
 * ProcessIQ SQL Agent
 *
 * The LLM generates one SQLite SELECT query.
 * We execute it against the read-only database
 * and return the results as text.
 */

import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { openai } from "../openai";

type Message = {
  role: "user" | "assistant";
  content: string;
};

const SqlQuerySchema = z.object({
  sql: z.string().min(1).describe("One SQLite SELECT statement."),
});

const DATABASE_SCHEMA = `
SQLite database tables and columns:

machines
- machine_id INTEGER PRIMARY KEY
- model TEXT
- age INTEGER

telemetry
- machine_id INTEGER
- recorded_at TEXT
- volt REAL
- rotate REAL
- pressure REAL
- vibration REAL

errors
- id INTEGER PRIMARY KEY
- machine_id INTEGER
- recorded_at TEXT
- error_code TEXT

failures
- id INTEGER PRIMARY KEY
- machine_id INTEGER
- recorded_at TEXT
- component TEXT

maintenance
- id INTEGER PRIMARY KEY
- machine_id INTEGER
- recorded_at TEXT
- component TEXT

manufacturing_lots
- lot_id TEXT PRIMARY KEY
- is_synthetic INTEGER

wafers
- wafer_id TEXT PRIMARY KEY
- lot_id TEXT
- is_synthetic INTEGER

operators
- operator_id TEXT PRIMARY KEY
- display_name TEXT
- is_synthetic INTEGER

wafer_processing
- processing_id TEXT PRIMARY KEY
- wafer_id TEXT
- lot_id TEXT
- machine_id INTEGER
- process_start TEXT
- process_end TEXT
- operator_id TEXT
- status TEXT
- potentially_exposed INTEGER
- is_synthetic INTEGER

operator_incident_notes
- note_id TEXT PRIMARY KEY
- machine_id INTEGER
- observed_at TEXT
- operator_id TEXT
- processing_id TEXT
- event_type TEXT
- note_text TEXT
- is_synthetic INTEGER
`;

function stringifyRows(rows: unknown): string {
  return JSON.stringify(
    rows,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  );
}

export async function runSql(
  query: string,
  history: Message[] = [],
): Promise<string> {
  // Step 1: Open our local database as read-only.
  const db = new DatabaseSync(resolve("data/processiq.sqlite"), {
    readOnly: true,
  });

  try {
    // Step 2: Get actual database values for grounding.
    const errorCodes = db
      .prepare("SELECT DISTINCT error_code FROM errors ORDER BY error_code")
      .all();

    const components = db
      .prepare("SELECT DISTINCT component FROM failures ORDER BY component")
      .all();

    const grounding = `
Error codes:
${stringifyRows(errorCodes)}

Failure components:
${stringifyRows(components)}
`;

    // Step 3: Ask OpenAI to generate the SQL query.
    const response = await openai.responses.parse({
      model: "gpt-4.1-mini",

      input: [
        {
          role: "system",
          content: `
You are the SQL agent for ProcessIQ, a
semiconductor manufacturing investigation assistant.

Write one SQLite SELECT statement that answers
the user's structured-data question.

Rules:
- Return exactly one SELECT query.
- Do not include a semicolon or SQL comments.
- Never generate INSERT, UPDATE, DELETE,
  DROP, ALTER, CREATE, or PRAGMA commands.
- Use only the tables and columns provided.
- Use SQLite syntax, not PostgreSQL syntax.
- Use single quotes for string values.
- Use JOINs when connecting related tables.
- Add LIMIT 50 to row-listing queries.
- Do not limit aggregate COUNT queries.
- Use conversation history for follow-up questions.
- Timestamps are TEXT in YYYY-MM-DDTHH:MM:SS format.
- For calendar-day filters, use an inclusive
  start and exclusive next-day boundary.
- potentially_exposed = 1 means possible
  exposure based on overlapping events.
  It does not prove a wafer defect.
- Machine records come from sample data.
  Manufacturing records are synthetic.

- When retrieving individual machine errors, include
  id, machine_id, recorded_at, and error_code.
- When retrieving individual failures or maintenance events,
  include id, machine_id, recorded_at, and component.
- When retrieving wafer processing history, include
  processing_id, wafer_id, lot_id, machine_id,
  process_start, process_end, and potentially_exposed.
- Include identifiers and timestamps for individual records
  so the final answer can reference its evidence.
- For aggregate questions such as counts or averages,
  return the requested aggregate instead of individual records.
- Do not invent timestamps, IDs, or event relationships.
- When listing individual machine errors, failures, or
  maintenance events, ORDER BY recorded_at ASC.
- When listing wafer processing records,
  ORDER BY process_start ASC.
- Do not require ORDER BY for aggregate COUNT queries.

- When investigating a specific machine ID, verify whether
  that machine exists in the machines table.
- For event-listing queries, include a machine_exists field
  using EXISTS and a LEFT JOIN so that a result is returned
  even if the machine has no matching events.
- Do not treat an unknown machine as an existing machine
  with zero errors.

${DATABASE_SCHEMA}

Values present in the database:
${grounding}
`,
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
        format: zodTextFormat(SqlQuerySchema, "sql_query"),
      },
    });

    // Step 4: Get the generated SQL from OpenAI.
    const { sql } = SqlQuerySchema.parse(response.output_parsed);

    const statement = sql.trim();

    // Step 5: Reject anything other than a single SELECT.
    if (!/^SELECT\b/i.test(statement) || statement.includes(";")) {
      throw new Error("Only a single SELECT statement is allowed.");
    }

    // Step 6: Execute the query against SQLite.
    const prepared = db.prepare(statement);

    const rows: Record<string, unknown>[] = [];
    let truncated = false;

    // Keep at most 50 rows, even if the model
    // forgets to include LIMIT.
    for (const row of prepared.iterate()) {
      if (rows.length >= 50) {
        truncated = true;
        break;
      }

      rows.push(row);
    }

    // Check whether an explicitly requested machine exists.
    const match = query.match(/\bmachine\s+#?(\d+)\b/i);

    let machineLookup = "";

    if (match) {
      const machineId = Number(match[1]);

      const found = db
        .prepare("SELECT 1 FROM machines WHERE machine_id = ?")
        .get(machineId);

      machineLookup = `Machine lookup: machine_id=${machineId}, exists=${Boolean(found)}`;
    }

    // Step 7: Return text for the aggregator.

    return [
      `SQL executed: ${statement}`,
      ...(machineLookup ? [machineLookup] : []),
      `Rows truncated: ${truncated}`,
      `Rows:\n${stringifyRows(rows)}`,
    ].join("\n\n");
  } finally {
    // Always close the database connection.
    db.close();
  }
}
