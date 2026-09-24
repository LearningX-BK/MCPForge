# W0-F7 — Wave 0 exit criterion 7 evidence

Generated 2026-09-08T13:27:37.790Z by `tests/write-path/scripts/generate-evidence.ts`, from the JSON evidence files each criterion test wrote during its own run (`tests/write-path/.evidence/*.json`). Every value below came out of a real policy-chain decision, a real audit row, or a real dispatcher outcome captured at the moment the test made it — none of it is templated.

**Result: 4/4 criteria passed.**

01 §10.4 (Wave 0 exit criterion 7, superseding the original §7):

> In addition, all four of the following are demonstrated at least once:
> - **(a)** A live reversal — a completed write was reversed using its declared reversal, and the reversal appears in the audit trail linked to the original call.
> - **(b)** A correct refusal at confirm — a write was refused because the arguments changed between the plan and the confirmation.
> - **(c)** A correct refusal at policy — a write was refused for breaching a declared business guardrail (amount ceiling, or an SoD conflict between `create` and `approve` on the same entity).
> - **(d)** Idempotent replay — replaying a confirmed write returned the original result instead of executing a second time.

---

## Criterion (a) — PASS

**Criterion text:** (a) A live reversal — a completed write was reversed using its declared reversal, and the reversal appears in the audit trail linked to the original call.

**Test:** `reverses a completed jde.ap.voucher.create via jde.ap.voucher.cancel, both ends linked`

**Captured:** 2026-09-08T13:27:37.117Z

| Field | Value |
| --- | --- |
| `originalToolId` | `"jde.ap.voucher.create"` |
| `reversingToolId` | `"jde.ap.voucher.cancel"` |
| `originalCallId` | `"01a08133-e581-7066-a71e-ef20878fdb02"` |
| `reversalCallId` | `"01a08133-e591-7082-be31-12fe7f6f9527"` |
| `reversalClassDeclared` | `"compensating-tool"` |
| `resultKeysUsed` | `[{"keyName":"document_number","keyValue":"9001"},{"keyName":"document_type","keyValue":"PV"},{"keyName":"document_company","keyValue":"00100"}]` |
| `reversalArgs` | `{"document_number":"9001","document_type":"PV","document_company":"00100","confirm":"cnf_eyJraWQiOiJraWQtZjcifQ.eyJjYWxsZXJTdWJqZWN0IjoidS0wMDAxIiwidG9vbElkIjoiamRlLmFwLnZvdWNoZXIuY2FuY2VsIiwidG9vbFZlcnNpb24iOiIxLjAuMCIsImFyZ3NDYW5vbmljYWxIYXNoIjoiYzZlYWQyMmFkODc2ZmZkODZkZjliYjc0NWQ2YjY4MzAyZmEwNTUxYmE0NDUwOGViYWM4ZTc2MTVkMzYxYzM5MSIsInBsYW5IYXNoIjoiN2Q3ZWM0ZGQ4NmU2ZDYyMTRlOTZmMjk0YzUzMDBmMDJjZGE1ZWU3YjZmMTgzNmY4ZDg4MTlhNDM1ZThjOTI3OSIsIm5vbmNlIjoiYXByXzAxYTA4MTMzLWU1OGQtNzJhOC1iNGRjLTAwZGNiNTFhYTY5ZSIsImV4cCI6MTc4ODU5ODgwMH0.e30.POcJxO5PZn-KvLKyfT9Bi75RrCsv0goswYvLT7iNIfE"}` |
| `auditChainVerified` | `true` |
| `auditRowsChecked` | `2` |
| `writeSafetySource` | `"manifests/jde/fin/ap/voucher.{create,cancel}.tool.yaml, read with codegen readTool and asserted equal to generated/tools/<id>/tool.ts"` |
| `guardrailEvaluator` | `"core/gateway/policy/guardrails/gate.ts — the real stage-6f evaluator, not a stub"` |
| `forwardToolReversalClass` | `"compensating-tool"` |
| `forwardToolHumanApprovalRequired` | `false` |
| `reversingToolReversalClass` | `"irreversible"` |
| `reversingToolHumanApprovalRequired` | `true` |
| `reversingToolIdempotencyScopeHours` | `24` |
| `reversingToolGuardrails` | `[]` |
| `reversalApprovalId` | `"apr_01a08133-e58d-72a8-b4dc-00dcb51aa69e"` |
| `reversalApproverSubject` | `"a.approver@ltm.example"` |
| `reversalRequesterSubject` | `"u-0001"` |

## Criterion (b) — PASS

**Criterion text:** (b) A correct refusal at confirm — a write was refused because the arguments changed between the plan and the confirmation.

**Test:** `plans at amount 18400, presents the token at amount 25000, and is refused`

**Captured:** 2026-09-08T13:27:35.800Z

| Field | Value |
| --- | --- |
| `toolId` | `"jde.ap.voucher.create"` |
| `plannedAmount` | `18400` |
| `presentedAmount` | `25000` |
| `confirmToken` | `"cnf_eyJraWQiOiJraWQtZjctbGlnaHQifQ.eyJjYWxsZXJTdWJqZWN0IjoidS0wMDAxIiwidG9vbElkIjoiamRlLmFwLnZvdWNoZXIuY3JlYXRlIiwidG9vbFZlcnNpb24iOiIxLjAuMCIsImFyZ3NDYW5vbmljYWxIYXNoIjoiOGIzM2U1ZmFiNDFiMTlhNGUzMjY4N2NmYTYxNzJlNmNmNmM2MDg4MGQzMDI4MjY1ZTdiODQ4ODk2NmQ2OTRkMyIsInBsYW5IYXNoIjoiZjRhY2MwYzE1ODA2MTYyODM3YjcxZWIwN2EzYzBjYWYzOWM2NjlhOTEyZWIwZjcxZTgxYzc0NjZjZWFhN2FhYyIsIm5vbmNlIjoiZmZkNDc0MDQtZjNiNC00YjM5LWJkNWEtZTM4ZGZiZGYzYmZiIiwiZXhwIjoxNzg4NTEyNzAwfQ.eyJhbW91bnQiOiI0aG5OSkMxc0tIUlNxbGVMTy1rZ3JSVDRhbGlheDFoU3lXVjVpUUhoTXpzIiwiY29tcGFueSI6Ijk2NFRRdWxnbUY2ckt6YktnRGR2UF9GNTVVMGJMNFdXZDQ4LTJyLTl0R28iLCJjdXJyZW5jeSI6IjFKRmxrY1lCMTBCRGVyQ3hsdkZNc2xWMVJlSmpWcnhIYk16Z3VoWlF4RmsiLCJzdXBwbGllcl9udW1iZXIiOiJaaDdEd3Z6TjRnUFN6ZWVMVTJHXzVPa0N4ejk5VHdVbkp6LTllbmJzcEN3In0.7PRkvAj3Qx_a8-Yz30vldYH6ibetPzQC6EfTsFXtzYQ"` |
| `refusalCode` | `"PLAN_ARGUMENT_MISMATCH"` |
| `refusalStage` | `"6g"` |
| `refusalMessage` | `"amount is not what the human approved: that argument changed after the plan for jde.ap.voucher.create was shown, so this confirm token does not authorise this call."` |
| `refusalNext` | `"Do not retry jde.ap.voucher.create with this token and these arguments. Either restore amount to the planned value and present this token again, or call jde.ap.voucher.create again without confirm to produce a plan for the arguments you actually intend, show THAT plan to the human, and confirm it. Never reuse a token minted for a different call."` |
| `stagesRun` | `["6a","6a′","6b","6c","6d","6e","6e′","6f","6g"]` |

## Criterion (c) — PASS

**Criterion text:** (c) A correct refusal at policy — a write was refused for breaching a declared business guardrail (amount ceiling, or an SoD conflict between create and approve on the same entity).

**Test:** `refuses purchase_order.approve for a caller whose roles also grant purchase_order.create`

**Captured:** 2026-09-08T13:27:35.809Z

| Field | Value |
| --- | --- |
| `toolId` | `"jde.scm.purchase_order.approve"` |
| `conflictingToolId` | `"jde.scm.purchase_order.create"` |
| `guardrailKind` | `"sodConflict"` |
| `scope` | `"sameEntityChain"` |
| `guardrailSource` | `"read from generated/tools/jde.scm.purchase_order.approve/tool.ts — the guardrail the manifest declares, not a restatement"` |
| `callerHeldRoles` | `["buyer","approver"]` |
| `conflictingGrantFromRole` | `"buyer"` |
| `refusalCode` | `"POLICY_GUARDRAIL_BREACH"` |
| `refusalStage` | `"6f"` |
| `refusalMessage` | `"Segregation of duties: u-0001 may not execute jde.scm.purchase_order.approve while also holding a grant for jde.scm.purchase_order.create on the sameEntityChain chain. The conflicting grant comes from role buyer."` |
| `refusalNext` | `"This call cannot succeed for u-0001 as currently granted. Hand the jde.scm.purchase_order.approve step to a colleague who does not hold jde.scm.purchase_order.create, or ask your MCPForge operator to remove jde.scm.purchase_order.create from buyer for this user — or, if the combination is genuinely intended, to record an sodException naming an approver. Do not retry as u-0001."` |
| `stagesRun` | `["6a","6a′","6b","6c","6d","6e","6e′","6f"]` |

## Criterion (d) — PASS

**Criterion text:** (d) Idempotent replay — replaying a confirmed write returned the original result instead of executing a second time.

**Test:** `a repeat presentation of the confirmed call replays the original result; the target runs once`

**Captured:** 2026-09-08T13:27:37.098Z

| Field | Value |
| --- | --- |
| `toolId` | `"jde.ap.voucher.create"` |
| `idempotencyKeyParts` | `"sha256(callerSubject | toolId | toolVersion | argsCanonicalHash | confirmToken)"` |
| `originalAuditCallId` | `"01a08133-e580-7492-b00b-bed56e0e72cc"` |
| `originalResponse` | `{"voucher":{"docNumber":"9001","docType":"PV","docCo":"00100"},"status":"CREATED"}` |
| `replayResponse` | `{"voucher":{"docNumber":"9001","docType":"PV","docCo":"00100"},"status":"CREATED","replayed":true}` |
| `replayStage` | `"6h"` |
| `targetInvocationCount` | `1` |

---

**Target system:** every test here runs against the mock target (`support/store-world.ts` / `support/light-world.ts`) — the one thing a local build cannot have live. Every other layer — the policy chain, the confirm gate, the guardrail evaluator, the idempotency gate, the write dispatcher, the reversal registry, and (for (a) and (d)) a real SQLite store — is the real production code, unmodified.

**Re-running against a live instance:** (a) and (d) take their target through the `WriteTargetInvoker` seam (`mockTarget().invoker` in `support/store-world.ts`); swapping that for an invoker backed by a real AIS/Orchestrator endpoint is the only change needed. (b) and (c) never reach a target at all — the refusal happens inside the policy chain before dispatch. **No live run has ever been performed** — this suite has only ever executed against the mock target described above.
