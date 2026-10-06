# W0-Q8 — Model-assisted authoring: design note

**Status: owner decisions D1–D6 recorded 6 Oct 2026 (§9). One input is still missing before W0-Q9 can finish: the BlueVerse API contract (§2.1).** W0-Q9 builds exactly what this note says and no more.
Drafted 6 Oct 2026 on a Sonnet session although the task is routed to Opus, and it touches four settled commitments. Treat every "recommendation" below as a proposal; the items in §9 are **owner decisions**, not defaults.

Reads: 02 §2, §5.3, §11.5 · 01 §2 · CLAUDE.md §2 (non-negotiables 1, 2, 3, 4, 8), §3.1, §4, §5, §6, §8.

## 0. The commitments this has to respect

| Commitment | Source | What it means here |
|---|---|---|
| Local-first | CLAUDE.md §3.1 | No cloud account may become a prerequisite. The feature is optional; the full build, `forge ci` and every demo work without it |
| Credentials are `secretRef://` | non-negotiable 8; 02 §11.5 | A provider API key is a credential. `SecretStore.get()` may only run in `adapters/**` and `core/gateway/identity/**` (`no-secret-value-escape`) |
| Evals belong to stewards | CLAUDE.md §4 | A model may *suggest* intents; it is never the author of record |
| Plumbing is never model-written | the console's own promise | Bindings, write safety, identity, grants and `generated/` are off limits |
| Agent-facing copy is UI and budgeted | CLAUDE.md §5 | Drafted copy passes the same codegen token budgets as hand-written copy |

## 1. (a) What a model may draft, and what it never may

**Allow-list (the model may propose text for these fields only):**

| Field | Existing limit the draft must meet |
|---|---|
| `purpose` | verb-first, ≤14 words |
| `disambiguation` | mandatory and mutual on tools sharing `{app}.{module}.{entity}`; names the sibling tool ids |
| `aliases` | ≤8 entries |
| `input[].desc` | ≤12 words each |
| `input[].example` | must satisfy the parameter's own type/format |
| `output.summaryTemplate` | placeholders must be declared `resultKeys` |
| `writeSafety.confirm.planTemplate` | names system, object, amounts, **business consequence in plain words** |
| error-map `next` copy | non-empty, names a tool id or a human action; never "try again" |
| suggested eval intents | **suggestions only**, see §6 |

**Deny-list (a model may never write, and the write path refuses even if asked):**
`binding.*` (type, technology, ref, refVersion, identity, execution), `writeSafety.*` **except** `confirm.planTemplate` (so dry-run strategy, reversal, idempotency, guardrails, `humanApprovalRequired` are human), `identity.*`, `sensitivity`, `write`, `governance.*` (`reviewPath`, owner, steward), `coreForRoles` and every role/package/consumer/grant file, `version`, `id`, `server`, and everything under `generated/`.

**Why `planTemplate` is on the allow-list despite being "the highest-stakes copy in the product".** In a chat client the plan string is the whole UI, so a draft is genuinely useful. The control is not exclusion but the gate in §5: a human accepts that field specifically, with the model's text shown beside the facts it must be true to (the manifest's real `write`, amounts, binding), and it is never auto-accepted. If you consider this too risky for Wave 0, the safe cut is to move `planTemplate` to the deny-list; nothing else in this note depends on it (decision D3).

The allow-list is a **closed list in code** (a constant and a test), not a prompt instruction. §5 enforces it structurally.

## 2. (b) The provider seam

**Recommendation: a pluggable interface, `AuthoringModel`, the fourth seam after `IdentityProvider`, `ChangeHost` and `SecretStore`.**

```ts
interface AuthoringModel {
  readonly available: boolean;                       // false when unconfigured
  suggest(req: SuggestRequest): Promise<SuggestResult>;
}
// SuggestRequest: { toolContext (see §4), field: AllowedField, constraints }
// SuggestResult:  { ok: true, text, provenance: { provider, model, requestId } }
//               | { ok: false, code, message, next }       // closed taxonomy, with a next
```

- It lives in a new package `adapters/model/` so the credential dereference sits inside `adapters/**`, where `SecretStore.get()` is already permitted. Nothing in `core/**` ever sees a key.
- It returns **text for one named field**, never a patch, never YAML. The caller (the scaffolder-side `applySuggestion`) is the only thing that writes into a draft, and it only writes allow-listed fields (§5).
- Providers: one real implementation plus a **deterministic fake** used by every test (so the suite needs no network or key).
- **Default provider: BlueVerse (owner decision D1, 6 Oct 2026), with multi-LLM switching.** Several providers can be configured at once, as sign-in providers are (W0-P23); one is the default.

### 2.1 Multi-provider switching

- The overlay lists providers, each with its own `id`, `kind`, `model`, `keyRef` and `allowedSensitivities`, plus `authoring.model.default: blueverse`. Nothing is hard-coded: adding a provider is an overlay entry, and the model id is a value, never code.
- Selection order: `--provider <id>` / the editor's provider chooser (only providers that are `available`), else the overlay default. **There is no silent fallback to another provider**: if the chosen provider fails, the call fails with a `next` naming the other configured providers. A silent fallback would send the draft to a provider nobody chose, which is a data-egress decision (§4) and the same shape as a service-account fallback.
- Each provider has its **own** `secretRef` and its own `allowedSensitivities` (so a hosted provider can be barred from `financial` tools while an approved internal one is not).
- Provenance (§5) records which provider and model produced each accepted field.
- Provider kinds planned: `blueverse` (default), `anthropic`, and `openai-compatible` (one generic adapter covering any OpenAI-style endpoint, including a local one). All sit behind the same `AuthoringModel` interface and share the fake used by tests.

### 2.2 The BlueVerse contract (supplied by the owner, 6 Oct 2026)

Source: the WILL app's `core/llm_client.py` (`C:\GenAIGenerated\LTM\WL\Aap\WILL App\Re-Engineer\WILL_App_Fixed`), read as a reference only. Owner instruction, verbatim: *"just use ltm.com instead of ltimindtree.com from API link."* The adapter therefore targets `https://blueverse-foundry.ltm.com/chatservice/chat`. **That host rename is the owner's statement; I have not called it** (no token was used), so W0-Q9's first live check is a human act.

What the contract is:

| Aspect | BlueVerse |
|---|---|
| Call | `POST <baseUrl>` (default `https://blueverse-foundry.ltm.com/chatservice/chat`), JSON body `{ "query": <text>, "space_name": <space>, "flowId": <flow> }` |
| Auth | `Authorization: Bearer <token>` |
| Model selection | **None in the request.** There is no `model` or `system` field: the LLM is chosen inside the BlueVerse flow. "Switching" within BlueVerse means choosing a different `space_name` + `flowId` |
| System prompt | Not supported separately: the adapter prepends the instructions to `query` |
| Response | Free-shaped JSON; the WILL client tries `output`, `answer`, `response`, `text`, `result`, `message`, `content`, the same keys under `data` and `result`, then `choices[0].message.content` |
| Timeout used | 60 s |

So a BlueVerse **provider entry** in the overlay is `{ id, kind: blueverse, baseUrl, spaceName, flowId, keyRef, allowedSensitivities }`; two BlueVerse flows (e.g. a copy-writing flow and a stricter one) are simply two entries. Multi-LLM switching across kinds (`blueverse`, `anthropic`, `openai-compatible`) is as §2.1.

What W0-Q9 deliberately does **not** copy from that client:

1. **The key in a plaintext `config.json`.** Here the key is a `secretRef://` (§3), dereferenced only in `adapters/model/**`.
2. **Errors returned as text** (`"⚠️ LLM error: ..."`). A string like that would flow into a draft field. Here a failure is a closed-taxonomy result with a `next` and writes nothing.
3. **The last-resort `json.dumps(data)` fallback.** If no known key yields a non-empty string the adapter fails with a `next` ("BlueVerse returned a shape this adapter does not recognise"), rather than handing a JSON blob to the §5 gate as if it were copy.
4. **Tenant identifiers as code defaults.** `space_name` and `flowId` identify the WILL app's own space; MCPForge does not ship them. They come from the overlay, empty until set.
5. **Unbounded prompt content.** Only the §4 payload is sent.

Remaining unknowns, all small and answerable at first live use: whether the response ever streams, BlueVerse's own rate limits, and which `space_name`/`flowId` MCPForge should use (a space and flow for copy drafting must be created or named by the owner; **that is a human-supplied value**, not something to reuse from the WILL app).

## 3. (c) Key handling

- Each provider's key is a reference per 02 §11.5's format `secretRef://<scope>/<subject>/<purpose>`; proposed `secretRef://gateway/authoring-model-<providerId>/api-key`, one per provider. It lives in the `SecretStore` like any other credential (`forge secrets put`, rotation interval declared and enforced).
- **Only `adapters/model/**` calls `SecretStore.get()`.** `no-secret-value-escape` already allows `adapters/**`; no new exemption is needed, and none may be added.
- The four-part test of non-negotiable 8 governs a credential a *binding* stores to reach a business target; this key reaches a model provider, so it does not apply literally. **Decided (D2, owner: yes):** the four-part test is out of scope, but each key is still scoped to one purpose and one environment, with its rotation interval declared and enforced.
- The key never appears in a manifest, overlay, proposal, provenance record, log line or CLI/portal output. Provenance records `provider`, `model` and a request id only.
- No key configured, or key revoked (`forge secrets revoke`): `available` is false (§7).

## 4. (d) What leaves the machine

A draft manifest names systems, modules, business rules and sometimes customer vocabulary. So the data sent is **minimised and enumerated**, not "the whole manifest":

Sent for a field suggestion: the tool id; the `app`, `module`, `entity`, `verb`, `write` and `sensitivity` values; the other **allow-listed** copy already present; the sibling tools' ids and `purpose` strings (needed for `disambiguation`); the requester's free-text `business.*` answers from W0-Q4's request if one is linked; the field's constraint (word limit, required placeholders).

**Never sent:** `binding.*` (refs, technology, hosts), `writeSafety` values other than the plan template's own placeholders, `identity.*`, anything under `consumers/`, `overlays/` values, any `secretRef`, audit rows, probe reports, `.mcpforge/`, or any file the model did not need.

- **Sensitivity gate (D4: decided, with a caveat).** The default is that a `personal` or `financial` tool does not call a provider unless that provider's `allowedSensitivities` in the overlay includes the class. Owner: "agree, but should be there", read here as *the capability must exist and be configurable*, not be removed. So the gate is a per-provider setting an overlay can open, never a hard block. **If you meant something else by "should be there", say so.**
- **Overlay control.** The feature is governed by a values-only overlay block (config, not code; `overlay-purity` unaffected): `authoring.model.enabled`, `provider`, `model`, `keyRef`, `allowedSensitivities`. An overlay can turn it off per deployment; the default is **off** everywhere until configured.
- **Show before send.** The UI and CLI display exactly what will be sent before the first call of a session. A `--dry-run` prints the payload and sends nothing.
- Egress is recorded **locally** (what field, which provider, request id, byte count) in the proposal's provenance, not the contents.

## 5. (e) How drafted copy is gated

The pipeline for one suggestion, in order, and **every step is a refusal point**:

1. **Request** names one allow-listed field (a constant). Any other field name is refused before the provider is called.
2. **Response** is plain text for that field. It is never parsed as YAML and never merged by the model.
3. **Structural limits** run on the text: word counts, placeholder validity, the mandatory sibling references, the `next` non-empty rule, and the codegen **token budgets** (card ≤60, describe ≤600; the same functions codegen uses, not copies).
4. **`applySuggestion`** writes the text into exactly that one field of the draft. A test feeds it responses that *try* to write other fields (a YAML document, a `binding:` block, a `reviewPath` override, a `generated/` path) and asserts nothing outside the allow-list changes. This is W0-Q9's required test.
5. **A human accepts each field individually** in the draft editor (or `forge new tool --accept <field>`); a suggestion not accepted is not written to the proposal. There is no "accept all".
6. `forge validate` runs on the result like any draft; a model cannot make an invalid manifest valid or hide a placeholder.
7. **Provenance** is recorded on the change proposal for every accepted field: `{ field, provider, model, requestId, acceptedBy: Principal.subject, acceptedAt }`. Stored in the proposal's metadata, not in the manifest (no manifest schema change).
8. A reviewer sees accepted-by-model fields marked in the proposal's diff view.

## 6. (f) Eval intents stay steward-owned

- A model may produce **candidate** intents (utterance + expected tool id) into a **suggestions file under the proposal**, e.g. `.mcpforge/proposals/<id>/suggested-intents.yaml`. They are never written to `evals/**`.
- `evals/<server>/intents.yaml` changes only when a person who is the module's named `steward` promotes a candidate by name; the commit records the promoter, and the file's existing steward-authorship rule is unchanged.
- The benchmark must never be graded against intents a model wrote and the same model's tool copy was tuned to: promoting a candidate is the steward's act, and **suggested copy and suggested intents are generated in separate calls with neither seeing the other** (so a model cannot write copy that its own intents then flatter).

## 7. (g) With no key configured

The feature is **absent, not broken**:

- `AuthoringModel.available` is false; the portal shows no "Suggest" affordance (not a disabled one with an error), and the CLI flags `--suggest` / `--accept` are not registered or print one line saying the feature is not configured, with a `next`.
- Nothing else depends on it: `forge validate`, `forge codegen`, `forge ci`, the build and every existing test produce byte-identical results with the feature unconfigured. W0-Q9's exit test asserts the full `forge ci` result is unchanged.
- Offline use (no network) is the same state; a network failure mid-suggestion returns a closed-taxonomy error with a `next` and writes nothing.

## 8. What W0-Q9 builds, in order

1. `AuthoringModel` interface, multi-provider overlay and selection (no silent fallback), the closed `AllowedField` list, the deterministic fake, `applySuggestion` and its refusal test.
2. `adapters/model/` adapters (`openai-compatible`, `anthropic`; `blueverse`, contract in §2.2) behind `SecretStore`; lint rule coverage confirmed.
3. Overlay block + schema (values only); the "show what will be sent" payload builder with its never-sent list tested.
4. Gate pipeline (§5 steps 3, 6, 7): token budgets, provenance on the proposal.
5. Reachable from Build's draft editor and from `/requests` → draft (W0-Q5 provides the request side; if Q5 has not landed, Build only).
6. Suggested-intents file and steward promotion (§6).

## 9. Decisions (owner, 6 Oct 2026)

| # | Question | Decision |
|---|---|---|
| D1 | Default provider and model | **BlueVerse as default, with multi-LLM switching** (§2.1). BlueVerse contract recorded in §2.2 |
| D2 | Does non-negotiable 8's four-part test apply to this key? | Yes, out of scope of the four-part test (as recommended); scope and rotation still apply |
| D3 | May `planTemplate` be drafted by a model? | **Yes**, human-accepted per field |
| D4 | Default for `personal` / `financial` tools | Agreed (off by default), "but should be there": a per-provider overlay setting that can enable it (§4) |
| D5 | Eval-intent suggestion in Wave 0? | **Yes**, as a suggestions file only; first to cut if scope tightens |
| D6 | Is a hosted provider acceptable given egress? | **Yes**, off until configured, with show-before-send |

## 10. Not covered, deliberately

Model-written bindings or wrapped-vendor discovery (that is W0-Q10's Harvest, and needs its own note), fine-tuning, caching or reusing suggestions across tenants, cost budgeting and rate limits, and any model call at **runtime** in the gateway: this feature exists only at authoring time, and the gateway never calls a model.
