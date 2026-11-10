import test from "node:test";
import assert from "node:assert/strict";
import { parseCsvLine, isoLocalTimestamp, positiveInteger } from "../scripts/lib/csv.mjs";

test("CSV parser handles commas and escaped quotes", () => {
  assert.deepEqual(parseCsvLine('1,"first, second","quote ""here"""'), ["1", "first, second", 'quote "here"']);
});
test("CSV parser rejects unbalanced quotes", () => {
  assert.throws(() => parseCsvLine('"not closed'), /Unclosed/);
});
test("timestamps normalize consistently for sortable range queries", () => {
  assert.equal(isoLocalTimestamp("2015-01-01 06:00:00"), "2015-01-01T06:00:00");
  assert.equal(isoLocalTimestamp("2015-01-01T06:00:00"), "2015-01-01T06:00:00");
  assert.throws(() => isoLocalTimestamp("2015-02-30 12:00:00"));
});
test("machine IDs require positive integers", () => {
  assert.equal(positiveInteger("5", "machineID"), 5);
  assert.throws(() => positiveInteger("-7", "machineID"));
});
