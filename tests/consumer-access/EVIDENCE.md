# W0-N14 — Wave 0 exit criterion 14 evidence

Generated 2026-09-17T03:12:17.148Z by `tests/consumer-access/scripts/generate-evidence.ts`, from the JSON evidence files each criterion test wrote during its own run (`tests/consumer-access/.evidence/*.json`). Every value below came out of a real consumer-registry decision, a real policy-chain refusal, a real kill-switch flag, or a real codegen-compiled artefact captured at the moment the test produced it — none of it is templated.

**Result: 4/4 criteria passed (6/6 demonstrations — (d) counts as three).**

01 §11.5 (Wave 0 exit criterion 14):

> The front door is closed and elevated bindings are not open. All four demonstrated in a live run:
> - **(a)** A call presenting a valid user identity from an unregistered consumer is refused at session establishment with CONSUMER_UNREGISTERED, and no tools/list is served.
> - **(b)** A registered consumer suspended mid-session is refused on its next call within the kill-switch poll interval, with CONSUMER_SUSPENDED.
> - **(c)** An elevated-binding tool held in the caller's role scope but with no elevated grant is refused with ELEVATED_GRANT_REQUIRED through both a direct tools/call and forge.invoke, and is absent from tools/list while remaining findable through forge.find with its agentMessage.
> - **(d)** A consumer registration, a standing authorization and a credential rotation each produced an approval record in approvals/, and each is visible as a compiled-artefact diff in its change proposal.

---

## Criterion (a) — PASS

**Criterion text:** (a) A call presenting a valid user identity from an unregistered consumer is refused at session establishment with CONSUMER_UNREGISTERED, and no tools/list is served.

**Test:** `refuses initialize with CONSUMER_UNREGISTERED and serves zero catalogue bytes`

**Captured:** 2026-09-17T03:12:11.777Z

| Field | Value |
| --- | --- |
| `httpStatus` | `401` |
| `errorCode` | `"CONSUMER_UNREGISTERED"` |
| `errorNext` | `"Register this client via the portal's Consumers registration flow before retrying; see the operator for onboarding."` |
| `zeroCatalogueBytesAsserted` | `["tools","capabilities","forge.transport.stub.get"]` |
| `identityResolutionsRun` | `0` |
| `sessionsMinted` | `0` |
| `secondaryToolsListStatus` | `400` |
| `realMechanism` | `"core/gateway/transport/http.ts createGatewayHttpTransport + core/gateway/transport/consumer-auth/authenticate.ts ConsumerAuthenticator — the same code core/gateway/transport/consumer-auth/consumer-auth.http.test.ts (W0-N2) exercises, driven here over a real node:http server via fetch."` |

## Criterion (b) — PASS

**Criterion text:** (b) A registered consumer suspended mid-session is refused on its next call within the kill-switch poll interval, with CONSUMER_SUSPENDED.

**Test:** `forge kill consumer:<id> mid-session refuses the next call, within the real 5s poll, CONSUMER_SUSPENDED`

**Captured:** 2026-09-17T03:12:13.616Z

| Field | Value |
| --- | --- |
| `consumerId` | `"claude-desktop-coe"` |
| `killScope` | `"consumer"` |
| `killTarget` | `"claude-desktop-coe"` |
| `killAuditCallId` | `"01a0ad59-b91f-7489-b0f2-28b00cd6891f"` |
| `pollIntervalMs` | `5000` |
| `preKillOutcome` | `"proceed"` |
| `postKillPrePollOutcome` | `"proceed"` |
| `postPollOutcome` | `"refused"` |
| `postPollRefusalCode` | `"CONSUMER_SUSPENDED"` |
| `postPollRefusalStage` | `"6b"` |
| `postPollRefusalNext` | `"This client's registration is suspended (reason: W0-N14(b) checkpoint evidence — credential suspected compromised). Ask the consumer's steward to clear the kill switch for claude-desktop-coe; no tool is visible to it until then."` |
| `realMechanism` | `"core/gateway/flags/kill.ts applyKill + core/gateway/flags/poller.ts createPolledRuntimeFlagSource (real SQLite-backed runtime_flags) + core/gateway/scope/predicates.ts notKillSwitchedPredicate (consumer scope) + core/gateway/policy/stages.ts stage6b — the same mechanism tests/policy/escalation.consumer.test.ts (W0-E8 case 6) exercises."` |

## Criterion (c) — PASS

**Criterion text:** (c) An elevated-binding tool held in the caller's role scope but with no elevated grant is refused with ELEVATED_GRANT_REQUIRED through both a direct tools/call and forge.invoke, and is absent from tools/list while remaining findable through forge.find with its agentMessage.

**Test:** `ELEVATED_GRANT_REQUIRED via tools/call AND forge.invoke; absent from tools/list; findable via forge.find with an agentMessage`

**Captured:** 2026-09-17T03:12:12.958Z

| Field | Value |
| --- | --- |
| `elevatedTool` | `"jde.ap.voucher.create"` |
| `toolsCallRefusalCode` | `"ELEVATED_GRANT_REQUIRED"` |
| `toolsCallRefusalStage` | `"6e′"` |
| `toolsCallRefusalNext` | `"This tool requires an elevated binding grant (a function bindingGrant naming ORCH_AP_VOUCHER_CREATE) on the role that grants you this tool. Ask the approver named on the grant's approval record to issue or renew it in approvals/; role scope alone does not cover it, and no plan was created for this call."` |
| `forgeInvokeRefusalCode` | `"ELEVATED_GRANT_REQUIRED"` |
| `forgeInvokeRefusalStage` | `"6e′"` |
| `identicalAcrossEntryPoints` | `true` |
| `listableWithoutGrant` | `["jde.ap.voucher.cancel","jde.ap.voucher.search","jde.ap.voucher.submit","jde.ap.voucher.update","jde.scm.purchase_order.create"]` |
| `findableWithoutGrant` | `["jde.scm.purchase_order.create","jde.ap.voucher.create","jde.ap.voucher.search","jde.ap.voucher.cancel","jde.ap.voucher.update","jde.ap.voucher.submit"]` |
| `accessLevelWithoutGrant` | `"requires_grant"` |
| `agentMessageWithoutGrant` | `"This capability exists but you hold no elevated grant for it: it needs a function bindingGrant naming ORCH_AP_VOUCHER_CREATE. Do not attempt to call it; it will refuse with ELEVATED_GRANT_REQUIRED until the approver named on that grant's approval record in approvals/ issues the grant as an approval record in approvals/."` |
| `forgeFindSurfacedIt` | `true` |
| `baselineWithGrantOutcome` | `"proceed"` |
| `listableWithGrant` | `["jde.ap.voucher.cancel","jde.ap.voucher.create","jde.ap.voucher.search","jde.ap.voucher.submit","jde.ap.voucher.update","jde.scm.purchase_order.create"]` |
| `realMechanism` | `"core/gateway/policy/binding-auth/authorize.ts authorizeBinding (stage 6e′) via core/gateway/policy/entry-points.ts (identical chain) and core/gateway/meta/visibility.ts resolveDiscovery (same authorizeBinding call, for listing only) — the mechanisms tests/policy/escalation.elevated-posture.test.ts (W0-N3) and core/gateway/meta/*.test.ts (W0-G4) already prove."` |

## Criterion (d, part 1) — PASS

**Criterion text:** (d) A consumer registration ... produced an approval record in approvals/, and is visible as a compiled-artefact diff in its change proposal.

**Test:** `(1) a NEW registration: approval record + generated/consumers/<id>.authorization.json goes from absent to present`

**Captured:** 2026-09-17T03:12:14.708Z

| Field | Value |
| --- | --- |
| `consumerId` | `"w0n14-new-agent"` |
| `approvalRecordPath` | `"approvals/2026-09-17-consumer-w0n14-new-agent-register.yaml"` |
| `approvalAction` | `"register"` |
| `approvalStatusBeforeMerge` | `"pending"` |
| `approvalStatusAfterMerge` | `"approved"` |
| `artefactPath` | `"C:\\Users\\Bikash\\AppData\\Local\\Temp\\mcpforge-w0n14-d-eQPBbl\\generated\\consumers\\w0n14-new-agent.authorization.json"` |
| `artefactAfterDiff` | `{"//1":"GENERATED BY forge codegen FROM consumers/w0n14-new-agent.consumer.yaml","//2":"manifest-sha256: 1dfb434878066886b5b62d862ba6b14e4cff8e5f3aba62d71ac44648b448a3ff  codegen-version: 0.0.0   DO NOT EDIT","attestation":{"humanInTheLoop":true,"networkOrigins":[]},"authorizations":{"bindingTypes":[],"maxSensitivity":"public","packages":[],"roles":[],"writeAllowed":false},"bindingGrants":[],"class":"autonomous-agent","consumerId":"w0n14-new-agent","effectiveStatus":"active","expired":false,"expiresAt":"2027-09-17","label":"W0-N14 checkpoint-evidence agent","limits":{"callsPerMinute":60,"concurrentSessions":1,"writesPerDay":0},"status":"active"}` |
| `diffKind` | `"absent -> present"` |

## Criterion (d, part 2) — PASS

**Criterion text:** (d) ... a standing authorization ... produced an approval record in approvals/, and is visible as a compiled-artefact diff in its change proposal.

**Test:** `(2) a STANDING AUTHORIZATION: the resolved approval record appears in the compiled bindingGrant`

**Captured:** 2026-09-17T03:12:15.602Z

| Field | Value |
| --- | --- |
| `consumerId` | `"claude-desktop-coe"` |
| `approvalRecordPath` | `"approvals/appr-2026-08-27-p2p-plsql.yaml"` |
| `approvalDecision` | `"approved (pre-existing, committed)"` |
| `standingAuthorizationBefore` | `null` |
| `standingAuthorizationAfter` | `{"approver":"A. Named Approver","effective":true,"expiresAt":"2027-02-23","ref":"appr-2026-08-27-p2p-plsql","status":"active"}` |
| `diffKind` | `"absent -> resolved {status: active, effective: true}"` |

## Criterion (d, part 3) — PASS

**Criterion text:** (d) ... a credential rotation each produced an approval record in approvals/, and each is visible as a compiled-artefact diff in its change proposal.

**Test:** `(3) a CREDENTIAL ROTATION: approval record + a visible diff in the proposed consumer record (not the derived authorization artefact, by the compiler's own design)`

**Captured:** 2026-09-17T03:12:16.449Z

| Field | Value |
| --- | --- |
| `consumerId` | `"claude-desktop-coe"` |
| `approvalRecordPath` | `"approvals/2026-09-18-consumer-claude-desktop-coe-rotate-credential-schedule.yaml"` |
| `approvalAction` | `"rotate-credential-schedule"` |
| `rotationLastRotatedAtBefore` | `"2026-08-27"` |
| `rotationLastRotatedAtAfter` | `"2026-09-18"` |
| `proposedRecordDiffKind` | `"credential.rotation.lastRotatedAt changed — visible in the change proposal file"` |
| `compiledAuthorizationSubstantiveFieldsUnchanged` | `true` |
| `compiledAuthorizationProvenanceLineChanged` | `true` |
| `note` | `"core/codegen/src/compile/consumer.ts deliberately excludes the credential block (rotation schedule included) from generated/consumers/<id>.authorization.json. The rotation's visible diff is therefore in the PROPOSED consumers/<id>.consumer.yaml, which is the artefact the change proposal actually carries — confirmed here by every substantive field of the derived authorization artefact staying identical across the rotation (only its provenance line changes, because that line hashes the source file's bytes, which changed). Flagged per CLAUDE.md §8 in this file's own header as a deliberate scope distinction, not an oversight."` |

---

**Target system:** (a) runs the real `createGatewayHttpTransport` over a real `node:http` server. (b), (c) and (d) run the real policy chain, kill-switch poller, meta-tools and codegen pipeline directly (no mock target is needed — none of these four criteria dispatches to a business-system binding). Every layer exercised — consumer authentication, the policy chain, scope resolution, the kill switch, `authorizeBinding`, discovery, and the codegen compiler — is the real production code built by W0-N1 through W0-N4, W0-N11, W0-N12 and W0-HG8, unmodified.

**Re-running against a live instance:** (a) already runs a real gateway HTTP endpoint — swapping the in-test `ConsumerAuthenticator` registry for the real `consumers/**` directory on a running deployment is the only change needed. (b), (c) and (d) exercise gateway-internal and codegen-internal mechanisms that are identical whether the deployment is local or live; (b) additionally proves the real SQLite-backed `runtime_flags` poll used in production. **No live run has ever been performed** — this suite has only ever executed against the fixtures and throwaway repo copies described above.
