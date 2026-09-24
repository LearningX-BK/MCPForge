# MCPForge — Real Application: Consumer Governance, Access Control and Credentials

**Phase 5 of the planning stream · Written 27 Aug 2026 · Companion to `01_GOALS_AND_ROADMAP.md`, `02_TECHNICAL_ARCHITECTURE.md`, `03_UX_DESIGN_SYSTEM.md`, `04_AUTONOMY_MODEL_ROUTING_AND_TASKS.md`**

---

## 0. Why this document exists

Phases 1–4 were complete and written to disk when the user raised a fifth concern, verbatim:

> *"there should be an agent registration/securing agent interaction with MCPforge and proper governance and usage tracking should be there. Like let's say, some tools like PLSQL package based may be opened, but shouldn't be used as open.. access control and protocols should be handled. Likewise application login details."*

This document does two things and nothing else:

1. **Sections 1–5** analyse each of the four sub-threads that request unpacks into, state what Phases 1–4 already cover (with the section cited), design the addition where there is a genuine gap, and take the Wave-0 placement decision with its effort and risk delta.
2. **Section 6** is a precise, itemised instruction set for a Sonnet execution pass to apply those changes mechanically to `01`–`04`, `MCPForge\CLAUDE.md` and `MCPForge\TASKS.md`, following the dated-correction-marker pattern already used three times in this plan.

**This document does not edit anything.** It is the design and the instruction set. The edits are a separate pass.

**The discipline this document was written under, stated because it shaped every section:** Phases 1–4 already contain per-user identity passthrough, an ordered fail-closed policy chain, a rich per-call audit trail, binding-type-driven review paths, and a read-only-by-policy rule for `database` bindings. **The job here was to find what is missing *around* those, not to restate them.** Where a sub-thread turned out to be already covered, this document says so and moves on rather than manufacturing a gap.

---

## 1. Sub-thread 1 — Agent / consumer registration and secured interaction

### 1.1 What Phases 1–4 already cover

| Concern | Where it is covered | What it actually does |
|---|---|---|
| Authenticating the **human** | 02 §4.4 (`IdentityProvider` → `Principal`), 02 §4.2 step 2–3 | Resolves *which human* a call acts as. `LocalUserStore` at W0, OIDC at W1, both contract-tested in W0 (`W0-D3`). |
| Authorising the **human** | 02 §4.3 (roles as git artefacts, compiled to explicit tool-id lists), 02 §4.2 steps 4 and 6a | Decides which tools that human may see and call. |
| Keeping non-gateway traffic out of the **targets** | 02 §4.8 | mTLS / service principal / IP allowlist so target systems accept connections **only from the gateway's egress identity**; Mode B bundles accept connections only from the gateway. |
| Per-call recording | 02 §4.6 | `caller_subject`, `caller_idp`, `caller_amr`, `caller_roles[]`, `session_id`, `on_behalf_of`. |
| Tool → agent rollup | 02 §4.6 (`consumption_edge` satellite), 03 §5.3 (`/activity/consumption`), 01 G9 @ M1 | A graph of tool → consuming agent → platform → scope, with 30-day volume. |

### 1.2 The gap — and it is genuine

**Every ingress control in the plan authenticates the human. Nothing authenticates or authorises the software holding the session.**

02 §4.8 is titled *"the gateway is the only door"* and is entirely about **egress** — it stops anything reaching a target except through the gateway. It says nothing about **ingress**: who may reach the gateway. Read the request path in 02 §4.2 literally and the answer is *any client that can present a valid user token*. That is precisely the layer the user is asking about, and it does not exist.

Three concrete consequences, none of them hypothetical:

1. **`consumption_edge` has no source.** 02 §4.6 declares the satellite and 03 §5.3 designs the screen that renders it, but nothing in Phases 1–4 establishes an authenticated `agent` or `platform` value to write into it. The concept console's `agentName` / `agentPlatform` fields are demo fixtures that `forge validate` explicitly **rejects** from manifests (02 §2.7, R11). So `/activity/consumption` is currently a Wave-0 screen that cannot be truthfully populated, and G9 @ M1 ("consumption graph is live: every tool → consuming agent, platform, scope, call count") cannot be honestly evidenced.
2. **Dynamic Client Registration is undecided.** 02 §4.4 has the gateway publish "the protected-resource metadata the spec requires" and use "the OAuth 2.1 flow the MCP spec defines." OAuth 2.1 and the MCP spec both contemplate RFC 7591 Dynamic Client Registration. Nowhere is it decided whether that endpoint exists. Left open, it means the set of software permitted to hold a session is self-service and unreviewable — the exact opposite of every other grant in this architecture, all of which are git diffs.
3. **Wave 0 exit criterion 5 is arguably not honestly satisfiable as written.** It reads *"a direct call to a module server from outside the trust boundary is refused."* That proves the side door is locked. An unregistered client walking in the front door with a harvested user token is also a door, and nothing currently refuses it.

**Verdict: genuine gap, and it is foundational rather than additive** — it introduces a second principal type that the audit schema and the scope intersection both have to know about.

### 1.3 Design — the Consumer Registry

#### 1.3.1 A second principal, composed with the first

The plan already has exactly one principal type. Add a second, and fix the relationship between them in one sentence that is meant to be quotable:

> **Every call is made by a `Consumer` acting for a `Principal`. Authorization is the intersection of what the consumer may do and what the human may do — never the union, never a substitute. A registered consumer with no resolved human identity is refused `IDENTITY_UNRESOLVED`; a valid human identity presented by an unregistered consumer is refused `CONSUMER_UNREGISTERED`. There is no consumer-only path and no human-only path.**

That phrasing is deliberate: it makes the new layer impossible to read as a replacement for identity passthrough, which is the one way this addition could do harm.

`CallerContext = { consumer: Consumer, principal: Principal }` replaces bare `Principal` at the gateway's internal boundary. Everything that consumes `Principal` today keeps working; the new field is additive.

#### 1.3.2 The record — a git artefact, because it is a grant

A consumer registration is a **grant**, and in this architecture grants live in git so that widening one is a reviewable diff (02 §4.3's whole argument for compiling role globs into explicit tool-id lists). So consumer records are `consumers/<id>.consumer.yaml`, validated by `forge validate`, compiled by `forge codegen`, and changed only through the existing change-proposal → approval → merge flow.

This is the single most important structural decision in this sub-thread, because it means **registration needs no new governance machinery at all** — it inherits the change model (03 §6), the approvals queue (03 §5.3), the approval record (`approvals/`, W0 exit criterion 8) and the compiled-artefact diff discipline (02 §4.3) unchanged.

```yaml
apiVersion: mcpforge/v1
kind: Consumer
id: claude-desktop-coe
label: Claude Desktop (LTM CoE)
class: interactive-client            # interactive-client | autonomous-agent | batch-service | portal
owner: LTM Oracle AI Practice        # accountable team — a named human is required at review
steward: <named person>
status: active                       # active | suspended | retired
expiresAt: 2027-08-27                # registrations EXPIRE. Renewal is a re-approval, not a no-op.

credential:
  method: private-key-jwt            # mtls | private-key-jwt | client-secret
  ref: secretRef://consumer/claude-desktop-coe/client    # a REFERENCE. Never a value. Ever.
  boundIssuers: [ltm-ad, local]      # which identity issuers this consumer may present user tokens from
  rotation: { intervalDays: 90, lastRotatedAt: 2026-08-27 }

authorizations:
  bindingTypes: [rest, wrapped-vendor]      # the new gate — see §3
  maxSensitivity: internal                  # intersects with the role's sensitivityCeiling
  writeAllowed: false                       # independent of, and intersected with, the human's role
  roles:    [p2p]                           # may act only within these roles even if the human holds more
  packages: [jde-fin]

limits:
  callsPerMinute: 60
  writesPerDay: 20
  concurrentSessions: 4
  operatingWindow: "Mon-Fri 07:00-20:00 Europe/London"   # optional; absent = 24/7 with a stated reason

attestation:
  networkOrigins: [10.20.0.0/16]     # optional CIDR or mTLS SAN pin
  humanInTheLoop: true               # see below — this one has teeth
```

**`humanInTheLoop` is not documentation.** The entire write-safety design (02 §3.1.1, 03 §7) assumes a human reads the plan sentence before confirming — 03 §10.1 item 8 calls the plan string *"the entire UI in a chat client."* A headless autonomous agent with no human in its loop cannot satisfy that assumption, and today nothing notices. So:

> **A consumer declaring `humanInTheLoop: false` forces `humanApprovalRequired: true` on every write it attempts, regardless of the tool's own setting.** The plan is then read by a named approver in the portal instead of by nobody.

That is a small field with a large and correct consequence, and it costs nothing to implement because 02 §3.1.1's `awaiting_human_approval` path and `W0-F6` already exist.

#### 1.3.3 How registration happens — admin-approved, and DCR is off

**Decision: registration is admin-approved. Self-service registration and RFC 7591 Dynamic Client Registration are both disabled.**

Reasoning, stated because this is a real fork in the road:

- The gateway fronts financial write capability against a production Oracle estate. Every other grant in this architecture — a role, a package, a tool — is a reviewed git diff with an approval record. A self-registering client would be the only grant in the system that nobody reviews, and it would be the grant that decides which software may hold a session at all.
- Because the record is a git artefact, admin approval is **free**: it is the change-proposal flow that already exists. Self-service would actually cost *more* to build, because it would need a parallel path.
- Dynamic Client Registration is therefore **structurally absent**: the `registration_endpoint` does not appear in the gateway's authorization-server or protected-resource metadata, and a `POST` to it returns `403` with an agent-actionable `next` naming the portal's registration flow. **The refusal must be legible rather than mysterious** — MCP clients commonly attempt DCR, and a silent 404 turns a governance decision into a debugging session.

**Bootstrap, because local-first must work on a clean clone.** `forge consumer new --id <id> --class <class>` scaffolds the YAML; `forge consumer issue-credential <id>` mints the credential into the local secret store and prints it exactly once. Both are refused when `CI=true` and refused when the environment class is `staging` or `prod` — in those, registration goes through the portal and produces an approval record. And `forge dev` self-registers a `portal-local` consumer on first boot **in environment class `local` only**, because the portal is itself a consumer of the gateway API and a fresh clone would otherwise deadlock.

#### 1.3.4 Where the check happens — two places, deliberately

02 §4.2 already establishes the pattern to copy: *"Steps 4 and 6a are deliberately two independent checks of the same fact."* Apply it.

- **New step `[2a]` in the request path, between Authentication and Identity resolution: consumer authentication and registration check.** An unregistered, suspended, expired or retired consumer is refused **at `initialize`** — it never reaches identity resolution, never gets a session, and never enumerates the catalogue through `tools/list`. This is the front door.
- **New per-call stage `6a′`, immediately after `6a` (tool in resolved scope): consumer still active and this call within its declared authorizations.** So a consumer suspended mid-session stops working on its **next call**, not at its next reconnect.

Suspension propagates through the mechanism that already exists for exactly this: 02 §4.7's `runtime_flags` table with its 5-second hot-reload poll. **Extend the kill switch from four granularities to five — tool · module server · binding type · *consumer* · whole deployment.** `forge kill consumer:<id> --reason "…"` is then the emergency control for "cut that agent off now," it takes effect in five seconds with no redeploy, it emits `notifications/tools/list_changed`, and it writes an audit record with its author and reason. No new mechanism; one new granularity on an existing one.

#### 1.3.5 Composition with scope resolution — a sixth predicate

02 §5.1's intersection is the cleanest place to express this formally:

```
visible(session) = Deployed(package)
                 ∩ Granted(∪ caller roles)
                 ∩ Activated(persona | default)
                 ∩ Enabled(probe status = resolved | degraded_readonly)
                 ∩ ¬KillSwitched
                 ∩ ConsumerAuthorized(consumer)          ← NEW
```

`ConsumerAuthorized` = tools whose binding type is in the consumer's `authorizations.bindingTypes`, whose `sensitivity` is at or below its `maxSensitivity`, whose `write` flag is permitted by `writeAllowed`, and which fall inside its declared `roles` and `packages`.

`W0-E2` today implements a five-way intersection with "a test per predicate proving that removing any one of them widens the set." This becomes a six-way intersection with six such tests. That is the whole change — one more predicate in an existing structure.

**Two consequences worth stating so nobody has to rediscover them:**

- **The token-efficiency arithmetic is unaffected in the direction that matters.** Consumer scoping can only *narrow* `tools/list`, so TTFC can only fall. 02 §5.6's O(1)-in-catalogue-size invariant holds unchanged, and 02 §5.7's Case A and Case B numbers remain upper bounds. No Phase 1 or Phase 2 metric needs re-deriving.
- **But a consumer can hide a tool the human legitimately holds.** A support engineer debugging through a restricted client sees a smaller catalogue than their role grants, and if the refusal says "you are not granted this tool" they will chase the wrong thing for an afternoon. **The two refusals must be distinct error codes with distinct wording** — `CONSUMER_NOT_AUTHORIZED` ("your client is not authorized for this binding type / sensitivity / write") versus `TOOL_NOT_IN_SCOPE` ("you are not granted this tool"). This is a UX requirement with a security payoff: it is also the message that tells an operator their client registration is too narrow rather than their role.

#### 1.3.6 Audit — and the hole it closes

`audit_call` gains, in the "who" block:

```
consumer_id, consumer_record_sha, consumer_auth_method, consumer_session_id, human_in_the_loop
```

`consumer_record_sha` is the point: it pins **which version of the consumer's authorizations was in force** for that call, so "what was this agent allowed to do on 3 September" is answerable from the audit row rather than from git archaeology.

And this is what finally feeds `consumption_edge` — `consumer_id` **is** the "consuming agent," authenticated rather than self-declared. 02 §4.6's satellite and 03 §5.3's `/activity/consumption` screen become truthful. G9 @ M1 becomes evidenceable.

#### 1.3.7 One nuance for the Wave 1 OIDC swap

Where an external OAuth issuer is in use (LTM AD from Wave 1), the presented token carries a `client_id` / `azp` claim. The gateway **may** additionally bind the consumer identity to that claim — but that is a *second* assertion, never a substitute for registration, for two reasons: at Wave 0 the local store issues its own JWTs and there is no external client registry at all; and a `client_id` registered in LTM AD is governed by whoever administers that directory, not by MCPForge's approval flow. Registration stays the authority; the claim is corroboration.

---

## 2. Sub-thread 2 — Governance and usage tracking at the consumer level

### 2.1 What Phases 1–4 already cover

| Concern | Where | What it does |
|---|---|---|
| Per-call forensics | 02 §4.6 | An unusually complete audit row, plus the three saved queries 03 §5.3 ships as views. |
| Abandoned intent | 03 §5.3 (Activity) | `phase='plan'` with no matching execute — an anomaly-adjacent view, per call. |
| Rate limiting | 02 §3.1.3 (`rateLimit` guardrail), 02 §4.7 (caps) | **Per human caller, per tool.** Not per consumer, not across tools. |
| Consumption rollup | 02 §4.6, 03 §5.3 | Designed, but unfeedable until §1 lands. |
| Anomaly monitoring | 01 G4 @ M2, W3 exit criterion 5 | *"Security-anomaly monitoring is live and has produced at least one true-positive or a documented zero-finding period."* |

### 2.2 The gap

**01 G4 @ M2 promises security-anomaly monitoring at Wave 3 and nothing anywhere designs it.** There is no mechanism in Phase 2, no screen in Phase 3, and no task in Phase 4. It is a goal with no implementation path — which is the specific shape of commitment this plan's own §6 closing note ("the plan's own honesty mechanisms are the most valuable thing in it") exists to avoid.

Separately, every rate and quota control in the plan is keyed on `(human, tool)`. Nothing bounds what one consumer does **across** tools, and nothing observes a consumer's behaviour as a pattern rather than as a sequence of independently-legal calls. Idempotency (02 §3.1.2) suppresses identical repeats; it does nothing about an agent creating forty *different* vouchers in four minutes, every one of them individually valid.

### 2.3 Design — and the scope discipline that goes with it

Two layers, and the split between them is the important part:

> **Wave 0 ships the substrate: consumer-level counters, the detector interface, three detectors, and the event schema. Wave 3 ships the monitoring product: triage workflow, alert routing, tuning, and the true-positive evidence 01 G4 @ M2 asks for.**

The substrate is schema and therefore blast-radius work that must be early (Phase 4 §1.1 Test 1). The workflow is UI and operations, has no blast radius, and needs real traffic to tune — which Wave 0 does not have. **Do not pull Wave 3's goal forward.** That would be scope inflation wearing a security costume, and this plan has a specific allergy to that.

#### 2.3.1 What gets tracked per consumer

A `consumer_usage` rollup, written from the same outbox transaction as the audit row (02 §4.2 step 9), windowed hourly and daily:

calls · writes · plans minted · plans never confirmed · refusals broken down by error code · distinct tools touched · distinct binding types touched · **distinct human subjects acted for** · bytes out · p95 latency.

This is a rollup of data that is already being written. It is cheap, and it is what makes the consumer's declared `limits` enforceable (`RATE_LIMITED`, with a `next` naming the window and when it resets).

#### 2.3.2 The anomaly patterns that actually matter

Seven, with the reason each earns its place. Each is a declarative detector configured in the overlay with a tunable threshold and a compiled-in hard ceiling — the same shape 02 §4.7 already uses for caps, where a deployment may tighten but never loosen.

1. **Burst write activity.** Writes per consumer per window above N× its trailing baseline, or above its declared `writesPerDay`. **The highest-value detector, because idempotency does not cover it:** identical retries are suppressed, but forty *different* vouchers in four minutes are forty legal calls. A retry loop, a runaway plan, or a prompt-injected agent all look like this.
2. **Off-hours elevated-binding calls.** A `plsql` or `function` write outside the consumer's declared `operatingWindow`. Cheap, and it is the classic first indicator of a credential used by someone other than its owner.
3. **Scope probing.** A rising rate of `TOOL_NOT_IN_SCOPE`, `CONSUMER_NOT_AUTHORIZED` or `ELEVATED_GRANT_REQUIRED` refusals from one consumer. A well-behaved client only calls what `tools/list` handed it, so this rate should sit at approximately zero; a rise means either a broken client or an agent trying doors. Genuinely diagnostic in both directions.
4. **Subject fan-out.** One consumer acting for an unusual number of distinct `caller_subject`s in a window — or, sharper, **a single human subject appearing under a consumer that has never carried them before.** This is the detector that catches a leaked consumer credential being paired with harvested user tokens, and it is only possible because §1 made `consumer_id` an authenticated field.
5. **Identity-echo mismatch rate.** `identity_match = false` occurrences per consumer. 02 §3.5's `echoOn` already records this per call; the *rate* is the anomaly, and a rising one means an instance whose SSO configuration has drifted.
6. **Plan-abandonment ratio.** A high plan:execute ratio per consumer. 03 §5.3 already ships the per-call view; per consumer it is simultaneously a quality signal (an agent proposing things humans keep declining) and a probing signal.
7. **First write to a tool.** The first ever call by consumer C to write-capable tool T. Not an alarm — a low-severity notable event. Cheap, high signal in a young deployment, and it is what makes the first month of a new consumer legible.

**The rule that keeps detectors honest, and it is a hard one:**

> A detector may observe and alert. It may **never** silently change an authorization, a threshold or a scope. The single exception is that a detector configured `severity: critical` may trip the **consumer kill switch** — which is a visible, audited, human-reversible act carrying a reason string, using 02 §4.7's existing mechanism. A loud automatic cut-off is acceptable. A quiet automatic throttle is not, because silent degradation is the failure mode this entire product is built to prevent.

Events land in `anomaly_event(id, ts, consumer_id, detector_id, severity, window, observed, threshold, audit_call_ids[], state)` — referencing the audit rows that triggered them, so every alert is one click from its evidence.

### 2.4 Where this lands in Phase 3's IA — the decision, and the rule behind it

Phase 3 §5.2 has nine top-level destinations and §14 item 5 explicitly defends that count against a seven-destination alternative. A tenth needs a real argument. Phase 3's own criterion for splitting Approvals out of Governance (§5.1 item 2) is *"an approval queue is a place you live and governance configuration is a place you visit."*

Applying their rule rather than inventing one: **consumer registration is a place you visit; consumer behaviour is part of a dataset you already have a place for.** So:

**Decision: no new top-level route. The work splits across two existing surfaces, on a rule that is meant to be quotable.**

> **Governance is where a consumer's authorization is decided. Activity is where its behaviour is observed. Registration is a grant; usage is an event.**

That mirrors the plan's own definitional/runtime and git/store split exactly (02 §10.3), which is why it is the right seam rather than a convenient one.

- **Governance gains a fifth tab: `Consumers`.** The registry view — who is registered, class, owner and steward, compiled authorizations (binding types, sensitivity ceiling, write flag, roles, packages), credential age and next rotation due, registration expiry, status, and the register / suspend / rotate / retire actions. It follows the Roles tab's pattern exactly (03 §5.3 Governance item 1): edit on the left, **the compiled authorization artefact rendered explicitly on the right**, and nothing saves directly — it produces a change proposal whose diff is the compiled artefact. A consumer editor that hides what a consumer may actually reach is the same failure 02 §8.1 item 4 names for the role editor, and it gets the same treatment.
- **Activity gains a `Consumers` view at `/activity/consumers`,** beside the existing `/activity/consumption`. Per-consumer usage over time, quota headroom, detector states, and the anomaly events with links into the calls that triggered them. Activity is already described as *"audit and consumption, which the concept console had as two separate ideas and which are one dataset"* — usage-by-consumer is that same dataset sliced by a field that now exists.
- **Approvals** needs no new UI. Consumer registrations, credential rotations and standing-authorization grants are **definitional approvals** — they are change proposals, and the queue already holds those (03 §5.3 Approvals).
- **Home → "What broke"** gains open critical anomaly events. One list item, no new component.
- **Environments → This deployment** gains the secret-store kind and the count of credentials past their rotation window (§4).

---

## 3. Sub-thread 3 — Binding-type-aware authorization

This is the sharpest of the four, and the user's own phrasing is the specification: *"some tools like PLSQL package based may be opened, but shouldn't be used as open."*

### 3.1 What Phases 1–4 already cover

`bindingType` is a first-class, required, orthogonal manifest field (01 settled decision #4; build spec Rev 3 §1). It already drives four things:

| # | Existing gate | Where | What it governs | When it acts |
|---|---|---|---|---|
| 1 | The **handshake template** — five of them | 02 §3.2–§3.6 | *How the binding authenticates to the target* | Every call |
| 2 | The **review path** — `plsql` and `function` force standard review, expedited is structurally rejected | 02 §2.2 validate rules | *How a tool gets into the catalogue* | Design time, once |
| 3 | The **sandbox harness** | 02 §3.2–§3.6, build spec §1.7 | *How the tool is tested* | Build time |
| 4 | **`database` is read-only by policy** — `write:true` + `binding.type: database` is rejected | 02 §3.3, `W0-B3` | *Whether a whole capability class may exist at all* | Validate time |

Plus two adjacent runtime gates: catalogue visibility via `tools/list` scoping (02 §5.1), and `6e` sensitivity-versus-role-ceiling (02 §4.2).

### 3.2 The gap, stated precisely

**Three of those four gates are keyed on the *definition*, and the two runtime gates are keyed on *sensitivity* and *scope*. None is keyed on binding type at call time.**

Follow it through:

- **Catalogue visibility is necessary and not sufficient** — and the plan itself already proves this, because `forge.invoke` exists specifically as a path to call a tool the client never listed (02 §5.2 item 4). At call time it is re-checked against **scope** (step `6a`), not against binding type.
- **The review path is spent once**, before the tool ever executes. It governs whether `AP_HOLDS_PKG.release_single_hold` is allowed to be a tool. It says nothing about whether *this session*, *right now*, may fire it.
- **Sensitivity is orthogonal to binding type.** A `plsql` tool can perfectly legitimately be `internal` sensitivity. Nothing about reaching an EBS wrapper package raises the sensitivity ceiling that gate checks.

So the state today is: **once a `plsql` or `function` tool is inside a role's scope, any session holding that role executes it exactly as easily as a REST read.** That is "opened, and therefore open." The user is right, and this is a genuine gap.

### 3.3 Design — the binding-authorization stage

#### 3.3.1 Where it goes in the chain

02 §4.2's ordered, fail-closed policy chain is `6a` scope → `6b` probe/kill → `6c` rate → `6d` argument validation → `6e` sensitivity ceiling → `6f` guardrails/SoD → `6g` plan-or-confirm → `6h` idempotency.

**Insert `6e′` — binding-type authorization — immediately after `6e` and before `6f`.**

Reasoning, because inserting a stage into an ordered fail-closed chain is exactly the "an ordering mistake is an authorization bypass" case Phase 4 §1.3 flags:

- It is a **grant check**, of the same family as `6a` and `6e`. Keeping the grant checks contiguous makes the chain's structure legible: grants first, business rules after. A reviewer can see where the boundary is.
- It must sit **before `6g`**, so an unauthorized binding type can never mint a plan token. A minted token for a call that will be refused is a confusing artefact at best and a replay surface at worst.
- **The alternative was considered and rejected:** placing it before `6c` (rate limit) so an unauthorized call does not consume rate budget. Rejected because the chain's own precedent already puts argument validation (`6d`) ahead of the ceiling check (`6e`), and because a probing consumer burning its own rate budget is arguably the correct outcome rather than a cost.

#### 3.3.2 Two postures, and exactly what "stricter" means

| | **Standard posture** | **Elevated posture** |
|---|---|---|
| **Which bindings** | `rest`; `database` (read-only by policy); `wrapped-vendor` where the vendor surface is read-only | **`plsql`**, **`function`**, any write-classified `wrapped-vendor` tool, and **any tool carrying a `policyException`** (see §3.4) |
| **Grant model** | **Default-allow within the role's scope.** Being in scope *is* the grant. | **Explicit allow-list grant required.** A role (or consumer) must name the binding type in `bindingGrants`; scope membership alone is never sufficient. For `plsql` the grant additionally names the **wrapper package** (`MCPFORGE_WRAP.<PKG>`); for `function`, the orchestration family. |
| **Approval** | The tool's own `humanApprovalRequired` governs. | **`humanApprovalRequired` is forced true for every write**, overriding the tool's own default — *unless* the grant carries a `standingAuthorization` (§3.3.4). |
| **Consumer** | Any registered consumer with the binding type authorized. | Additionally requires `attestation.humanInTheLoop: true`, or the write is refused outright. |
| **Anomaly thresholds** | Detector defaults. | Burst threshold halved; off-hours calls notable by default; first use of a wrapper package is always an event. |
| **Grant lifetime** | None — it is scope. | **Grants expire** (default 180 days). Renewal is a re-approval, not a rollover. |
| **Refusal** | n/a | `ELEVATED_GRANT_REQUIRED`, with a `next` naming the grant needed and the approver who can issue it. |

`bindingGrants` lives on the role (and optionally the consumer), is compiled by `forge codegen` into the role's scope artefact alongside the tool-id list, and therefore **shows up as a diff in the change proposal** — the same governance property 02 §4.3 built role compilation for. Widening a binding grant is as visible as widening a role.

#### 3.3.3 The gateway grant and the database grant, reconciled

For `plsql`, the elevated grant names the wrapper package. That is deliberately the same unit the database-side control already uses: 02 §3.4 requires the MCPForge database user to hold `EXECUTE` on the **wrapper only**, and the probe already asserts both halves (wrapper grant present, direct APPS grant absent).

Naming the package at the gateway means the gateway's grant and the database's grant are **two independent statements of the same fact**, which makes them reconcilable:

> A gateway `bindingGrant` naming a wrapper package for which the database holds no `EXECUTE` grant — or a database `EXECUTE` grant with no corresponding gateway grant — is a **probe finding**, reported per tool with its owning team.

That extends 02 §4.5's existing `plsql` probe checks by one line rather than inventing a mechanism, and it catches the drift case that neither control catches alone. It is built in Wave 0 and exercised in Wave 2, when `plsql` bindings actually land — the same "build the seam early, prove it when it is needed" discipline `W0-C5` (Postgres parity) and `W0-D3` (dual identity providers) already apply.

#### 3.3.4 `standingAuthorization` — the pivot that makes this implementable

Without an escape hatch, the elevated posture forces per-call human approval on **all six of Wave 0's write tools**, because every Wave 0 binding is `function`. That would make the Wave 0 demo a parade of approval dialogs and would be an absurd outcome for a design whose point is to make governance real rather than obstructive.

So:

> A role × binding-type grant may carry `standingAuthorization: <approvalRef>` — a recorded, expiring, named-approver decision that this role may execute this binding type's writes through the ordinary plan → confirm path without a per-call approval.

The properties that keep it from becoming theatre:

- It is an **approval record in `approvals/`**, committed, with a named approver — Wave 0 exit criterion 8's machinery, reused.
- It appears in the **compiled scope diff**, so granting one is as visible as widening a role.
- It **expires** (default 180 days) and renewal is a fresh approval.
- **It removes nothing else.** Plan → confirm still runs. Guardrails still run. SoD still runs. The identity requirement is untouched. It substitutes a standing approval for a per-call one, and that is all it does.

**This is the design's hinge: the gate is on by default, and turning it off is itself a governed, recorded, expiring act.** Both failure modes around it are worth naming explicitly for the build lane: implement the elevated posture and forget the standing authorization, and Wave 0 looks broken; implement the standing authorization and forget that it must be recorded and expire, and the gate is decoration.

#### 3.3.5 The discovery consequence — reusing the disabled-tool resolution

An agent should learn it lacks a grant **before** it constructs arguments, or "no dead ends" (01 G5, W0 exit criterion 11) is not honoured.

**Do not add a field to the tool card.** The card is budget-measured at 54 tokens against a ≤60 ceiling (02 §5.3) and has almost no headroom. Instead, reuse the resolution 02 §4.5 already reached for disabled tools, verbatim:

> A tool the session lacks the elevated grant for is **excluded from `tools/list`** — it falls out of the six-way intersection automatically, so no new mechanism — but remains **findable through `forge.find`**, which returns its card with a per-result `access: "requires_grant"` and an `agentMessage` naming the grant and the owning approver.

Zero new mechanism, zero card cost. The `access` field rides on the **find response** rather than inside the card object, costing ≤6 tokens per result — about 25 tokens on a five-result find. Against a cold TTFC of ~1,460 versus a 4,000 budget that is immaterial, but it **must be accounted for deliberately in the MTB gate (`W0-G5`) rather than discovered as a budget failure**, and that is called out in §6 as a task modification.

#### 3.3.6 `forge.invoke` — the sharpest test of the whole idea

`forge.invoke` executes any tool the caller is granted through "the identical policy chain" (02 §5.2 item 4), and `W0-E8`'s privilege-escalation suite already tests calling an *unlisted* tool through it. Extend that suite with the case that is the literal statement of the user's concern:

> Call an elevated-binding tool for which the session holds **no** elevated grant, through **both** entry points — a direct `tools/call` and `forge.invoke` — and both must refuse with `ELEVATED_GRANT_REQUIRED`.

That test is "opened but not open" made executable.

### 3.4 Reconciling with "`database` bindings are read-only by policy"

This was the explicit question. The answer:

> **The elevated-grant concept sits *alongside* the read-only rule. It does not subsume it, and it extends it in exactly one place.**

Three reasons it sits alongside rather than replacing:

1. **Different times, different failure modes.** The read-only rule is a **validate-time structural rule** — a `write:true` + `database` manifest cannot be brought into existence (`W0-B3`). The binding-authorization stage is a **runtime authorization**. They do not overlap; one prevents a capability from existing, the other constrains one that must.
2. **They are answers to different questions.** The read-only rule can remove an entire capability class because the estate loses nothing — every Oracle application that supports writing supports it through an API package (02 §3.3). You cannot make the same move for `plsql`, because the estate genuinely needs PL/SQL writes. **The elevated posture is, for `plsql` and `function`, what "read-only by policy" is for `database`:** the strongest available constraint on a class that cannot simply be removed.
3. **`database` therefore stays standard posture, and adding an elevated grant on top would be cost with no risk reduction.** It is already the most caged binding of the five by construction — no dynamic SQL ever, statement loaded by hash, parameters bound never interpolated, a mandatory row cap enforced twice, a read-only transaction, and Resource Manager caps (02 §3.3). Layering a grant model over a binding that has no write path is ceremony, and this plan does not do ceremony.

**The one extension, and it closes a real hole.** 02 §3.3 carries a single exception path: a non-application, MCPForge-owned or customer-owned store where DML is genuinely appropriate, permitted by an explicit `policyException: <approvalRef>` in the manifest. Today that exception is granted at definition time and the tool then behaves like any other at runtime.

> **Any tool carrying a `policyException` is elevated posture, regardless of its binding type.**

One line, and it means the only write path that escapes the read-only rule is also the one that cannot be executed without a named, expiring, approval-recorded grant. That strengthens an existing decision instead of restating it.

---

## 4. Sub-thread 4 — Application credentials and secrets

### 4.1 What Phases 1–4 already cover

| Concern | Where | What it says |
|---|---|---|
| Overlays hold references, not values | 02 §6.3 | An overlay may contain `secrets.ref` — *"references to a secret store; never secret values."* |
| Secrets come from a store | 02 §6.6 | *"Secrets come from the platform's secret store, referenced by the overlay, never in an image or a repo."* One sentence. |
| Per-user OAuth token cache | 02 §3.2 | Cached per `(subject, resource, scopeSet)`, encrypted at rest with a per-deployment key, evicted on logout. |
| A dedicated per-module DB user | 02 §3.3 | Read-only, named-object grants only, probe-asserted to hold no write grants. |
| The wrapper-schema grant model | 02 §3.4 | `MCPFORGE_WRAP`, `AUTHID DEFINER`, no APPS grants, probe-asserted. |
| Worker authentication | 02 §1.3 | *"authenticated with a per-boot shared secret."* |
| No service-account fallback | 02 §4.4, CLAUDE.md §2 item 1 | A missing target-identity mapping is a hard `IDENTITY_UNRESOLVED` failure. Lint-enforced. |

### 4.2 The gap

There are two sentences about a secret store and no design. Specifically missing: **what the store is at Wave 0**, **what a reference looks like**, **who may resolve one to a value**, **rotation policy**, **blast-radius containment**, and **what happens when a credential leaks**. `overlay-purity` (02 §6.3, `W0-K3`) enforces file *types* under `overlays/**` — it does not inspect content, so a pasted password in a `config.yaml` value passes CI today.

**One honest observation that shapes the whole answer:** Wave 0's credential surface is genuinely small. Every Wave 0 binding is `function` with per-user AIS tokens via SSO, so the stored set is roughly the JDE token-provider client credential, the local JWT signing key, the confirm-token HMAC key, the worker's per-boot shared secret, and the new consumer credentials from §1. **The large application-credential surface — EBS wrapper schemas, per-module database users — lands in Wave 2.** So the correct Wave 0 shape is: build the abstraction and handle the small real set; the estate-scale credential inventory arrives with the bindings that need it.

### 4.3 Design — `SecretStore` as the third pluggable seam

This architecture has established a pattern twice: `IdentityProvider` (02 §4.4) and `ChangeHost` (02 §10.1). `SecretStore` is the third instance of it, and saying so is not decoration — it means the build lane already knows the shape, and it means the migration discipline is already decided.

```ts
interface SecretStore {
  get(ref: SecretRef): Promise<SecretValue>;                       // resolvable only inside adapters/
  metadata(ref: SecretRef): Promise<{ createdAt; rotatedAt; expiresAt; version }>;  // safe to log
  rotate(ref: SecretRef): Promise<SecretRef>;                      // returns the new version
  list(): Promise<SecretRef[]>;                                    // refs only, never values
}
```

**`SecretRef` format:** `secretRef://<scope>/<subject>/<purpose>` — e.g. `secretRef://binding/ebs-p2p-ap/wrapper-schema`, `secretRef://consumer/claude-desktop-coe/client`, `secretRef://gateway/confirm-token/hmac`.

> **A `SecretRef` is the only form a credential ever takes in git, in a manifest, in an overlay, in a consumer record, in an audit row, in a log line, in a portal screen, in a CLI output, or in any planning document including this one.**

#### 4.3.1 Implementations, and what is built when

- **Wave 0 default — `EncryptedFileStore`.** An age/libsodium-sealed file at `./.mcpforge/secrets.age`, alongside the runtime database and `.gitignore`'d with it, unlocked by a key held in the OS keychain (DPAPI on Windows — which is where this builds — Keychain on macOS, libsecret on Linux), with an environment-variable key **for CI only**.
  *Why this rather than the OS keychain directly:* local-first must also work headless, in CI and in a container, and a sealed file with an OS-held key satisfies both while remaining one artefact to back up or destroy. *Why this rather than a `.env`:* it is the difference between a credential and a file anyone can read.
- **`OsKeychainStore`** — a second Wave 0 implementation for interactive development, contract-tested against the same suite.
- **`OciVaultStore`** — the named production target, **not built in Wave 0**, because building it would make an OCI service a Wave 0 prerequisite and that is a settled decision (02 §10.1 item 2). The **contract suite is written in Wave 0** and the OCI implementation is the only missing piece — exactly the discipline `W0-C5` applies to the Postgres dialect and `W0-D3` to the OIDC provider. Two precedents, same pattern, no new argument needed.

#### 4.3.2 The six rules

1. **No secret value crosses the git boundary.** `overlay-purity` (`W0-K3`) gains a **content** check: any high-entropy string, PEM header, or `password:` / `secret:` / `token:` / `key:` key whose value is not a `secretRef://` URI, under `overlays/**`, `manifests/**`, `roles/**`, `packages/**` or `consumers/**`, **fails the build with the file and line named.** Extend the existing job; do not add a new one.
2. **No secret value is returned above the adapter layer.** `SecretStore.get()` is callable only from `adapters/**` and `core/gateway/identity/**`, at call-construction time. Enforced by a fourth guard lint rule, **`no-secret-value-escape`**, sitting beside `no-service-account-fallback` — because that is how this codebase enforces its absolute rules (02 §7.2 stage 1, `W0-A3`).
3. **Secrets are audited by reference and version, never by value.** `audit_call` gains a `credential_refs[]` normalised side table — `audit_credential_ref(call_id, secret_ref, version)` — following the same normalisation precedent 02 §10.4 items 2 and 3 set for result keys and roles. This makes *"which calls used the credential that just leaked?"* a one-hop indexed query, which is the same design instinct 02 §4.6 applied to business keys.
4. **One credential per (binding × module × environment).** Never one shared credential across modules. **This is a generalisation of a decision already taken, not a new one** — 02 §3.3 already requires "a dedicated, per-module, read-only database user." Applying the same rule to every binding type is the blast-radius control: a leaked EBS AP wrapper credential exposes the AP wrapper package set in one environment, not the estate.
5. **Rotation is scheduled, tested and visible.** Defaults: consumer client credentials **90 days**; binding credentials **180 days**; the local JWT signing key **90 days** with JWKS-style overlap; the worker shared secret **per boot** (already true). And the one that is easy to get wrong: the **confirm-token HMAC key rotates at 90 days with a dual-key overlap window** — the retired key is accepted for *verification only* for one plan TTL plus a margin, because a hard cutover invalidates every in-flight plan token and turns a routine rotation into a self-inflicted outage. A credential past its interval is an amber finding in Governance → Consumers and Environments; past **2×** its interval it raises an anomaly event. `forge secrets status --json` reports age and next-due for every ref, and rotation may not be silently skipped.
6. **Emergency revocation is one act.** `forge secrets revoke <ref> --reason "…"` invalidates the value **and kill-switches everything referencing it in the same operation**, using 02 §4.7's flags mechanism. A revoked credential that leaves its dependents running and failing mysteriously is worse than no revocation command at all.

### 4.4 Reconciling with "no service-account fallback" — confirmed, and sharpened

The distinction offered in the brief is **correct, and I am confirming rather than correcting it.** The principle is about **substitution**, not about **storage**:

> "No service-account fallback" forbids the gateway from **substituting** a shared identity when a per-user identity should have been resolved and was not. It has never forbidden a binding from **holding a credential of its own** where the target structurally cannot carry per-user identity — 02 §3.3 and §3.4 already depend on exactly that, with a per-module read-only database user and a `MCPFORGE_WRAP` execute grant. What keeps those consistent is that the credential is not an identity substitute: the human's identity is still resolved, still required, still carried into the target by a named compensating control (`CLIENT_IDENTIFIER`; `FND_GLOBAL.APPS_INITIALIZE` from a git-managed mapping), still written to audit, and a missing mapping is still a hard `IDENTITY_UNRESOLVED` failure.

**But the distinction is currently implicit, and an implicit version of an absolute rule is how the rule erodes.** A future implementer reading *"there is no service-account fallback anywhere in this codebase"* next to a stored EBS wrapper credential will reasonably conclude that one of the two is wrong — and will resolve it in whichever direction is more convenient that afternoon. So make it explicit, and phrase it as a **test** rather than a slogan:

> **A stored credential is legitimate only when all four hold:**
> 1. **The binding type structurally cannot carry per-user identity**, as reported by the probe — never as asserted by a human or a manifest.
> 2. **A per-user identity is nonetheless resolved for the call**, and a missing or ambiguous mapping is a hard failure.
> 3. **A named compensating control carries that identity into the target**, and is echoed back into the audit record.
> 4. **The credential is scoped to one module and one environment.**
>
> **If any of the four fails, the credential is a service-account fallback and is forbidden.**

The reason this is worth doing rather than just asserting: **all four are checkable from data the system already holds.** (1) is `identity.carries` in the probe report. (2) is the git-managed mapping and `IDENTITY_UNRESOLVED`. (3) is `compensating_control` — already a column in `audit_call` (02 §4.6). (4) is the `SecretRef` scope. So the four-part test becomes a `forge validate` rule plus a case in the privilege-escalation suite, not a paragraph nobody reads.

**One supporting field.** Add `binding.credentialClass: per-user-exchanged | module-scoped-stored | none` to the manifest, with two validate rules: reject `module-scoped-stored` on a binding whose probe reports `identity.carries: verified` (if identity carries, a stored credential is unnecessary blast radius), and reject `per-user-exchanged` on `plsql` (it is structurally impossible). Small, structural, and in the same family as the ~40 rules that already exist.

---

## 5. Placement, effort and risk

### 5.1 The decision

> **Wave 0, with two named carve-outs.**

### 5.2 Why Wave 0

Five arguments, all of them made from the plan's own logic rather than from general security preference:

1. **The write-parity precedent applies verbatim.** 01 §10 took a security-shaping request and applied it retroactively to Wave 0 rather than deferring it, on the reasoning that discovering the design is wrong later — with N tools live — is the worse failure. This is the same category of request from the same person about the same product.
2. **Two of these artefacts have maximal blast radius and both are Wave 0 artefacts.** `consumer_id` is a **column in `audit_call`**; `ConsumerAuthorized` is a **predicate in `visible(session)`**. Adding an audit column at Wave 2 means a migration *and* a hash-chain discontinuity — `row_hash` covers row content, so a schema change mid-chain is genuinely awkward — plus a consumption graph with a hole in its history. Adding a sixth predicate to a five-predicate intersection later is surgery on the security spine. Both are Phase 4 §1.1 **Test 1** in its purest form.
3. **It is entirely inside the 70%.** Gateway, policy, audit, store, portal, CLI. Zero customer dependency, zero app-side enablement, so it cannot block on the thing that actually gates waves (01 §1). By the plan's own sequencing rule, that makes it eligible to be early.
4. **A Wave 0 screen is currently unable to tell the truth.** 03 §5.3 ships `/activity/consumption` in Wave 0 and there is no authenticated source for "agent." Shipping it without consumer registration means shipping a screen that renders a self-declared value as if it were verified — which is the precise failure mode 03 §1 principle 2 ("nothing is true until the manifest says so") and 02's `identity.carries: verified` rule exist to prevent.
5. **Exit criterion 5 is only half-proved without it.** *"The gateway is the only door"* is currently evidenced for egress only. Front-door admission is undefended.

### 5.3 What is carved out, and why

1. **The anomaly-monitoring product stays at Wave 3**, where 01 G4 @ M2 and W3 exit criterion 5 already put it. Wave 0 ships the counters, the event schema, the detector interface and three detectors. Wave 3 ships triage, alert routing, threshold tuning and the true-positive evidence. **Rationale:** the substrate is schema (Test 1, must be early); the workflow is UI and operations (no blast radius) and needs real traffic to tune, which Wave 0 does not have. Pulling Wave 3's goal forward would be scope inflation dressed as security.
2. **`OciVaultStore` is not built in Wave 0** — that would make an OCI service a Wave 0 prerequisite, contradicting a settled decision. The interface, the contract suite and two local implementations are Wave 0; the OCI implementation is a Wave 1 / production task. Same shape as `W0-C5` and `W0-D3`.

### 5.4 Effort delta — and why it is far cheaper than the write-parity correction

**Estimate: +12–15% on Wave 0.** Set against the write-parity correction's 1.6–2.0×, that is a small increment, and the reason is worth stating because it is the strongest evidence that this design fits rather than fights the architecture:

**Almost everything here extends a mechanism that already exists rather than adding one.**

| New capability | What it actually reuses |
|---|---|
| Consumer record | A git artefact validated by `forge validate` and compiled by `forge codegen` — track B's existing engine |
| Consumer registration approval | The existing definitional-approval flow, change proposal and `approvals/` record |
| Consumer suspension | A **fifth granularity** on the existing four-granularity kill switch and its 5-second poll |
| Consumer check | A **sixth predicate** on an existing five-predicate intersection, plus one more stage in an existing eight-stage chain |
| Consumer audit fields | Additional columns on a table being designed anyway, **before any row exists** |
| Governance → Consumers | The Roles tab's edit → compiled-view → propose pattern |
| Activity → Consumers | The Activity table with one more filter over a field that now exists |
| `SecretStore` | The third instance of a pluggable-seam pattern used twice already |
| Secret content scan | An extra check inside the existing `overlay-purity` job |
| Detector thresholds | The overlay tighten-never-loosen pattern from 02 §4.7's caps |

The genuinely new build is four things: the binding-grant model and its compiled artefact; the elevated-posture rule set; the secret store with rotation; and the detector substrate.

**Task arithmetic: 96 → 111 tasks.** 15 new (one new track N plus one human gate) and 17 modified. Model split moves from 34 Opus / 55 Sonnet / 7 human to **43 Opus / 60 Sonnet / 8 human**. The Opus share of automated tasks rises from ~38% to ~42%, concentrated — correctly — in the new front-door and grant machinery. Full task-by-task detail and routing rationale is in §6.6.

### 5.5 Risk delta — six named risks

1. **Chain-order risk.** Inserting stages into an ordered fail-closed chain is exactly Phase 4 §1.3's *"an ordering mistake is an authorization bypass."* → Opus, and `W0-E3`'s **existing** fault-injection test must be *extended* to cover the new stages rather than a parallel test added beside it. Two test suites over one chain is how an ordering regression hides.
2. **Audit schema churn — the one that gets expensive if mishandled.** The consumer and credential-ref columns must land **inside `W0-C2`, before the first audit row exists**, not as a later migration. This is a **sequencing constraint, not merely a task**: `W0-C2` must not be marked done until it carries them. If the execution pass files this as a separate later task, the hash chain acquires a schema discontinuity and Wave 0's integrity story gets a footnote it does not need.
3. **Wave 0 demoability.** Six `function` write tools under the elevated posture with no standing authorization would require a human approval on every single write. **The `p2p × function` standing-authorization record is a required Wave 0 deliverable, not an optional one** — and it must be a real, recorded, expiring approval so the mechanism is exercised rather than disabled. Both adjacent failure modes are named in §3.3.4.
4. **Bootstrap deadlock.** The portal is a consumer of the gateway API. A gateway that refuses unregistered consumers, on a fresh clone with nothing registered, is a build lane stalled at 2am for a boring reason. `forge dev` self-registers `portal-local` in environment class `local` only — and the env-class check is the adversarial part, because getting it wrong means silent self-registration in production.
5. **Token-budget accounting.** The `access` field on find results costs ≤6 tokens per result. Immaterial against the budgets, **but it must be accounted for deliberately in `W0-G5` and `W0-G7`** rather than surfacing as a mysterious MTB gate failure.
6. **Support legibility.** Consumer scoping can hide a tool a human legitimately holds. `CONSUMER_NOT_AUTHORIZED` and `TOOL_NOT_IN_SCOPE` must be distinct codes with distinct wording, or the first support incident costs an afternoon. This is the cheapest of the six to get right and the easiest to get wrong.

### 5.6 Should anything be cut to compensate?

**Recommendation: no cut to Wave 0's functional scope. If time pressure materialises, take the trim from the portal's lower tier using the rule Phase 3 already set.**

03 §14's closing note already declares the trim order: *"if portal scope has to be trimmed in Wave 0, trim Insights and Home, never the write path."* That rule survives unchanged, and the new surfaces slot into it explicitly:

> **Trim order, ranked:** `W0-J20` Insights → `W0-J19` Home → `W0-N13` Activity → Consumers. **Never** the write path, **never** Governance → Consumers, **never** the policy-chain or secrets tasks.

The justification for placing the two new consumer surfaces *above* Insights: Insights charts metrics that are **already CI-gated** — a failing SA@1 fails the build whether or not anyone can see a chart of it. Governance → Consumers is the **only** place a governance owner can see who is connected and what they may reach, and there is no CI gate substituting for it.

**And explicitly do not trim a read tool for this.** 01 §10.5 item 6 already designates read tools as Wave 0's trim frontier for the write-parity correction. Spending the same trim budget twice would be dishonest accounting, and it would quietly return Wave 0 to proving the wrong half.

---

## 6. Exact instructions for the Sonnet execution pass

**You are applying a dated correction to six files. Read this whole section before editing anything.**

### 6.0 The rules of this pass — non-negotiable

1. **Never silently rewrite history.** This plan has used the dated-correction-marker pattern three times (01 §10 applied by Phase 2; 02 §10 applied by Phase 4; 01 §4.1's superseded write-scope bullet). Follow it exactly:
   - **Superseded text stays where it is**, with an inline blockquote marker immediately above or below it.
   - **The new content is appended as a new numbered section at the end of the document**, before the closing italic footer line.
   - The marker names what supersedes it and the date.
2. **The exact marker wording to use**, adapted per location:
   > **SUPERSEDED / EXTENDED by §N — Correction applied by Phase 5, 27 Aug 2026. See §N.**
   Use **SUPERSEDED** where the old text is now wrong. Use **EXTENDED** where the old text remains true but is no longer complete. Most markers in this pass are **EXTENDED**, because Phase 5 adds rather than reverses — say so honestly rather than over-claiming supersession.
3. **Date everything "27 Aug 2026 — Phase 5."**
4. **Do not renumber existing sections, tasks, exit criteria, error codes, or table rows.** Append. The one exception is the policy-chain stage labels, which use primed suffixes (`6a′`, `6e′`) precisely so nothing renumbers.
5. **Do not edit the concept-console build spec, `mcpforge-console_1.html`, or anything in project memory** other than the one memory update named in §6.8.
6. **If a passage you are told to mark does not exist verbatim**, do not guess and do not skip: apply the marker to the nearest containing subsection and note the discrepancy in your output.

---

### 6.1 `01_GOALS_AND_ROADMAP.md`

#### 6.1.1 Inline markers (5)

| # | Location | Marker type | Exact placement |
|---|---|---|---|
| 1 | §0, the list "Inherited, settled, not to be re-litigated", **item 9** (*"The MCP layer never holds more privilege than the human using it."*) | **EXTENDED** | Append to the item, on the same line: *"— **EXTENDED by §11 (Phase 5, 27 Aug 2026):** and no call is accepted from an unregistered consumer, regardless of the human identity it presents."* |
| 2 | §2, **G2 @ M0**, the sentence *"Every call carries a resolved caller identity."* | **EXTENDED** | Blockquote line immediately after the M0 bullet: *"**EXTENDED by §11 — Phase 5, 27 Aug 2026.** M0 additionally requires that every call carries a **registered, active, authorized consumer** as well as a resolved human identity, and that an unregistered consumer is refused at session establishment."* |
| 3 | §2, **G4 @ M2**, the sentence *"Security-anomaly monitoring is live and has produced at least one true-positive or a documented zero-finding period."* | **EXTENDED** | Blockquote line after the M2 bullet: *"**EXTENDED by §11 — Phase 5, 27 Aug 2026.** The monitoring *substrate* — consumer usage counters, the `anomaly_event` schema, the detector interface and three detectors — is Wave 0 scope. The monitoring *product* named here remains M2/Wave 3."* |
| 4 | §7, **Wave 0 exit criterion 5** (*"Gateway is the only door: a direct call to a module server from outside the trust boundary is refused"*) | **EXTENDED** | Blockquote line immediately after criterion 5: *"**EXTENDED by §11 — Phase 5, 27 Aug 2026.** Criterion 5 as written evidences the **egress** door only. §11.5 adds the ingress half as new criterion **14**; both are required to close Wave 0."* |
| 5 | §8, **R1** and **R2** (the identity risks) | **EXTENDED** | One blockquote line after R2: *"**EXTENDED by §11 — Phase 5, 27 Aug 2026.** R1 and R2 concern *which human* a call acts as. §11 adds R15 and R16, which concern *which software* is making it and how the credentials behind non-identity-carrying bindings are held."* |

#### 6.1.2 Append a new `## 11.` section

Insert **immediately before** the closing italic line *"MCPForge · BlueVerse ValueMesh · LTM Oracle AI Practice. Phase 1 of 4 — goals and roadmap…"*, and after 01 §10's own closing italic line. Title it:

`## 11. Correction applied by Phase 5, per user direction, 27 Aug 2026 — consumer registration, binding-type authorization, usage governance and credentials`

Open with the same status paragraph shape §10 uses, stating that §11 **extends** §0 item 9, G2 @ M0, G4 @ M2, exit criterion 5, and adds exit criterion 14 and risks R15–R16; that nothing else changes; and that superseded text is left in place with inline markers.

Then these subsections, drawing content from §§1–5 of this document (`05_GOVERNANCE_ACCESS_CONTROL_AND_CREDENTIALS.md`) — summarise, do not transcribe wholesale; §11 should be roughly 1.5–2 pages and point at `05` for the full design:

- **§11.1 What the user said** — the verbatim quote from §0 of this document, and the four sub-threads named in one line each.
- **§11.2 The correction, in one paragraph each:** the consumer registry as a second principal composed with (never substituting for) per-user identity; the binding-authorization stage and the two postures; consumer-level usage tracking and the detector substrate; the `SecretStore` seam and the four-part stored-credential test.
- **§11.3 Goal amendments** — restate the G2 @ M0 and G4 @ M2 extensions from the markers above, plus: **G3 gains, at M0**, *"every binding whose probe reports that identity does not carry natively holds a credential that passes the four-part legitimacy test in `05` §4.4, and that test is a `forge validate` rule and a privilege-escalation case — not a paragraph."* And **G9 @ M1 gains** a one-line note that the consumption graph's "consuming agent" is now an **authenticated** `consumer_id` rather than a self-declared value, which is what makes G9 evidenceable at all.
- **§11.4 Wave 0 placement, effort and risk** — the decision, the five reasons, the two carve-outs, the +12–15% estimate and the six named risks. Condense §5 of this document to about half a page and cite `05` §5 for the full reasoning.
- **§11.5 New Wave 0 exit criterion 14.** Write it verbatim as:

> **14. The front door is closed and elevated bindings are not open.** All four demonstrated in a live run:
> **(a)** A call presenting a valid user identity from an **unregistered** consumer is refused at session establishment with `CONSUMER_UNREGISTERED`, and no `tools/list` is served.
> **(b)** A registered consumer **suspended mid-session** is refused on its next call within the kill-switch poll interval, with `CONSUMER_SUSPENDED`.
> **(c)** An **elevated-binding tool held in the caller's role scope but with no elevated grant** is refused with `ELEVATED_GRANT_REQUIRED` through **both** a direct `tools/call` and `forge.invoke`, and is absent from `tools/list` while remaining findable through `forge.find` with its `agentMessage`.
> **(d)** A **consumer registration, a standing authorization and a credential rotation** each produced an approval record in `approvals/`, and each is visible as a compiled-artefact diff in its change proposal.

- **§11.6 New risks R15 and R16:**
  - **R15 — Consumer credential compromise.** *Owner: Phase 2/build.* A leaked consumer credential is the new highest-value single secret in the system: it is the front door. Mitigations are the four-part scoping rule, 90-day rotation, `secretRef` discipline, the subject-fan-out detector, and one-act revocation. *If ignored:* the registration layer becomes a single shared key and re-creates, at the ingress, exactly the service-account problem the identity design eliminated at the egress.
  - **R16 — Grant expiry becomes a rubber stamp.** *Owner: checkpoints, agenda item 7.* Elevated grants and standing authorizations expire at 180 days by design. The failure mode is not expiry — it is renewal becoming a batch click. **Every checkpoint must report the renewal rate and the proportion renewed without a stated reason**, and a renewal rate approaching 100% with no declines is itself the finding. *If ignored:* the expiry mechanism becomes ceremony and the elevated posture quietly becomes the standard posture.
- **§11.7 Closing line** in the same form §10 uses: *"Correction applied by Phase 5, per user direction, 27 Aug 2026."*

---

### 6.2 `02_TECHNICAL_ARCHITECTURE.md`

This is the largest set of edits. **Note the document already has a §10 appended by Phase 4; the new section is §11 and goes after it**, before the final italic footer.

#### 6.2.1 Inline markers (9)

| # | Location | Marker | Placement and exact text |
|---|---|---|---|
| 1 | §3.3, the boxed rule *"A `database` binding may not be write-capable…"* | **EXTENDED** | Immediately after the box: *"**EXTENDED by §11.4 — Phase 5, 27 Aug 2026.** This rule is unchanged and is not subsumed by the new binding-authorization stage; §11.4 states why `database` stays standard posture. The single exception path below (`policyException`) **is** elevated posture regardless of binding type."* |
| 2 | §3.3, the paragraph beginning *"The single exception path is a non-application, MCPForge-owned or customer-owned data store…"* | **EXTENDED** | Append one sentence: *"**(Phase 5, 27 Aug 2026:** any tool carrying a `policyException` is **elevated posture** and requires an explicit, expiring, approval-recorded grant to execute — see §11.4.)"* |
| 3 | §4.2, the request-path code block | **EXTENDED** | Blockquote immediately below the block: *"**EXTENDED by §11.2 and §11.4 — Phase 5, 27 Aug 2026.** The path gains step **`[2a]` consumer authentication and registration check** between `[2]` and `[3]`, and the policy chain gains **`6a′` consumer active and authorized** and **`6e′` binding-type authorization`. The updated chain is in §11.4.2. Stage labels are primed rather than renumbered so every existing reference stays valid."* |
| 4 | §4.4, the four numbered rules under *"The principle, as enforced code"*, specifically **rule 2** (*"There is no service-account fallback anywhere in the codebase"*) | **EXTENDED** | Blockquote after rule 4: *"**EXTENDED by §11.5 — Phase 5, 27 Aug 2026.** Rule 2 is about **substitution**, not storage, and §11.5 makes that explicit as a four-part test rather than leaving it implicit. A binding that structurally cannot carry per-user identity may hold a scoped credential; it may never be used as a substitute for an identity that should have resolved and did not."* |
| 5 | §4.5, the probe checks table, the `plsql` row | **EXTENDED** | Add one line under the table: *"**EXTENDED by §11.4.4 — Phase 5, 27 Aug 2026.** The `plsql` probe additionally reconciles the gateway's compiled `bindingGrants` against the database-side `EXECUTE` grants and reports any grant present on one side only. Built at Wave 0, exercised at Wave 2."* |
| 6 | §4.6, the `audit_call` SQL block, the `-- who` block | **EXTENDED** | Blockquote after the SQL block: *"**EXTENDED by §11.3 — Phase 5, 27 Aug 2026.** The `who` block gains `consumer_id`, `consumer_record_sha`, `consumer_auth_method`, `consumer_session_id` and `human_in_the_loop`; a new `audit_credential_ref(call_id, secret_ref, version)` satellite joins the others. **These land inside `W0-C2`, before the first audit row exists** — a later migration would put a schema discontinuity in the hash chain."* |
| 7 | §4.6, the `consumption_edge` satellite mention | **EXTENDED** | Append: *"**(Phase 5:** `consumer_id` is what feeds this satellite. Before Phase 5 there was no authenticated source for its 'consuming agent' value — see `05` §1.2.)"* |
| 8 | §4.7, *"A `runtime_flags` table … with entries at four granularities: **tool · module server · binding type · whole deployment**"* | **EXTENDED** | Inline immediately after: *"**— EXTENDED by §11.2 (Phase 5, 27 Aug 2026): five granularities. `consumer` joins the list.** `forge kill consumer:<id> --reason "…"`."* |
| 9 | §6.3 and §6.6, the two sentences about secrets (*"`secrets.ref` (references to a secret store; never secret values)"* and *"Secrets come from the platform's secret store, referenced by the overlay, never in an image or a repo"*) | **EXTENDED** | One blockquote after each: *"**EXTENDED by §11.5 — Phase 5, 27 Aug 2026.** The store itself, the `secretRef://` format, rotation policy, blast-radius scoping and the emergency-revocation path are designed in §11.5. `overlay-purity` gains a **content** check, not only a file-type check."* |

#### 6.2.2 Append a new `## 11.` section

Title: `## 11. Correction applied by Phase 5, per user direction, 27 Aug 2026 — consumer registration, binding-type authorization, usage governance and credentials`

Open with a status paragraph naming exactly the nine locations marked above, stating that §11 **extends** rather than reverses them, and that superseded/extended text is left in place.

Subsections, with the full technical content — **this is the section the build lane will actually implement from, so it carries the detail, unlike 01 §11**:

- **§11.1 What the user asked, and what was already covered.** The verbatim quote. Then a short table: for each of the four sub-threads, "already covered by" and "the gap." Take it from `05` §§1.1/1.2, 2.1/2.2, 3.1/3.2, 4.1/4.2.
- **§11.2 The Consumer Registry.** Full content of `05` §1.3: the two-principal rule verbatim as a blockquote; the complete `kind: Consumer` YAML example; `humanInTheLoop` and its forced-approval consequence; admin-approved registration with DCR structurally disabled and a legible 403; the bootstrap commands and their environment-class refusals; step `[2a]` and stage `6a′`; the fifth kill-switch granularity.
- **§11.3 Scope resolution and audit.** The six-way intersection block verbatim. The two consequences (TTFC can only fall, so §5.6's invariant and §5.7's arithmetic stand unchanged; and the two-distinct-refusals requirement). The audit columns and the `audit_credential_ref` satellite, with the "before the first row" sequencing constraint stated as a hard requirement, not advice. The Wave-1 `client_id`/`azp` corroboration nuance.
- **§11.4 The binding-authorization stage.** `6e′`'s position with the ordering argument **and the rejected alternative**, both stated. The two-posture table verbatim from `05` §3.3.2. `bindingGrants` on roles and consumers, compiled into the scope artefact so widening is a diff. §11.4.3: the wrapper-package grant granularity and the gateway↔database reconciliation. §11.4.4: `standingAuthorization`, its four properties, and both named failure modes. §11.4.5: the discovery consequence — reuse of the disabled-tool resolution, the `access` field on the find response not the card, and the explicit MTB accounting. §11.4.6: the `forge.invoke` dual-entry-point test. §11.4.7: the reconciliation with `database` read-only-by-policy, all three reasons plus the `policyException` extension.
- **§11.5 Credentials and secrets.** The `SecretStore` interface verbatim. `SecretRef` format and the "only form a credential ever takes" rule as a blockquote. The three implementations and what is built when, citing the `W0-C5`/`W0-D3` precedent. The six rules, in full, including the **confirm-token HMAC dual-key overlap window** with its reason. Then §11.5.1: the four-part stored-credential legitimacy test as a blockquote, the note that all four are checkable from data the system already holds, and `binding.credentialClass` with its two validate rules.
- **§11.6 Usage tracking and the detector substrate.** `consumer_usage` fields. The seven anomaly patterns with their one-line reasons. The observe-never-silently-act rule as a blockquote, including the single critical-severity kill-switch exception and why a loud cut-off is acceptable where a quiet throttle is not. The `anomaly_event` schema. The Wave 0 / Wave 3 split stated as a scope discipline.
- **§11.7 New error codes.** State plainly: **the closed error taxonomy in §3.1.5 grows from 17 codes to 21.** List the four with their meanings and a worked `next` string for each, since §3.1.5's rule is that every code carries a non-empty agent-actionable `next`:
  - `CONSUMER_UNREGISTERED`
  - `CONSUMER_SUSPENDED`
  - `CONSUMER_NOT_AUTHORIZED`
  - `ELEVATED_GRANT_REQUIRED`
  Add a line: *"`CONSUMER_NOT_AUTHORIZED` and `TOOL_NOT_IN_SCOPE` must never share wording. One says your client may not; the other says you may not."*
- **§11.8 What this does not change** — a short, deliberate list, because the most likely misreading of this section is that it loosens something: per-user identity passthrough is unchanged and is still required on every call; the no-service-account-fallback rule is unchanged and is now more precisely stated; `database` read-only-by-policy is unchanged; the write-safety machinery is unchanged; the five handshakes are unchanged; the discovery mechanism and every G5 number are unchanged.
- Closing line: *"Correction applied by Phase 5, per user direction, 27 Aug 2026."*

---

### 6.3 `03_UX_DESIGN_SYSTEM.md`

The document ends at §15. **The new section is §16.**

#### 6.3.1 Inline markers (5)

| # | Location | Marker | Text |
|---|---|---|---|
| 1 | §5.2, the nav block | **EXTENDED** | Blockquote below the block: *"**EXTENDED by §16 — Phase 5, 27 Aug 2026. The nine destinations are unchanged** — §14 item 5's defence of the count stands. Phase 5 adds a fifth **Governance** tab (`Consumers`) and a second **Activity** view (`/activity/consumers`), on the rule that Governance is where a consumer's authorization is decided and Activity is where its behaviour is observed."* |
| 2 | §5.3, the **Governance** page spec, after its four numbered tabs | **EXTENDED** | *"**EXTENDED by §16.2 — Phase 5, 27 Aug 2026.** A fifth tab, **Consumers**, follows tab 1's pattern exactly: edit on the left, the compiled authorization artefact rendered explicitly on the right, and nothing saves directly."* |
| 3 | §5.3, the **Activity** page spec, at the **Consumption** bullet | **EXTENDED** | *"**EXTENDED by §16.3 — Phase 5, 27 Aug 2026.** Consumption's 'consuming agent' is now the authenticated `consumer_id`; before Phase 5 it had no source. A sibling view `/activity/consumers` carries per-consumer usage, quota headroom and anomaly events."* |
| 4 | §5.3, the **Approvals** page, the two-kinds table | **EXTENDED** | *"**EXTENDED by §16.4 — Phase 5.** Consumer registrations, credential rotations and standing-authorization grants are **definitional** approvals and need no new UI — they are change proposals, and the queue already holds those."* |
| 5 | §11.1, the environment-chip table / §5.3 **Environments** tab 1 | **EXTENDED** | *"**EXTENDED by §16.5 — Phase 5.** The deployment fingerprint gains the **secret-store kind** and a count of credentials past their rotation window, beside the existing datastore kind."* |

#### 6.3.2 Append `## 16.`

Title: `## 16. Correction applied by Phase 5, per user direction, 27 Aug 2026 — the consumer surfaces`

- **§16.1 The IA decision and its rule.** State the decision (no new top-level route), quote Phase 3's own splitting criterion from §5.1 item 2 as the basis, and give the rule as a blockquote: *"Governance is where a consumer's authorization is decided. Activity is where its behaviour is observed. Registration is a grant; usage is an event."* Note that this mirrors the definitional/runtime and git/store split the whole document already runs on.
- **§16.2 Governance → Consumers (tab 5).** Full spec in the style of §5.3's other page specs — who it is for, what it reads from (git for the record, gw for credential age and usage), and what it must contain: the registered-consumer table (id, label, class, owner, steward, status, expiry, credential age, next rotation due); the detail editor following the Roles-tab pattern with the **compiled authorization artefact rendered explicitly**; the elevated-grant panel showing `bindingGrants` with their standing authorizations, approvers and expiry dates, with grants **within 30 days of expiry chipped `--status-write`** and expired ones `--status-danger`; the actions Register / Suspend / Rotate credential / Retire, all of which produce change proposals except Suspend, which is a kill-switch act and is immediate, audited and carries a reason; and **type-to-confirm on Suspend at deployment scope and on Retire**, per §7.3's friction ladder.
- **§16.3 Activity → Consumers (`/activity/consumers`).** Per-consumer usage over time; quota headroom as a meter against declared limits; the detector table with each detector's state, threshold and last fire; the anomaly-event list, each linking into the audit calls that triggered it; and the same staleness marker discipline as §11.4 (this is polled runtime data, not streamed).
- **§16.4 Small additions to existing surfaces.** Approvals: the three new definitional approval kinds, differentiated by chip only. Home → "What broke": open critical anomaly events. Catalog tool detail → Binding & handshake: a **"Who may execute this"** block naming the roles and consumers holding an elevated grant with their expiry — because the section currently answers *how* the binding authenticates and not *who* may fire it. Command palette: the `no_tool`-style treatment for a `requires_grant` result, with a primary action "Request this grant" that opens Requests pre-filled — reusing §9.2 item 5's existing pattern.
- **§16.5 New chip values.** `ConsumerStatusChip` (active / suspended / expired / retired) and `GrantStateChip` (granted / standing-authorized / expiring / expired / not granted), both driven by `status.ts` per §13.5, both with a visible text label and an accessible name that expands the abbreviation per §12.5. **No new colour tokens** — reuse `--status-ok` / `--status-write` / `--status-danger` / `--status-neutral`. Say that explicitly: Phase 5 introduces no palette change and the §4.6 contrast measurements are untouched.
- **§16.6 Copy standards for the new refusals.** Extend §10.3's table with four rows — the agent-facing `next` strings for the four new error codes — and state the rule that makes §5.5's risk 6 concrete: **`CONSUMER_NOT_AUTHORIZED` names the client and says what the client may not do; `TOOL_NOT_IN_SCOPE` names the role and says what the person may not do. Never the same sentence, never interchangeable.**
- **§16.7 Accessibility.** No new gates. The five in §12.7 cover the new surfaces; the keyboard-only Playwright script in gate 4 gains the consumer-suspend and grant-renewal flows.
- **§16.8 Trim order.** Restate `05` §5.6's ranked order and why Governance → Consumers outranks Insights.
- Closing italic line matching the document's convention.

---

### 6.4 `04_AUTONOMY_MODEL_ROUTING_AND_TASKS.md`

The document ends at §6. **The new section is §7.**

#### 6.4.1 Inline markers (5)

| # | Location | Marker | Text |
|---|---|---|---|
| 1 | §1.3, the worked-examples table | **EXTENDED** | Blockquote after the table: *"**EXTENDED by §7.2 — Phase 5, 27 Aug 2026.** Six new task shapes are routed there under the same three tests: the consumer record model, consumer authentication, the binding-authorization stage, `standingAuthorization`, the `SecretStore` seam and the anomaly-event schema."* |
| 2 | §1.3, the line *"Rough Wave 0 split that falls out of this: about 30% Opus, about 70% Sonnet 5"* | **SUPERSEDED** | *"**SUPERSEDED by §7.3 — Phase 5, 27 Aug 2026.** With Phase 5's 15 new tasks the Wave 0 split is **43 Opus / 60 Sonnet / 8 human across 111 tasks** — about 42% of automated tasks on Opus. The shape of the argument is unchanged; the Opus share rises because the additions are concentrated in front-door and grant machinery, which is where Tests 1 and 2 both fire."* |
| 3 | §2.1, the `engineering:code-review` row, the phrase *"Give it the four non-negotiables from `CLAUDE.md` explicitly"* | **SUPERSEDED** | *"**SUPERSEDED by §7.4 — Phase 5, 27 Aug 2026: there are now eight, and this row already undercounted.** `CLAUDE.md` §2 listed five before Phase 5 and lists eight after. Pass all eight."* **Note to the execution agent: this is a pre-existing inconsistency in the plan (04 says four, CLAUDE.md said five). Fix it to eight rather than propagating it, and say in your output that you found and corrected it.** |
| 4 | §3.5 step 6, the same *"four `CLAUDE.md` non-negotiables"* phrase | **SUPERSEDED** | Same correction: *"…the **eight** `CLAUDE.md` non-negotiables…"* |
| 5 | §4.1, the Wave 0 track table and the totals below it | **EXTENDED** | Blockquote after the table: *"**EXTENDED by §7.3 — Phase 5, 27 Aug 2026.** A fourteenth track, **N — Consumer governance, access control and credentials** (14 tasks), and an eighth human gate (`W0-HG8`) join the backlog. `TASKS.md` carries the full breakdown."* |

#### 6.4.2 Append `## 7.`

Title: `## 7. Correction applied by Phase 5, per user direction, 27 Aug 2026 — routing and skills for the consumer/access-control/credential work`

- **§7.1 What changed and where.** One paragraph pointing at `05_GOVERNANCE_ACCESS_CONTROL_AND_CREDENTIALS.md` as the design, 01 §11 and 02 §11 as the goal and architecture corrections, 03 §16 as the UX, and `TASKS.md` track N as the backlog.
- **§7.2 The routing rule applied to the new work** — a table in the exact style of §1.3, with one row per new task shape, its firing test, its model and its one-line reason. Use the routing and rationale in §6.6 of this document verbatim; do not re-derive it.
- **§7.3 The revised Wave 0 split** — 111 tasks, 43/60/8, the new track N, and one honest sentence: the Opus share rises because Phase 5's additions sit almost entirely on the security spine, which is the correct place for it to rise and the wrong place to economise.
- **§7.4 Skills** — three additions to §2's map, no new plugins:
  - **`engineering:code-review`** now carries **eight** non-negotiables, three of them new. Note that the two new access-control rules are exactly the kind a test does not catch: a stage inserted in the wrong position in an ordered chain still passes every unit test, and a `SecretStore.get()` called one layer too high still returns the right value.
  - **`engineering:architecture`** gains a Wave 0 ADR: *the consumer as a second principal, and why authorization is the intersection rather than the union.* This is checkpoint agenda item 3 material and it is the decision most likely to be misread later.
  - **`design:ux-copy`** gains the four new refusal strings (§16.6 of Phase 3) — and specifically the `CONSUMER_NOT_AUTHORIZED` / `TOOL_NOT_IN_SCOPE` distinction, which is a copy problem with a support cost, exactly the class §2.2 already flags for the `planTemplate`.
- **§7.5 One sequencing instruction that is not negotiable.** State it as its own subsection because it is the single most expensive thing to get wrong: **`W0-C2` must carry the consumer and credential-ref columns before it is marked done.** A later migration puts a schema discontinuity in the audit hash chain, and the hash chain is the only integrity mechanism Wave 0 has on SQLite (02 §10.4 item 1). Track N's tasks depend on `W0-C2` as amended, not on a follow-up.
- Closing italic line matching the document's convention.

---

### 6.5 `MCPForge\CLAUDE.md`

#### 6.5.1 Retitle §2 and add three items

Change the heading `## 2. The five write-safety non-negotiables` to:

`## 2. The eight non-negotiables`

Immediately under the heading, add one line before the existing intro paragraph:

> *Items 1–5 are write safety. Items 6–8 are access control and credentials, added by Phase 5 on 27 Aug 2026. All eight are checked by lint, by tests, by `forge validate` and by code review — and all eight are written here because a reviewer who knows them catches things the tools do not.*

Keep items 1–5 **exactly as they are**. Append these three, verbatim:

> **6. Every call needs BOTH a registered consumer and a resolved human identity.** Authorization is the **intersection** of what the consumer may do and what the human may do — never the union, never a substitute. An unregistered, suspended, expired or retired consumer is refused at session establishment with `CONSUMER_UNREGISTERED` and is served no `tools/list`. A registered consumer with no resolvable human identity is still `IDENTITY_UNRESOLVED`. There is no consumer-only path and no human-only path, and Dynamic Client Registration does not exist — registration is a reviewed git artefact with an approval record, like every other grant here.
>
> **7. Being in scope is not permission to execute an elevated binding.** `plsql` and `function` bindings, write-classified `wrapped-vendor` tools, and any tool carrying a `policyException` are **elevated posture**: executing one requires an explicit, named, expiring, approval-recorded `bindingGrant`, not merely membership of a role that happens to include the tool. Catalogue membership is discovery; scope is visibility; **neither is permission.** If you find yourself letting scope membership alone authorize a `plsql` call, you have built the thing this rule exists to prevent. `forge.invoke` is not a way around it — it runs the identical chain.
>
> **8. A credential is a `secretRef://`, and a stored credential must pass the four-part test.** No secret value ever appears in git, in a manifest, an overlay, a consumer record, an audit row, a log line, a portal screen or a CLI output — only a reference, and `SecretStore.get()` may only be called inside `adapters/**` and `core/gateway/identity/**` (lint rule: `no-secret-value-escape`). A binding may hold a stored credential **only when all four hold**: (a) the binding type structurally cannot carry per-user identity, **as reported by the probe, never as asserted by a human**; (b) a per-user identity is still resolved for the call and a missing mapping is still a hard failure; (c) a named compensating control carries that identity into the target and is echoed into the audit record; (d) the credential is scoped to one module and one environment. **If any of the four fails, it is a service-account fallback and item 1 forbids it.**

#### 6.5.2 §3 — settled architecture, short version

After the **"Identity is pluggable"** paragraph, insert a new paragraph:

> **Consumers are registered, not assumed.** A `Consumer` is the software holding the session — an agent, a client, a platform, the portal itself. It is a git artefact in `consumers/`, compiled like a role, approved like a role, and it carries its own authorizations: which binding types, which sensitivity ceiling, whether writes are allowed at all, which roles and packages, its rate and write limits, and whether a human is in its loop. `visible(session)` is a **six-way** intersection: Deployed ∩ Granted ∩ Activated ∩ ProbeEnabled ∩ ¬KillSwitched ∩ ConsumerAuthorized. The kill switch has **five** granularities — tool · module server · binding type · **consumer** · deployment.

And after the **"Slices are selections"** paragraph, insert:

> **Secrets are the third pluggable seam**, after `IdentityProvider` and `ChangeHost`. `SecretStore` → `SecretRef`. `EncryptedFileStore` (sealed file, OS-keychain key) is the Wave 0 default with `OsKeychainStore` beside it, both contract-tested against one suite; `OciVaultStore` is the production target and is **not** a Wave 0 dependency. Rotation intervals are declared and enforced, and the confirm-token HMAC key rotates with a **dual-key overlap window** so a rotation does not invalidate every in-flight plan token.

#### 6.5.3 §6 — `OPUS_GUARDED_PATHS`

Add these five lines to the existing block, keeping the existing entries and the block's comment style:

```
core/gateway/consumer/**
core/gateway/policy/binding-auth/**
core/gateway/secrets/**
core/gateway/store/consumer*
consumers/**
```

#### 6.5.4 §7 — useful commands

Append to the existing block:

```bash
forge consumer new|list|show|suspend|rotate|retire   # the consumer registry
forge consumer issue-credential <id>                 # prints once; refused when CI=true or env is staging/prod
forge secrets status --json                          # age and next-due for every ref
forge secrets rotate <ref>                           # dual-key overlap on the HMAC and signing keys
forge secrets revoke <ref> --reason "…"              # invalidates AND kill-switches every dependent
```

#### 6.5.5 §5 — conventions

Add one short paragraph after the **Versioning** paragraph:

> **Secret references** are `secretRef://<scope>/<subject>/<purpose>` — e.g. `secretRef://binding/ebs-p2p-ap/wrapper-schema`. A ref is the only form a credential takes anywhere a human or a log can see it. **Consumer ids** follow the same immutability rule as tool ids: renaming is a retire-and-register pair, both recorded, because audit rows and consumption edges reference the id.

---

### 6.6 `MCPForge\TASKS.md` — literal entries

#### 6.6.0 Header and preamble changes

1. Line 3: `**96 tasks · 13 tracks…**` → `**111 tasks · 14 tracks · Wave 0 = M0, the reference module made genuinely real end to end.**`
2. Line 4: append after the existing companion sentence: *"Extended 27 Aug 2026 by Phase 5 (`..\build-plan\05_GOVERNANCE_ACCESS_CONTROL_AND_CREDENTIALS.md`) with track N, `W0-HG8`, and 17 modified tasks. Modified tasks carry a `— [P5]` marker on the changed `done:` clause so the change is visible in review."*
3. Line 6 (`**Wave 0 delivers:**`): append `· the consumer registry and the binding-authorization stage · consumer usage tracking and the anomaly-detector substrate · the secret store`.
4. In **How to read this file**, the "Order matters" list, add a **third** deliberate sequencing choice:
   > **3. `W0-C2` carries the consumer and credential-ref audit columns before it is marked done** — Phase 5, 02 §11.3. A later migration puts a schema discontinuity in the audit hash chain, which on SQLite is the only integrity mechanism there is. Do not split this into a follow-up task.

#### 6.6.1 Modifications to existing tasks (17)

For each, **append** the new clause to the existing `done:` (or the named field) prefixed `— [P5]`. Do not rewrite the existing text.

| Task | Field | Append |
|---|---|---|
| `W0-A3` | done | `— [P5] a fourth guard rule, `no-secret-value-escape`, fires on a `SecretStore.get()` call outside `adapters/**` and `core/gateway/identity/**` and does not fire inside them.` |
| `W0-A4` | done | `— [P5] the error code union is **21** codes, not 17: the four new ones are `CONSUMER_UNREGISTERED`, `CONSUMER_SUSPENDED`, `CONSUMER_NOT_AUTHORIZED` and `ELEVATED_GRANT_REQUIRED`, each with a non-empty agent-actionable `next`.` |
| `W0-B1` | done | `— [P5] the schema also covers `kind: Consumer` (02 §11.2); `kind: Role` gains `bindingGrants`; the Tool binding block gains `credentialClass: per-user-exchanged \| module-scoped-stored \| none`.` |
| `W0-B3` | done | `— [P5] six further rules, each with a fixture: `credentialClass: module-scoped-stored` is rejected where the probe reports `identity.carries: verified`; `credentialClass: per-user-exchanged` is rejected on `plsql`; a `bindingGrant` on `plsql` must name a wrapper package matching `^MCPFORGE_WRAP\.[A-Z0-9_]+$`; a `standingAuthorization` without a resolvable `approvalRef` and an `expiresAt` is rejected; a Consumer record with a `credential.ref` that is not a `secretRef://` URI is rejected; and the **four-part stored-credential legitimacy test** of 02 §11.5.1 is a rule that fails naming which of the four parts failed.` |
| `W0-B8` | done | `— [P5] `bindingGrants` compile into the role scope artefact alongside the tool-id list, and each Consumer record compiles to `generated/consumers/<id>.authorization.json`; widening either produces a **visible diff**, and an expired grant compiles to an explicit `expired: true` rather than disappearing.` |
| `W0-C2` | done | `— [P5] **and, before the first audit row exists**, the `who` block also carries `consumer_id`, `consumer_record_sha`, `consumer_auth_method`, `consumer_session_id` and `human_in_the_loop`, plus a normalised `audit_credential_ref(call_id, secret_ref, version)` satellite indexed on `secret_ref`. A test proves "which calls used this credential version" answers in one hop. **This may not be deferred to a migration** — 04 §7.5.` |
| `W0-E2` | done | `— [P5] the intersection is **six**-way: `ConsumerAuthorized(consumer)` joins it, with its own predicate test proving that removing it widens the set; a consumer restricted below its human's grants sees the narrower set, and the resulting refusal is `CONSUMER_NOT_AUTHORIZED`, never `TOOL_NOT_IN_SCOPE`.` |
| `W0-E3` | done | `— [P5] the chain carries two further ordered stages — `6a′` consumer active and within its declared authorizations, and `6e′` binding-type authorization (02 §11.4) — and **the existing fault-injection test is extended to cover them rather than a second suite added beside it**; a test proves `6e′` runs before `6g` so no plan token is ever minted for a call that lacks an elevated grant.` |
| `W0-E5` | done | `— [P5] **five** granularities, not four: `forge kill consumer:<id> --reason "…"` takes effect within the same 5-second poll, refuses the consumer's next call with `CONSUMER_SUSPENDED`, and writes an audit record naming its author and reason.` |
| `W0-E8` | done | `— [P5] four further privilege-escalation cases, all failing closed: an unregistered consumer presenting a valid user token; a consumer suspended mid-session; an elevated-binding tool called with no `bindingGrant` through **both** `tools/call` and `forge.invoke`; and a binding declaring `module-scoped-stored` that fails any part of the four-part legitimacy test.` |
| `W0-G4` | done | `— [P5] a tool the session lacks an elevated grant for is **excluded from `tools/list`** by the six-way intersection but remains findable through `forge.find` with a per-result `access: "requires_grant"` and an `agentMessage` naming the grant and its approver — the same resolution 02 §4.5 already reached for disabled tools, reused rather than reinvented.` |
| `W0-G5` | done | `— [P5] the tool **card budget stays ≤60 and is unchanged**; the `access` field rides on the find *response*, costs ≤6 tokens per result, and is accounted for explicitly in the MTB gate rather than surfacing as an unexplained budget failure.` |
| `W0-H4` | done | `— [P5] the probe report schema carries a `bindingGrantReconciliation` block per `plsql` tool, comparing the compiled gateway `bindingGrants` against the database-side `EXECUTE` grants and reporting any grant present on one side only. **Built at Wave 0 against a fixture and exercised live at Wave 2**, when `plsql` bindings land — the same seam-early discipline as `W0-C5` and `W0-D3`.` |
| `W0-J16` | done | `— [P5] a sibling view `/activity/consumers` (03 §16.3) carries per-consumer usage, quota headroom against declared limits, detector states and the anomaly-event list, each event linking into the audit calls that triggered it; `/activity/consumption` renders the **authenticated** `consumer_id` as its consuming agent.` |
| `W0-J17` | done | `— [P5] the deployment fingerprint also shows the **secret-store kind** and the count of credentials past their rotation window, beside the datastore kind.` |
| `W0-J18` | done | `— [P5] tab 5 is delivered by `W0-N12` and follows this task's Roles pattern exactly; this task's `done:` is unchanged otherwise.` |
| `W0-K3` | done | `— [P5] `overlay-purity` also performs a **content** scan: any high-entropy string, PEM header, or `password:`/`secret:`/`token:`/`key:` value that is not a `secretRef://` URI, anywhere under `overlays/**`, `manifests/**`, `roles/**`, `packages/**` or `consumers/**`, fails the build **with the file and line named**.` |

#### 6.6.2 New Track N — insert between Track M and the exit-criteria map

Insert this track heading and its note, then the 14 tasks verbatim:

`## Track N — Consumer governance, access control and credentials (14 tasks)`

> **Added 27 Aug 2026 by Phase 5.** Design: `..\build-plan\05_GOVERNANCE_ACCESS_CONTROL_AND_CREDENTIALS.md`; architecture: `02_TECHNICAL_ARCHITECTURE.md` §11. **N1–N4 are the front door and the grant model and they gate everything else in this track.** Nine of the fourteen are Opus, because Phase 5's additions sit almost entirely on the security spine — 04 §1.1 Test 1 fires on the record shapes and Test 2 on the gates.

```markdown
- [ ] **W0-N1** — `kind: Consumer` record model, `forge consumer` CLI, and the git-backed registration flow
  - model: opus
  - deps: W0-B1, W0-B8
  - wave: 0
  - reads: 02#11.2, 05#1.3
  - touches: core/gateway/consumer/**, core/cli/src/commands/consumer.ts, consumers/**
  - done: `forge validate` accepts the `kind: Consumer` example in 02 §11.2 field for field and rejects a record whose `credential.ref` is not a `secretRef://` URI or that lacks an `owner` and `expiresAt`; `forge consumer new|list|show|suspend|rotate|retire --json` all work; `issue-credential` prints the value exactly once and is refused when `CI=true` or the environment class is `staging` or `prod`; a registration change produces a normal change proposal and an approval record in `approvals/`, with **no direct-write path** proved by a test.

- [ ] **W0-N2** — Consumer authentication at the transport boundary, and DCR structurally disabled
  - model: opus
  - deps: W0-N1, W0-E1
  - wave: 0
  - reads: 02#11.2, 02#4.2
  - touches: core/gateway/transport/consumer-auth/**
  - done: step `[2a]` authenticates the consumer by mTLS, private-key-JWT or client secret **before** identity resolution; an unregistered, suspended, expired or retired consumer is refused at `initialize` with `CONSUMER_UNREGISTERED` or `CONSUMER_SUSPENDED` and **is served no `tools/list`**, proved by a test asserting zero catalogue bytes returned; the `registration_endpoint` is **absent** from the published metadata and a `POST` to it returns 403 with an agent-actionable `next` naming the portal flow — not a 404; where an external OIDC issuer is in use the token's `client_id`/`azp` is corroborated against the registration and a mismatch refuses, but the claim is **never** accepted in place of a registration.

- [ ] **W0-N3** — The binding-authorization stage `6e′` and the elevated-posture rule set
  - model: opus
  - deps: W0-N1, W0-E3
  - wave: 0
  - reads: 02#11.4, 05#3.3
  - touches: core/gateway/policy/binding-auth/**
  - done: `plsql`, `function`, write-classified `wrapped-vendor` and any tool carrying a `policyException` are elevated posture and require an explicit `bindingGrant`; `rest`, read-only `database` and read-only `wrapped-vendor` remain default-allow within scope; **a test proves that a role holding an elevated tool in scope with no grant is refused `ELEVATED_GRANT_REQUIRED` through both `tools/call` and `forge.invoke`**; an elevated write with no `standingAuthorization` forces `humanApprovalRequired: true` regardless of the tool's own setting; a consumer with `humanInTheLoop: false` is refused outright on any elevated write; and **`database` read-only-by-policy is untouched** — a test asserts `write:true` + `binding.type: database` still fails validate.

- [ ] **W0-N4** — `standingAuthorization`: the record, its expiry, and its enforcement
  - model: opus
  - deps: W0-N3
  - wave: 0
  - reads: 02#11.4.4
  - touches: core/gateway/policy/binding-auth/standing.ts, core/codegen/compile/**
  - done: a `standingAuthorization` resolves to a committed approval record with a named approver and an `expiresAt`, and substitutes a standing approval for a **per-call** one **without removing anything else** — plan → confirm, guardrails, SoD and the identity requirement all still run, each proved by a test; an expired standing authorization reverts to forced per-call approval rather than failing open, proved by a clock-advance test; granting one is visible in the compiled scope diff.

- [ ] **W0-N5** — `SecretStore`, `SecretRef`, and two implementations under one contract suite
  - model: opus
  - deps: W0-A1
  - wave: 0
  - reads: 02#11.5, 05#4.3
  - touches: core/gateway/secrets/**
  - done: one contract suite passes against **both** `EncryptedFileStore` (sealed `./.mcpforge/secrets.age`, key from the OS keychain, env-var key for CI only) and `OsKeychainStore` — the same dual-implementation discipline as `W0-D3` and `W0-C5`; `metadata()` is safe to log and `get()` is not; `list()` returns refs only; `OciVaultStore` is **not implemented** and its absence is a named Wave 1 task, not a stub that silently returns nothing; a test proves no secret value is reachable from outside `adapters/**` and `core/gateway/identity/**`.

- [ ] **W0-N6** — `forge secrets`: status, rotation with dual-key overlap, and one-act revocation
  - model: opus
  - deps: W0-N5, W0-E5
  - wave: 0
  - reads: 02#11.5
  - touches: core/cli/src/commands/secrets.ts
  - done: `forge secrets status --json` reports age, interval and next-due for every ref and exits non-zero when any is past 2× its interval; **the confirm-token HMAC key and the local JWT signing key rotate with a dual-key overlap window** — the retired key verifies but does not sign, for one plan TTL plus margin — proved by a test that mints a plan on the old key, rotates, and confirms the plan still executes while a newly-minted plan uses the new key; `forge secrets revoke <ref> --reason "…"` invalidates the value **and kill-switches every dependent in the same operation**, proved by asserting the dependents refuse rather than fail obscurely.

- [ ] **W0-N7** — `consumer_usage` rollups and consumer-level quota enforcement
  - model: sonnet
  - deps: W0-N2, W0-C2
  - wave: 0
  - reads: 02#11.6
  - touches: core/gateway/store/usage/**, core/gateway/caps/**
  - done: hourly and daily rollups carry calls, writes, plans minted, plans never confirmed, refusals by error code, distinct tools, distinct binding types, **distinct human subjects acted for**, bytes out and p95 latency, written from the same outbox transaction as the audit row; the consumer's declared `limits` are enforced and a breach returns `RATE_LIMITED` with a `next` naming the window and its reset time; a test proves the overlay can tighten a limit and **cannot loosen it past its compiled-in ceiling**, matching 02 §4.7's existing discipline.

- [ ] **W0-N8** — The `anomaly_event` schema and the declarative detector interface
  - model: opus
  - deps: W0-N7
  - wave: 0
  - reads: 02#11.6
  - touches: core/gateway/store/anomaly/**, core/gateway/anomaly/**
  - done: `anomaly_event(id, ts, consumer_id, detector_id, severity, window, observed, threshold, audit_call_ids[], state)` exists with `audit_call_ids` normalised into a side table per 02 §10.4 item 2's precedent, so every event is one hop from its evidence; the detector interface is declarative and configured in the overlay with tighten-only thresholds; **a test proves a detector cannot mutate any authorization, scope or threshold**, and that the single permitted action — a `severity: critical` detector tripping the consumer kill switch — writes a visible audit record with its reason and is human-reversible. The Wave 3 monitoring product conforms to this schema, which is why it is Opus and why it is Wave 0.

- [ ] **W0-N9** — The three Wave 0 detectors
  - model: sonnet
  - deps: W0-N8
  - wave: 0
  - reads: 02#11.6, 05#2.3.2
  - touches: core/gateway/anomaly/detectors/**
  - done: **burst-write** (writes per consumer per window above N× its trailing baseline or above `writesPerDay`), **scope-probing** (a rising rate of `TOOL_NOT_IN_SCOPE` / `CONSUMER_NOT_AUTHORIZED` / `ELEVATED_GRANT_REQUIRED` from one consumer) and **identity-echo-mismatch rate** (`identity_match = false` per consumer) each fire on a crafted fixture and stay silent on the legitimate near-miss; each emits an `anomaly_event` referencing the exact calls; the remaining four patterns in 02 §11.6 are declared in the config schema and left unimplemented, named as Wave 3 work rather than silently absent.

- [ ] **W0-N10** — Consumer-scoped audit wiring and the consumption-edge feed
  - model: sonnet
  - deps: W0-N2, W0-C2
  - wave: 0
  - reads: 02#11.3, 02#4.6
  - touches: core/gateway/audit/**, core/gateway/store/consumption/**
  - done: every audit row carries its `consumer_id` and the `consumer_record_sha` in force **at that call**, so "what was this agent allowed to do that day" is answerable from the row rather than from git archaeology; `consumption_edge` is fed from `consumer_id` and a test asserts **no self-declared agent name is ever written** — the value is authenticated or it is absent; `credential_refs` are recorded by ref and version and **never by value**, asserted by a test scanning the whole audit row.

- [ ] **W0-N11** — `forge dev` local bootstrap self-registration, environment-class gated
  - model: opus
  - deps: W0-N1, W0-N2
  - wave: 0
  - reads: 02#11.2
  - touches: core/cli/src/commands/dev.ts
  - done: on a clean clone `forge dev` self-registers a `portal-local` consumer so the portal can reach the gateway, **and does so only when the environment class is `local`** — a test asserts it refuses under `probe`, `staging` and `prod` and refuses when `CI=true`; the self-registered record is an ordinary `consumers/` artefact with a visible short expiry, never a hidden built-in. Small task, Opus routing: its failure mode is a silent self-registration in production, which is 04 §1.1 Test 2 exactly.

- [ ] **W0-N12** — Portal: Governance → Consumers (tab 5)
  - model: opus
  - deps: W0-J18, W0-N4
  - wave: 0
  - reads: 03#16.2
  - touches: core/portal/src/app/governance/consumers/**
  - done: the registry table and the detail editor follow `W0-J18`'s Roles pattern exactly — edit on the left, **the compiled authorization artefact rendered explicitly on the right**, nothing saves directly, everything produces a change proposal; the elevated-grant panel shows each `bindingGrant` with its standing authorization, approver and expiry, chipped `--status-write` within 30 days of expiry and `--status-danger` past it; Suspend is a kill-switch act — immediate, audited, reason required — and Retire and deployment-scope Suspend are type-to-confirm per 03 §7.3. Opus for the same reason `W0-J18` is: a consumer editor that hides what a consumer may actually reach is the identical failure to a role editor that hides what a glob picks up.

- [ ] **W0-N13** — Portal: Activity → Consumers
  - model: sonnet
  - deps: W0-J16, W0-N9
  - wave: 0
  - reads: 03#16.3
  - touches: core/portal/src/app/activity/consumers/**
  - done: per-consumer usage over time, quota headroom as a meter against the declared limits, the detector table with each detector's state, threshold and last fire, and the anomaly-event list with every event linking into the audit calls that triggered it; staleness marker and manual refresh per 03 §11.4 — this is polled runtime data and **must not stream**.

- [ ] **W0-N14** — The exit-criterion-14 demonstrations, as automated tests
  - model: sonnet
  - deps: W0-N3, W0-N4, W0-N12, W0-HG8
  - wave: 0
  - reads: 01#11.5
  - touches: tests/consumer-access/**
  - done: one test each, named after its criterion, all passing against the mock target and re-runnable against a live instance — **(a)** an unregistered consumer refused at session establishment with no `tools/list` served; **(b)** a consumer suspended mid-session refused on its next call within the poll interval; **(c)** an elevated-binding tool refused with `ELEVATED_GRANT_REQUIRED` through both entry points, absent from `tools/list` and findable through `forge.find`; **(d)** a registration, a standing authorization and a credential rotation each carrying an approval record and a compiled-artefact diff. The suite emits a markdown evidence file for the Wave 0 checkpoint, mirroring `W0-F7`.
```

#### 6.6.3 New human gate — append to Track HG

```markdown
- [ ] **W0-HG8** — Approve the initial consumer registrations and the `p2p × function` standing authorization
  - model: human
  - deps: W0-N4, W0-I6
  - wave: 0
  - gate: Two decisions in one gate. **First:** approve the Wave 0 consumer registrations — at minimum `portal-local`, plus each AI client or platform that will actually hold a session — naming an accountable owner and an expiry for each. An unowned registration is the thing R15 warns about. **Second, and this one is load-bearing for the demo:** every Wave 0 write tool is a `function` binding and therefore elevated posture, so without a `standingAuthorization` for `p2p × function` all six writes require a per-call human approval and the Wave 0 demo becomes a parade of approval dialogs. Grant it as a **real, recorded, expiring approval** so the mechanism is exercised rather than disabled — 05 §3.3.4 names both failure modes: forget the standing authorization and Wave 0 looks broken; forget that it must expire and be recorded, and the gate is decoration.
```

#### 6.6.4 The exit-criteria map table

Add one row at the end:

| `14` | **The front door is closed and elevated bindings are not open** — (a) unregistered refused, (b) suspended refused mid-session, (c) elevated binding refused through both entry points, (d) registration/standing-auth/rotation each with an approval record | `W0-N1` … `W0-N4`, `W0-N11`, `W0-N14`, `W0-HG8` |

And amend criterion 5's "Satisfied by" cell from `W0-E8` to `W0-E8` **+ `W0-N2`** with a footnote: *"criterion 5 evidences the egress door; criterion 14 evidences the ingress door. Both are required — 01 §11.5."*

#### 6.6.5 The track summary table

Replace the whole table's totals and add the N row:

| Track | Tasks | Opus | Sonnet | Human |
|---|---|---|---|---|
| *(A–M unchanged)* | 96 | 34 | 55 | 7 |
| **N Consumer governance, access control, credentials** | **14** | **9** | **5** | — |
| **HG** (was 7) | **8** | — | — | **8** |
| **Total** | **111** | **43** | **60** | **8** |

Rewrite the paragraph under it to read **43 Opus / 60 Sonnet / 8 human** — about **42%** of automated tasks on Opus — and add one sentence: *"The Opus share rose four points because Phase 5's additions sit almost entirely on the security spine: the consumer record and the anomaly-event schema fire Test 1, and every gate in track N fires Test 2. That is the correct place for the share to rise and the wrong place to economise."*

---

### 6.7 Order of work for the execution pass

Do it in this order; each step is independently reviewable and the later ones depend on wording fixed by the earlier ones.

1. `02_TECHNICAL_ARCHITECTURE.md` — markers, then §11. **This is the source of truth the other five quote; get it right first.**
2. `01_GOALS_AND_ROADMAP.md` — markers, then §11 (which cites 02 §11).
3. `03_UX_DESIGN_SYSTEM.md` — markers, then §16.
4. `04_AUTONOMY_MODEL_ROUTING_AND_TASKS.md` — markers (including the pre-existing four/five/eight non-negotiables fix), then §7.
5. `MCPForge\CLAUDE.md` — all five edits.
6. `MCPForge\TASKS.md` — header, 17 modifications, track N, `W0-HG8`, the two tables.

**Then verify, and report each of these explicitly in your output:**
- Every task id in track N matches `^W\d+-[A-Z]+\d+$` and every `deps:` id exists (the lane fails the whole run at parse time on a bad dep — 04 §3.3, exit code 20).
- Every new task has a non-empty `done:` containing at least one backticked command, except `W0-HG8`, which is `model: human` and carries `gate:` instead.
- The three task-count statements agree: the header line, the track summary and 04 §7.3 all say **111 / 43 / 60 / 8**.
- No existing task id, exit criterion number, error code, or section number was renumbered.
- The four/five/eight non-negotiables inconsistency you were asked to fix is reported as found and corrected.

---

### 6.8 The one memory update

Update `mcpforge_real_app_plan.md`: in the **"⚠ NEW — raised 27 Aug 2026"** heading and its status text, change *"for analysis next session, NOT yet actioned"* / *"NOT yet analyzed"* to:

> **ANALYZED — design in `05_GOVERNANCE_ACCESS_CONTROL_AND_CREDENTIALS.md`, mechanical application to 01–04 / CLAUDE.md / TASKS.md still PENDING (Sonnet execution pass next).**

**Do not mark it resolved.** That happens after the execution pass has actually applied the edits and the counts verify.

---

## 7. What the user should sanity-check before the execution pass runs

Six things, ranked by what costs most if it is wrong.

1. **Admin-approved registration with Dynamic Client Registration switched off.** This is the biggest single judgment call in this document. It means every new AI client that wants to talk to MCPForge needs a reviewed change proposal and an approval — deliberate friction, and correct for a gateway fronting financial writes, but it is friction the user will feel. *If the user wants self-service registration for a low-sensitivity tier,* the shape that preserves the property is: self-service registration permitted but capped at `bindingTypes: [rest]`, `writeAllowed: false`, `maxSensitivity: internal`, with anything beyond that requiring approval. Say the word and this becomes a two-tier model.
2. **`standingAuthorization`, and whether 180 days is right.** It is the hinge that makes the elevated posture implementable rather than obstructive, and it is also the mechanism most likely to erode into a rubber stamp (R16). The expiry interval is a genuine call, not a deduction.
3. **The `humanInTheLoop: false` → forced approval rule.** This is a real product constraint: a fully autonomous agent cannot execute a write through MCPForge without a named human approving each plan. That is defensible and it may not be what the user wants for every use case. It is a one-field change if not.
4. **Adding a fourteenth Wave 0 exit criterion.** Wave 0's criteria list is a governance artefact and lengthening it raises the bar for closing the wave. The alternative — folding the ingress test into criterion 5 — is defensible and slightly cheaper. My recommendation is the new criterion, because a criterion that tests two different doors under one number is the kind of thing that gets half-evidenced.
5. **The +12–15% effort estimate.** Stated in the same spirit as Phase 1 §10.5's "1.6–2.0×" — a reasoned estimate, not a measurement. The task count (96 → 111) is exact; the effort weighting behind it is judgment.
6. **The trim order.** Placing Governance → Consumers above Insights in the trim ranking is a judgment about which surface a Wave 0 governance owner cannot work without. If Insights is being demoed to someone who matters, that ranking flips — but say so now rather than at week nine.

**And one thing that is not a judgment call but a consequence:** every Wave 0 write tool is a `function` binding, so **every Wave 0 write is elevated posture from the moment this lands.** Without `W0-HG8`'s standing authorization, Wave 0 does not demo. That gate is not paperwork; it is on the critical path.

---

*MCPForge · BlueVerse ValueMesh · LTM Oracle AI Practice. Phase 5 — consumer governance, access control and credentials. Companion to `01_GOALS_AND_ROADMAP.md`, `02_TECHNICAL_ARCHITECTURE.md`, `03_UX_DESIGN_SYSTEM.md` and `04_AUTONOMY_MODEL_ROUTING_AND_TASKS.md`. This document supersedes nothing; §6 is the instruction set for the pass that applies it.*

---

## Addendum — 28 Aug 2026: Wave 0 consumer-authentication method and operational runbook

**Scope.** This addendum changes no design decision in §1. It pins one thing §1.3 left open — *which* of the three methods `credential.method` names is the Wave 0 default — and adds the operational runbook that §1.3.3's two bootstrap commands imply but never spell out. No task id, count or dependency changes.

**What was already decided (not re-opened):** the `kind: Consumer` record as a git artefact (§1.3.2); admin-approved registration with DCR structurally disabled (§1.3.3); step `[2a]` and stage `6a′` (§1.3.4); the six-way scope intersection (§1.3.5); `SecretStore` / `secretRef://` and the rotation intervals (§4.3). **What was genuinely absent:** a stated default among `mtls | private-key-jwt | client-secret`, the reasoning for it, and a literal issue-and-install procedure. The `method: private-key-jwt` line in §1.3.2's YAML is an *illustrative example field value*, not a decision — this addendum makes it one.

### A.1 The decision

> **Wave 0 default: `private-key-jwt` — an asymmetric client assertion (RFC 7523), Ed25519, with the private key generated on the consumer's own machine and never transmitted to the gateway, to git, or to any operator.**
>
> `client-secret` is permitted **only** for a consumer whose `authorizations.writeAllowed` is `false` **and** `maxSensitivity` is at most `internal`. `mtls` remains a supported method and is the Wave 1+ option for a service-to-service consumer inside a network that already has a certificate authority — MCPForge does not stand one up to get it.

### A.2 Why — the three options, priced concretely

Wave 0's consumer population is small and known: the developer's own Claude Code / Claude Desktop session, `portal-local` (§1.3.3), and at most one test agent. It is also a population whose sessions can reach six `function`-binding **financial write** tools. So the method has to be strong enough for a production write path and cheap enough that a single developer can set it up on a clean clone with no cloud dependency (01 §"local-first for Wave 0").

| | **What "installing a credential in the agent" literally means** | **Standing infrastructure required** | **Verdict for W0** |
|---|---|---|---|
| **`mtls`** | Generate a keypair *and* obtain a signed X.509 leaf certificate for it; place cert + key on the agent host; configure the client to present them on every TLS handshake. **The gateway must also hold a trust anchor and a revocation story.** | **A real certificate authority** — a root/intermediate keypair, an issuance procedure, a trust bundle distributed to the gateway, cert expiry tracking, and CRL or OCSP for revocation. Self-signed-per-consumer with the gateway pinning each SAN avoids the CA but is then just a public-key pin wearing an X.509 costume, at higher complexity than option 2. | **Deferred.** A CA is a standing operational asset with its own key-ceremony, backup and rotation obligations. Standing one up is disproportionate to three consumers, and it is exactly the kind of infrastructure Wave 0 is forbidden from making a prerequisite. Additionally, an MCP client speaking **stdio** has no TLS handshake to attach a certificate to at all, so for Wave 0's actual transport mTLS is not merely expensive — it is inapplicable. |
| **`client-secret`** | Copy a random string into the agent's config file; the agent sends it on every call. | None. | **Insufficient as the default.** It is a **bearer** credential: whoever reads it is the consumer. It lives in plaintext in an MCP client's JSON config, is transmitted on every request, appears in shell history and process listings, and cannot be proven un-copied. Against a session that can post AP vouchers, that is the wrong risk. Retained for read-only, non-sensitive consumers, where the blast radius genuinely is small. |
| **`private-key-jwt`** ✅ | Run one command; a keypair is generated **on the agent's machine**. The **private key never leaves it** and is stored in the OS keychain / sealed store (§4.3.1). The **public** key goes into the consumer's git record. On `initialize` the client signs a short-lived, audience-bound, single-use assertion. | **None.** No CA, no trust anchor, no CRL, no issuance ceremony — a keypair is generated in milliseconds by a library already in the dependency tree. | **The default.** |

**The property that decides it:** `private-key-jwt` gets the security properties people reach for mTLS to obtain — a **non-bearer, non-replayable, proof-of-possession** credential; a secret that never transits the wire, never enters git, never passes through an operator's hands, and cannot leak from the gateway's own store because the gateway never holds it — **without any PKI at all.** The gateway holds only a public key, which is safe to commit, safe to log, safe to render in the portal, and safe to leak.

**So, to answer the question directly: no, a certificate authority is not needed, and neither is a certificate.** What is needed is one Ed25519 keypair per consumer, generated locally.

Three secondary reasons, each of which removes something the plan would otherwise have had to build:

1. **Revocation is already solved.** With mTLS, revoking a credential means a CRL or OCSP responder. With `private-key-jwt`, revocation is deleting a public key from a git record and flipping `status: suspended` — which is §1.3.4's existing five-granularity kill switch (`forge kill consumer:<id>`) and its 5-second hot-reload poll. **Nothing new.**
2. **The registry becomes secret-free.** Because the gateway-side material is public, the highest-value item in the consumer registry is a public key. This measurably reduces **R15** ("consumer-credential compromise — the front-door key is now the highest-value single secret"): after this decision, the front-door private key exists in exactly one place, on the consumer's own machine, and the gateway is not a place worth stealing it from.
3. **It is the Wave 1 OIDC path already.** §1.3.7's corroboration model, and `private_key_jwt` client authentication in OAuth 2.1, are the same mechanism. Choosing it at Wave 0 means the Wave 1 swap changes the *issuer* of the user token, not the consumer-authentication method.

**One consequence to record honestly:** an MCP client such as Claude Desktop cannot itself mint a signed JWT assertion. Wave 0's local consumers therefore connect through the small first-party client shim (`forge connect`, below), which holds the key in the OS keychain and signs the assertion on the client's behalf. This is a shim, not a proxy — it does not see or alter tool traffic, and it is the same code path `forge dev`'s `portal-local` self-registration (`W0-N11`) already needs.

### A.3 Decide now, issue later — the split

These are two different acts and conflating them is what makes this question feel unanswerable:

| | **What it is** | **When** | **Why then** |
|---|---|---|---|
| **(a) The mechanism** — `private-key-jwt` as the default, Ed25519, assertion format, where the private key lives, what the record holds | An **architecture decision**. It is literally what `W0-N2`'s `done:` clause ("authenticates the consumer by mTLS, private-key-JWT or client secret") will implement, and what `W0-N1`'s record validation must accept. | **Now — settled by this addendum.** | Leaving it open means `W0-N2` either implements all three at equal depth (waste) or picks one on the afternoon it is built, unreviewed. It also determines whether Wave 0 has a CA dependency — a question that has to be answered *before* the wave, not during it. |
| **(b) The credential for a specific real agent** — generating the actual keypair for the developer's actual Claude Desktop, registering it, approving it | An **operational step**. It requires the gateway, the registry and the CLI to exist to issue against. | **After the build reaches `W0-N1`/`W0-N2`/`W0-N11`** — naturally, as part of standing Wave 0 up for its first real session. | There is nothing to issue against before then, and a credential generated now would sit unused past a rotation interval. This is already tracked: it is the second half of the memory file's ranked open item 2 ("approve the initial consumer registrations", alongside `W0-HG8`'s `p2p × function` standing authorization). **No pre-build action is required of the user for (b).** |

**Net: nothing is blocked on the user today.** The decision is made here; the runbook below is executed once, at `W0-N2` time.

### A.4 The runbook — issuing and installing a Wave 0 consumer credential

Grounded in the `forge consumer` / `forge secrets` commands already named in `CLAUDE.md` §"useful commands". Run once per consumer, on the machine that will hold the session.

**1 — Scaffold the record** (existing command, §1.3.3):

```
forge consumer new --id claude-desktop-coe --class interactive-client
```

Writes `consumers/claude-desktop-coe.consumer.yaml` from the §1.3.2 template. Fill in `owner`, `steward`, `expiresAt`, `authorizations` and `limits` by hand — these are the reviewable part.

**2 — Generate the keypair, on the consumer's machine:**

```
forge consumer issue-credential claude-desktop-coe --method private-key-jwt
```

Three things happen, and the split is the whole point:

- An **Ed25519 keypair** is generated locally.
- The **private key** is written to the `SecretStore` (§4.3.1 — `OsKeychainStore` interactively, `EncryptedFileStore` at `./.mcpforge/secrets.age` headless) under `secretRef://consumer/claude-desktop-coe/client`. **It is printed exactly once** and never again — the existing "prints once" behaviour in `W0-N1`'s `done:` clause. The command is refused when `CI=true` or the environment class is `staging`/`prod`, unchanged.
- The **public key** is written into the consumer record as a JWK, with a `kid`, and is committed to git.

```yaml
credential:
  method: private-key-jwt
  ref: secretRef://consumer/claude-desktop-coe/client   # consumer-side private key; the gateway never resolves this
  publicKeys:                                            # gateway-side verification material — PUBLIC, git-committed
    - kid: 2026-08-a
      kty: OKP
      crv: Ed25519
      x: <base64url>
      addedAt: 2026-08-28
  boundIssuers: [local]
  rotation: { intervalDays: 90, lastRotatedAt: 2026-08-28 }
```

> **Note the asymmetry, because it is easy to implement wrongly.** `credential.ref` names the **private** key, and it is meaningful **only on the consumer's side**; the gateway resolves it never. The gateway verifies against `credential.publicKeys[]`, inline in the record. A `client-secret` consumer keeps the original shape — `ref` only, resolved gateway-side, no `publicKeys`.

**3 — Get it approved** — no new machinery: `git` the record, raise the change proposal, merge on approval, which writes the `approvals/` record `W0-N1` requires. The diff a reviewer reads contains a public key and an authorization block, and no secret.

**4 — Point the agent at the gateway.** In the MCP client's config, the server entry runs the shim rather than the gateway directly:

```json
{ "mcpServers": { "mcpforge": {
    "command": "forge",
    "args": ["connect", "--consumer", "claude-desktop-coe", "--gateway", "http://localhost:7070"]
} } }
```

The shim reads the private key from the OS keychain by its `secretRef`, and on `initialize` presents an assertion signed with it: `iss` = `sub` = the consumer id, `aud` = the gateway's token endpoint, `jti` single-use, `exp` ≤ 60s, `kid` matching a record entry. **No secret appears in the config file.** A wrong or missing assertion is refused at `initialize` with `CONSUMER_UNREGISTERED` and no `tools/list` is served (`W0-N2`).

**5 — Verify:**

```
forge consumer show claude-desktop-coe --json     # status active, expiresAt, kids, authorizations
forge secrets status --json                       # age and next-due for the ref; non-zero past 2× interval
```

**6 — Rotation — 90 days (§4.3.2 rule 5), with overlap, no downtime:**

```
forge consumer rotate claude-desktop-coe
```

Generates a new keypair, **appends** the new public key beside the old one (both `kid`s verify during the overlap window), and updates the private key in the store. The shim signs with the new `kid` on its next start. The old entry is removed by the next merge, which is the act that ends the overlap. Same dual-key-overlap discipline `W0-N6` applies to the confirm-token HMAC and the signing key — and for the same reason: a hard cutover turns a routine rotation into an outage.

**7 — Emergency:**

```
forge kill consumer:claude-desktop-coe --reason "…"   # effective in ≤5s, no redeploy, audited with author and reason
forge secrets revoke secretRef://consumer/claude-desktop-coe/client --reason "…"   # invalidates AND kill-switches dependents in one act
```

### A.5 What this does and does not change

- **No task is added, removed, renumbered or reordered.** 111 tasks / 43 Opus / 60 Sonnet / 8 human stands. `W0-N2` implements a named default instead of an open choice; `W0-N11` and `W0-N1` are unaffected in substance.
- **One refinement `W0-N1` should absorb when it is built, flagged rather than silently applied here:** its `done:` clause requires validation to reject a record "whose `credential.ref` is not a `secretRef://` URI". That rule stays correct for `client-secret`, but for `private-key-jwt` the record must also carry a `credential.publicKeys[]` array, and validation must require **at least one** entry (and reject an inline *private* key outright, as `overlay-purity`'s content check in §4.3.2 rule 1 already would). This is a one-rule addition inside an existing task, not a new task.
- **`W0-N6`, `SecretStore` and every rotation interval are unchanged.**
- **R15 is materially reduced** and should be re-scored at the Wave 0 checkpoint: the gateway no longer stores any consumer credential capable of impersonating a consumer.
