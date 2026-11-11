import assert from "node:assert/strict";
import test from "node:test";
import { select } from "../src/lib/agents/selector.ts";

// Only run live OpenAI tests when explicitly requested.
const liveTest = process.env.RUN_LIVE_SELECTOR === "1" ? test : test.skip;

liveTest("Machine error question routes to SQL", async () => {
  const plan = await select("What errors occurred on Machine 1?");

  console.log("Selector returned:", plan);

  assert.equal(plan.useSql, true);
  assert.equal(plan.needsSearch, true);
});

liveTest("General question does not require SQL", async () => {
  const plan = await select("What is semiconductor lithography?");

  console.log("Selector returned:", plan);

  assert.equal(plan.useSql, false);
  assert.equal(plan.needsSearch, false);
});
