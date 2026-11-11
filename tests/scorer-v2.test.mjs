import assert from "node:assert/strict";
import test from "node:test";
import { scoreLiveV2, unsupportedClaims } from "../eval/scorer-v2.mjs";

test("explicit negation does not trigger an affirmative claim", () => {
  for (const answer of [
    "This is not a confirmed defect.",
    "There is no proven causation.",
    "The exposure is not a confirmed wafer defect.",
    "We have no evidence of a proven quality impact.",
    "It cannot be considered a confirmed defect.",
    "The defect was not confirmed.",
  ])
    assert.deepEqual(unsupportedClaims(answer), [], answer);
});

test("affirmative claim survives a separate disclaimer", () => {
  for (const answer of [
    "No proven causation was established. A confirmed defect occurred.",
    "A confirmed defect occurred. No proven causation was established.",
    "This is not a confirmed defect, but causation was proven.",
    "No proven causation, but the defect was confirmed.",
    "It is a proven wafer defect.",
    "The defect was confirmed.",
    "Yes, the wafer was defective.",
  ])
    assert.ok(unsupportedClaims(answer).length > 0, answer);
});

const scenario = {
  kind: "exposure",
  processing: [
    { id: "SYN-PROC-1-001-01", wafer: "SYN-WAF-00001", events: ["error:1"] },
  ],
};
const response = (answer) => ({
  answer,
  evidence: [{ source_type: "error", source_id: "1" }],
  exposure_findings: [
    {
      processing_id: "SYN-PROC-1-001-01",
      wafer_id: "SYN-WAF-00001",
      source_events: [{ source_type: "error", source_id: "1" }],
    },
  ],
});

test("record existence, exposure support, and claim language are separate checks", () => {
  const clean = scoreLiveV2(
    scenario,
    response("Potential exposure; no proven causation."),
    (key) => key === "error:1",
  );
  assert.deepEqual(clean.problems, []);
  assert.equal(clean.metrics.citationsValid, 1);
  const unsupported = scoreLiveV2(
    scenario,
    response("Potential exposure. A confirmed defect occurred."),
    (key) => key === "error:1",
  );
  assert.deepEqual(unsupported.problems, [
    "Unsupported defect or causation claim",
  ]);
  assert.equal(unsupported.metrics.citationsValid, 1);
  const invalid = scoreLiveV2(
    scenario,
    {
      ...response("Potential exposure."),
      evidence: [{ source_type: "error", source_id: "999" }],
    },
    () => false,
  );
  assert.ok(invalid.problems.includes("Invalid citation error:999"));
  const wrongRelationship = scoreLiveV2(
    scenario,
    {
      ...response("Potential exposure."),
      exposure_findings: [
        {
          processing_id: "SYN-PROC-1-001-01",
          wafer_id: "SYN-WAF-00002",
          source_events: [],
        },
      ],
    },
    () => true,
  );
  assert.ok(
    wrongRelationship.problems.some((x) =>
      x.startsWith("Exposure support mismatch"),
    ),
  );
  const wrongEvent = scoreLiveV2(
    { kind: "events", events: ["error:1"] },
    {
      ...response("An event occurred."),
      evidence: [{ source_type: "error", source_id: "2" }],
    },
    () => true,
  );
  assert.equal(wrongEvent.metrics.citationsValid, 1);
  assert.ok(
    wrongEvent.problems.includes("Event citations differ from expected window"),
  );
});
