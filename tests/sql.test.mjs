import assert from "node:assert/strict";
import test from "node:test";
import { runSql } from "../src/lib/agents/sql.ts";

const liveTest = process.env.RUN_LIVE_SQL === "1" ? test : test.skip;

liveTest("SQL agent retrieves Machine 1 errors", async () => {
  const result = await runSql(
    "What error codes were recorded on Machine 1 on January 3, 2015?",
  );

  console.log("\nSQL agent result:\n", result);

  assert.match(result, /SQL executed:/);
  assert.match(result, /error1/);
  assert.match(result, /error3/);

  const rows = JSON.parse(result.split("Rows:\n")[1]);

  assert.equal(rows.length, 2);

  // Verify the SQL agent retrieved source identifiers
  assert.deepEqual(
    rows.map((row) => row.id),
    [1, 2],
  );

  // Verify it retrieved the event timestamps
  assert.deepEqual(
    rows.map((row) => row.recorded_at),
    ["2015-01-03T07:00:00", "2015-01-03T20:00:00"],
  );

  // Extract the SQL that OpenAI generated.
  const generatedSql = result.split("SQL executed: ")[1].split("\n")[0];

  // Ensure machine errors are ordered chronologically.
  assert.match(
    generatedSql,
    /\bORDER\s+BY\s+(?:errors\.)?recorded_at\s+ASC\b/i,
    "Expected machine errors to be ordered by recorded_at ASC",
  );
});

liveTest("SQL agent counts manufacturing lots", async () => {
  const result = await runSql(
    "How many manufacturing lots are in the database?",
  );

  console.log("\nSQL agent result:\n", result);

  const rows = JSON.parse(result.split("Rows:\n")[1]);

  assert.equal(rows.length, 1);
  assert.ok(
    Object.values(rows[0]).includes(500),
    "Expected 500 synthetic manufacturing lots",
  );
});
