# ProcessIQ live evaluation

11/15 scenarios passed.

- event_recall: 1
- exposure_precision: 1
- exposure_recall: 1
- evidence_citation_validity: 0.9444444444444444
- unsupported_claims: 0
- completion_rate: 0.8

| Scenario                 | Result | Reason                                                          |
| ------------------------ | ------ | --------------------------------------------------------------- |
| morning-error            | PASS   | —                                                               |
| evening-error            | PASS   | —                                                               |
| full-day-errors          | PASS   | —                                                               |
| jan5-maintenance         | PASS   | —                                                               |
| jan5-failure             | PASS   | —                                                               |
| wafer-one-history        | FAIL   | InvestigationFailure: Unsupported exposure finding              |
| wafer-two-history        | FAIL   | InvestigationFailure: Unsupported exposure finding              |
| morning-exposure         | PASS   | —                                                               |
| evening-exposure         | PASS   | —                                                               |
| two-wafer-exposure       | PASS   | —                                                               |
| jan5-exposure            | FAIL   | InvestigationFailure: Unsupported exposure finding source event |
| empty-time-window        | FAIL   | Invalid citation telemetry:1:2015-01-03T08:00:00                |
| missing-machine          | PASS   | —                                                               |
| missing-wafer            | PASS   | —                                                               |
| invalid-and-defect-guard | PASS   | —                                                               |
