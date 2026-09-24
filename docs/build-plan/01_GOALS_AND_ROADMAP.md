# MCPForge — Real Application: Goals and Roadmap
**Phase 1 of 4 · Planning stream: REAL PRODUCTION APPLICATION (not the concept console)**
Written 27 Aug 2026 · Status: draft for user sanity-check before Phase 2

---

## 0. How to read this document

**Audience, in order:** Phase 2 (architecture / stack / tool-discovery mechanism), Phase 3 (UX design system), Phase 4 (autonomy, model routing, task backlog), and finally an autonomous Claude Code + PowerShell build process running on the user's machine.

**Rule for later phases:** this document sets *what must be true and in what order*. It deliberately does **not** choose stack, framework, schema syntax, screen layouts or task granularity — those are Phase 2/3/4's job. Where this document names a number (a token ceiling, a tool count, an exit criterion), later phases may argue it down or up **with a written reason recorded at the next checkpoint**, but may not silently ignore it.

**Paths (fixed):**
- Application code: `C:\GenAIGenerated\LTM\MCP\MCPForge\`
- All planning/docs: `C:\GenAIGenerated\LTM\MCP\MCPForge\docs\build-plan\`
- Concept console (demo artefact, **not** a code dependency): `C:\GenAIGenerated\LTM\MCP\mcpforge-console_1.html`

**Inherited, settled, not to be re-litigated** (from `omf_architecture_decisions.md` + `mcpforge_build_spec.md` Rev 4):
1. Server boundary = **module**, 5–15 tools per server. Split when any two of: >15–20 tools · different auth boundary · different owning team · different release cadence · different data-sensitivity class.
2. **No Tier-4 deployable process layer.** Procure-to-Pay / Order-to-Cash / Record-to-Report are **process-scoped roles** — curated bundles of tool scopes across module servers, granted as one role. Module is the deployment boundary; process is a cross-cutting tag.
3. **Manifest-first.** A YAML tool manifest in git is the source of truth. Handlers, schemas, tests, docs, portal cards and evals are all generated from it. The portal is a UX over git, never a database-only system of record.
4. **`bindingType` is a required, first-class manifest field**, enum `rest | database | plsql | function | wrapped-vendor`, orthogonal to archetype. It selects the security-handshake template, the sandbox harness, and the default review path.
5. **A deployment package ("slice") is a named list of module servers plus the process roles that span them.** It carries no code of its own. Slicing never requires a fork; customer specifics are overlay config on the same base. Invariant core (gateway, registry, governance, audit, manifest schema) ships identically everywhere.
6. **Hosting:** customer engagements run customer-hosted in the customer tenancy; the CoE runs one LTM-managed internal instance. Same bundle, two configs.
7. **Client scope:** spec-baseline MCP (2026-07-28). No Claude-specific assumptions. No BlueVerse/REST facade in scope.
8. **No code dependency** on MORPH-ED or other accelerators. Process taxonomy may be seeded from the Novigo.AI 240-agent / 169-use-case libraries — those are documents, not code.
9. **The MCP layer never holds more privilege than the human using it.** — **EXTENDED by §11 (Phase 5, 27 Aug 2026):** and no call is accepted from an unregistered consumer, regardless of the human identity it presents.
10. **Facilitator, not just enabler** — MCPForge actively discovers, generates, governs and matches; it does not wait to be asked.

**Explicitly NOT settled and NOT settled here:** the commercial packaging of a customer-facing slice. See §5 (Decision Gate D1).

---

## 1. What is actually being built

MCPForge (the real application) is **a governed control plane and runtime gateway that turns Oracle application capability into MCP tools**, comprising five parts:

| Part | What it is | App-dependence |
|---|---|---|
| **Manifest pipeline** | YAML manifests in git → generated handlers, JSON schemas, contract tests, portal cards, eval sets, docs | Independent |
| **Gateway** | The single MCP endpoint a client sees. Resolves identity, applies process-scoped roles, routes to module servers, enforces caps, writes the audit record | Independent |
| **Module servers** | 5–15 tools each, one per application module. Independently deployable | Independent shell, app-dependent bindings |
| **L0 adapters + bindings** | The only genuinely app-specific code — one per `bindingType` per application | **Dependent** |
| **Portal (Tool Forge)** | Registry, Developer Workspace, Business Intake, Governance & Approvals, Consumption Graph, Application Enablement — a UX over git | Independent |

The **70/30 split** (from `mcpforge_enablement_facts.md`) governs sequencing: ~70% of the product is application-independent and buildable with zero customer dependency; only L0 adapters and individual bindings wait on app-side enablement. **Therefore the invariant core is never the thing that blocks a wave** — enablement is. Any roadmap that shows the core blocking is wrong.

### Non-goals (guard against scope drift)
- Not rebuilding first-party vendor MCP servers (OCI/ServiceNow/Salesforce) — those are **wrapped**.
- Not a deployable process-composition runtime (that is decision #2 above).
- Not an agent framework, not a chat product, not an ETL/data-pipeline product.
- Not a REST/BlueVerse facade over the tools.
- Not a fork-per-customer delivery model.

---

## 2. Product goals — testable outcomes by maturity level

Nine goals (G1–G9). Each maturity level states what must be **objectively true**, not what is aspired to.

**Maturity levels** (each is reached at the end of the named wave, see §4):

| Level | Name | Reached at | One-line definition |
|---|---|---|---|
| **M0** | Reference | end of Wave 0 | One module slice is genuinely real, end to end, in one deployment |
| **M1** | Multi-application | end of Wave 1 | The gateway fronts more than one application; two slices ship from one base |
| **M2** | Governed at scale | end of Wave 3 | ~100 tools, write path proven across multiple binding types, governance is the only route in |
| **M3** | Full catalogue | end of Wave 5 | 42 servers / 150 tools parity; every application in the catalogue is reachable |
| **M4** | Product-grade | post-Wave 5, **conditional on D1** | Customer-deployable slices with a versioned overlay, upgrade and support path |

### G1 — Manifest is the source of truth
- **M0:** Every live tool exists as a YAML manifest in git. Handler, JSON schema, contract test, portal card and eval set are all **generated** from it. Deleting a generated artefact and re-running codegen reproduces it byte-identically. **Zero hand-edited generated files** — enforced by a CI check that regenerates and diffs.
- **M1:** A manifest change is the *only* way a tool changes. Direct edits to a running server's tool surface are structurally impossible (server loads from the generated bundle, not from a database).
- **M2:** Manifest schema is versioned; a manifest written at v1 still builds after a schema minor bump, or codegen fails loudly with a named migration.
- **M3:** All 150 tools carry a valid manifest. Schema validation passes at 100%, no exemptions, no `TODO` bindings in main.

### G2 — Gateway is the only door
- **M0:** One MCP endpoint. Every call carries a resolved caller identity. Every call produces an immutable audit record containing: caller, tool id, binding type, target system, parameters (redacted per sensitivity class), result status, row count, latency. **No path to a module server that bypasses the gateway** — proven by attempting a direct module-server call from outside the trust boundary and having it refused.
  > **EXTENDED by §11 — Phase 5, 27 Aug 2026.** M0 additionally requires that every call carries a **registered, active, authorized consumer** as well as a resolved human identity, and that an unregistered consumer is refused at session establishment.
- **M1:** Process-scoped roles are enforced at the gateway. A caller holding the P2P role sees exactly the P2P tool scope, no more — verified by an automated scope test per role.
- **M2:** Gateway enforces row caps, timeouts, and per-tool rate limits. Kill-switch: any single tool, server, or binding type can be disabled at runtime without a redeploy, and the disabled tool reports an agent-actionable reason rather than a generic error.
- **M3:** Gateway latency overhead is measured and published (target: p95 gateway-added latency < 150 ms excluding target-system time), and it does not degrade as catalogue size grows.

### G3 — Identity and privilege
- **M0:** For every live tool the manifest declares its identity-carriage status, and the **capability probe has verified it against the real instance** — not assumed. For `function` bindings specifically (which Wave 0 is built on), the probe reports which context the orchestration actually ran under.
- **M1:** No tool is marked identity-carrying without probe evidence. Any tool whose probe reports service-account execution is automatically constrained to read-only, low-sensitivity data, or blocked.
- **M2:** The claim "the MCP layer never holds more privilege than the human using it" is a **test**, not a sentence: an automated privilege-escalation suite attempts, per binding type, to reach data the caller cannot reach natively. 100% of attempts fail closed.
- **M3:** Every one of the five binding types has a documented, implemented and tested handshake template. Zero binding types in production without one.

### G4 — Governance is unbypassable
- **M0:** Every tool that went live in Wave 0 went through the review path its binding type mandates (`plsql`/`function` = standard review always; expedited never available). Evidence: approval record per tool.
- **M1:** Duplicate/near-duplicate detection runs at intake and blocks a submission scoring above the similarity threshold from reaching review without a merge-or-justify decision.
- **M2:** No production path exists that puts a tool live without an approval record. Attempting one fails the deployment. Security-anomaly monitoring is live and has produced at least one true-positive or a documented zero-finding period.
  > **EXTENDED by §11 — Phase 5, 27 Aug 2026.** The monitoring *substrate* — consumer usage counters, the `anomaly_event` schema, the detector interface and three detectors — is Wave 0 scope. The monitoring *product* named here remains M2/Wave 3.
- **M3:** Governance metrics published: mean time to review, expedited-vs-standard mix, duplicate-merge rate, tools disabled by probe.

### G5 — Token efficiency and fast tool discovery *(see §3 for full metric definitions)*
- **M0:** Baseline measured and recorded. Wave 0's 11 tools sit under every ceiling trivially — the point at M0 is that the **measurement harness exists and runs in CI**, not that the numbers are good.
- **M1:** All five metrics (TTFC, VTC, DH, SA@1, MTB) meet their targets at ~53 tools across ≥3 applications. This is the first wave where the mechanism is load-bearing and it is a **hard gate**.
- **M2:** The **scaling invariant** holds: adding a module server does not increase TTFC for an unrelated existing role by more than 5%. Measured wave-on-wave from M1's baseline.
- **M3:** Invariant still holds at 150 tools. Published figure: tokens consumed per successful business action, versus the naive full-catalogue baseline. Target: **≤ 25% of naive**.

### G6 — Enablement survives contact with real instances
- **M0:** The capability probe runs at install and produces a real enablement backlog against a real instance. **Zero silent failures** — a binding that does not resolve is auto-disabled, visibly, with the owning team named. A tool never fails first in a demo or in front of a user.
- **M1:** Probe covers all five binding types. Probe output is a machine-readable artefact consumed by the portal, not a log file someone reads.
- **M2:** Probe has run against at least one instance the LTM CoE does **not** own, and its predictions were compared against `mcpforge_enablement_facts.md`; that file was updated with actuals.
- **M3:** Probe covers every application in the catalogue. Any tool disabled by the probe for two consecutive waves is either fixed or retired — no permanently dark tools.

### G7 — Slice without fork
- **M1:** Two different slices are deployed from the same base. A build-artefact diff shows **only overlay configuration differs** — zero divergence in the invariant core, zero manifest divergence, zero code fork. This is the technical proof D1 depends on.
- **M2:** A slice runs **headless** (gateway + tools, no portal) and passes the same contract-test suite as the full instance. Required because "does a slice ship with the portal" is an open commercial question that cannot be priced if it cannot be shipped.
- **M3:** Slice definitions are versioned artefacts; a customer overlay can be upgraded to a newer base without manual reconciliation.

### G8 — The build is autonomous-friendly
- **M0:** A complete module server (manifest → generated handler → tests → probe → portal card) can be added by an autonomous Claude Code run from a written specification, with human judgment required only at named decision points. Measured: proportion of Wave 0 tasks completed without human intervention.
- **M1:** ≥ 70% of new-tool tasks complete unassisted. Every intervention is logged with its cause, and the causes feed spec improvements at the checkpoint.
- **M2:** ≥ 85% unassisted. Adding a tool to an **already-enabled** application is a routine autonomous task.
- **M3:** Adding a whole module server to an already-enabled application is a routine autonomous task.

### G9 — The catalogue is demand-driven, not aspirational
- **M1:** Consumption graph is live: every tool → consuming agent, platform, scope, call count.
- **M2:** Any tool with zero calls two waves after going live is reviewed at the checkpoint for retirement. The catalogue is not allowed to grow purely because a spec listed 150 tools.
- **M3:** Published: percentage of catalogue with at least one real consumer. **This number being low is a finding, not a failure to hide.**

---

## 3. The token-efficiency goal, stated measurably

> **Goal statement:** *An agent working through MCPForge must never pay — in context, in latency, or in wrong turns — for the part of the Oracle estate it is not using. Finding the right tool must cost close to nothing and must not get more expensive as the catalogue grows.*

This is a **first-class product goal with CI gates**, not an optimisation to do later. It is also the commercial differentiator: it is what makes a 150-tool estate usable by an agent at all, given the already-recorded finding that tool-selection accuracy degrades past ~40–60 visible tools.

### The problem, quantified
Naive exposure of the full catalogue means loading 150 tool definitions before the first useful token. At a realistic 150–400 tokens per full tool schema that is **22,000–60,000 tokens** of context spent on tools the agent will not call, *every session*, plus a selection-accuracy cliff. The already-settled architecture (module servers, process-scoped roles, packages, a closed verb vocabulary, `functionalArea` and `bindingType` as manifest fields) is the raw material for the fix. **Phase 2 designs the mechanism; this section defines what the mechanism must achieve.**

### The five metrics

| # | Metric | Definition | Target |
|---|---|---|---|
| **M-1** | **TTFC** — Tokens To First Correct Call | Total tokens of tool-definition and discovery content the agent consumes from session start until it emits the correct tool call for a benchmark task | **≤ 2,000** for a session opened in a known process role · **≤ 4,000** cold (no role hint, full catalogue) |
| **M-2** | **VTC** — Visible Tool Count | Number of full tool definitions resident in the agent's context at any one moment | **≤ 30 default · hard cap 40** (below the recorded 40–60 degradation threshold) |
| **M-3** | **DH** — Discovery Hops | Round trips from natural-language intent to the correct domain tool call | **median ≤ 2** (one discovery call + the real call) · **p95 ≤ 3** |
| **M-4** | **SA@1** — Selection Accuracy at first attempt | Correct tool chosen first try, on the benchmark suite | **≥ 90% at M2 · ≥ 95% at M3** |
| **M-5** | **MTB** — Manifest Token Budget | Cost of the compact catalogue representation | **tool card ≤ 60 tokens** (id, one-line purpose, verb, entity, bindingType, sensitivity, role tags) · **full schema ≤ 400 tokens** · a 5-item shortlist ≤ 300 tokens |

### The scaling invariant (the one that actually matters)
> **TTFC must be effectively O(1) in catalogue size.** Adding a module server must not increase TTFC for an unrelated existing role by more than **5%**.

Measured at every wave boundary against the M1 baseline. A wave that breaks this invariant cannot be closed as PROCEED without an explicit written waiver.

### Two supporting requirements
- **No dead ends.** Every error path returns an agent-actionable message naming the condition and the next tool to try (this already exists as a design element in the tool-detail drawer spec). Metric: **100% of error paths carry a next-action hint; zero dead-end errors in the eval suite.**
- **Negative cases count.** The benchmark suite must include out-of-catalogue intents where the correct answer is *"no tool exists"* — and near-miss pairs within a module (e.g. `…invoice.get` vs `…invoice.search`). Returning a plausible-but-wrong tool is scored as a failure, equal in weight to returning nothing.

### The benchmark suite (build it in Wave 0, grow it every wave)
- ≥ 10 labelled natural-language intents **per module server**, authored by whoever owns that module — not by the person who wrote the tool.
- ≥ 20% near-miss pairs, ≥ 10% out-of-catalogue negatives.
- Runs in CI on every manifest merge. All five metrics reported per run. Regression on any metric fails the build.

### Constraint handed to Phase 2 (important)
Settled decision #7 is **spec-baseline MCP, no Claude-specific assumptions**. Therefore **the discovery mechanism must be server-side / gateway-mediated** — it cannot depend on client-side progressive disclosure, client tool-filtering, or any client feature outside the 2026-07-28 baseline. If Phase 2 concludes the targets are unreachable server-side alone, that is a genuine conflict between goals G5 and decision #7 and must be escalated to the user at the Phase 2 checkpoint, not resolved unilaterally.

---

## 4. The staged roadmap

### 4.0 Sequencing logic — why these waves, in this order

Three rules, applied in priority order:

1. **Sequence primarily by enablement cost, not by importance.** This is already researched and verified (`mcpforge_enablement_facts.md`): SaaS/OIC/FDI/OAC/JDE first → PeopleSoft second → Siebel third → Hyperion fourth, **with EBS running as a parallel track from day one** because it needs the longest runway. Enablement, not engineering, is the calendar constraint. Sequencing by business importance would put EBS first and stall the whole programme on ISG paperwork.
2. **Within a wave, choose module servers that complete a named process.** Each wave must have a business story that can be demonstrated end to end, not a pile of unrelated tools. This is what makes process-scoped roles (decision #2) real rather than theoretical.
3. **Every wave must break new architectural ground, not just add volume.** Each wave below names the specific claim it proves. A wave that only adds tools of a kind already proven is a candidate for merging into its neighbour at the checkpoint.

**Depth before breadth is mandatory at Wave 0** and is the user's explicit instruction: one module fully real end to end — real manifest pipeline, real gateway, real portal, real tool execution — before anything widens. No skeleton-first breadth.

---

### 4.1 Wave 0 — Reference module, genuinely end to end

**Recommendation: `jde-fin`. Keep it. The existing reasoning holds and is not improved on.**

The slice is already defined in the concept spec's `PACKAGES` constant: `jde-fin-gl`, `jde-fin-ap`, `jde-scm-po` — **3 module servers, 11 tools**.

**Why jde-fin (reasoning reused and extended):**
- *Recorded reason (holds):* JDE Orchestrator Studio orchestrations are **already tool-shaped** — named, typed inputs, governed. The binding is close to 1:1, so Wave 0 spends its effort on MCPForge's own architecture rather than on inventing a tool contract.
- *Enablement cost:* Low, 1–2 weeks. The app-side work is composing orchestrations — low-code work for a JDE functional/CNC person, not developer work. Lowest-friction on-prem target in the estate.
- *It exercises the hard binding, not the easy one.* `function` binding: identity carriage **must be verified per binding, never assumed** — the same open question OIC raises. Proving the probe can answer that question is worth more in Wave 0 than proving REST works.
- *It exercises the cross-module process role.* The slice deliberately reaches from Financials into Procurement (`jde-scm-po`) because Procure-to-Pay spans them. That makes process-scoped roles (decision #2, the replacement for Tier-4) real in Wave 0 rather than a claim deferred to Wave 3.
- *It is already a named, sized reference slice*, so Wave 0 and the slice mechanism are proven by the same work.

**The alternative considered and rejected: `saas-fin` (Fusion Financials).** It is genuinely cheaper — provisioning only, days not weeks — and it is the **only** place in the estate where identity carries end to end natively with no compensating control. If the objective were fastest-time-to-first-working-tool, saas-fin wins outright. It is rejected for Wave 0 because it would prove **only the easy path**: REST/OAuth binding, single application, native identity, no cross-module role. Wave 0 would end with the two hardest architectural claims (non-REST identity carriage, cross-module process roles) still unproven at exactly the point the catalogue starts widening. Wave 0's purpose is de-risking, not speed.

**Hard prerequisite and fallback trigger:** Wave 0 requires a reachable JDE instance with AIS Server deployed and Orchestrator Studio available on the Tools release in use. **If no such instance is confirmed reachable within the first week of Wave 0, swap Wave 0 and Wave 1** — build `saas-fin` as the reference instead — and record the cost explicitly: the `function`-binding identity question and the cross-module role then move to Wave 1 and **must not be dropped or deferred further**. This is a pre-declared contingency, not a decision to make later under pressure.

**Wave 0 scope:**
- 3 module servers, 11 tools, the full manifest pipeline, the gateway, the capability probe, the portal (Registry + Developer Workspace + Governance minimum), the audit trail, the eval/benchmark harness.
- One Procure-to-Pay process-scoped role spanning all three servers.
- **Write scope — recommendation requiring user confirmation:** exactly **one** write tool, taken through the full path (dry-run → confirmation round-trip → execute → immutable audit record). *Rationale:* the "read-only Wave 1 vs narrow write slice" question is recorded as open. A read-only Wave 0 leaves the highest-risk path unproven until the catalogue is wide — which is the worst possible moment to discover the write, confirmation, rollback and audit design is wrong. One write tool is the minimum blast radius that proves it.
- **SUPERSEDED — the bullet immediately above no longer holds. Correction applied by Phase 2, per user direction, 27 Aug 2026.** Wave 0 targets **near read/write parity** (6 write-capable tools, 5 read tools), not one write tool. The replacement scope, the rebalanced 11-tool selection, the revised exit criterion 7 and the raised risk/effort profile are in **§10** at the end of this document. The superseded bullet is retained above as the record of what was originally recommended.

**Also in Wave 0, non-code:** kick off the **EBS enablement track** (ISG responsibility grant, IREP interface inventory, wrapper-schema request). Paperwork only, zero build. EBS has the longest runway; starting it at Wave 2 means it lands at Wave 4.

---

### 4.2 Waves 1–5 — how breadth widens

| Wave | Name | Content | New tools | Cum. tools | Cum. % | The claim it proves |
|---|---|---|---|---|---|---|
| **W0** | Reference module | `jde-fin` (GL, AP, PO) | 11 | 11 | 7% | The whole pipeline is real for one slice; `function`-binding identity is verifiable; cross-module process roles work |
| **W1** | Provisioning-only breadth | `saas-fin` (16) + `analytics` slice — OAC, FDI, AI Data Platform, Autonomous AI DB (20) + OIC (6) | 42 | **53** | 35% | Multi-application gateway; **the discovery mechanism becomes load-bearing**; two slices from one base; `rest` + `database` + `wrapped-vendor` bindings all live |
| **D1** | **Decision gate — commercial packaging** | *Not a build wave.* See §5 | 0 | 53 | — | — |
| **W2** | Long-runway landing + cheap volume | `ebs-p2p` (16) + JDE remainder (6) + PeopleSoft PS Query read-only set (5) | 27 | **80** | 53% | `plsql` binding, wrapper-schema pattern, MO_GLOBAL context init — **the hardest security surface in the estate** |
| **W3** | Cross-application process slice | `svc-field` — Siebel + Oracle Field Service (16) + PeopleSoft remainder, ASF + Component Interfaces (5) | 21 | **101** | 67% | A package bounded by **process, not product** — two applications, one slice; ASF/OpenAPI harvest path |
| **W4** | Hardest LTM-side development | EBS remainder (10) + Hyperion/Essbase (8) + EPM Cloud (10) | 28 | **129** | 86% | MaxL/CalcScript/LCM wrapping; identity under a wrapper host; the estate's deepest legacy surface |
| **W5** | Catalogue completion + hardening | Fusion remainder (6) + Commerce (6) + Sales Cloud (5) + CPQ (4) + server-density remediation | 21 | **150** | 100% | Full-catalogue parity: 42 servers, 150 tools, every application reachable |

**Server counts:** W0 = 3 · W1 ≈ 11 (cum. ~14) · W2 ≈ 8 (cum. ~22) · W3 ≈ 6 (cum. ~28) · W4 ≈ 7 (cum. ~35) · W5 ≈ 7 (cum. **42**). *Server counts beyond the named `PACKAGES` slices are approximate — the concept catalogue's exact server-to-app mapping for the long tail is not recorded in memory and must be extracted from the console catalogue in Phase 2 (see §6, R3).*

**Tool-count arithmetic check** (against the recorded per-app catalogue: ebs 26 · jde 17 · fusion 22 · epm 10 · psft 10 · siebel 8 · ofsc 8 · commerce 6 · sales 5 · cpq 4 · oic 6 · oac 6 · fdi 8 · hyperion 8 · aidp 3 · adb 3 = **150**): 11 + 42 + 27 + 21 + 28 + 21 = **150** ✓

**Wave notes:**
- **W1 is the make-or-break wave for the token-efficiency goal.** It is where the catalogue crosses the 40–60 visible-tool degradation threshold for the first time. G5's targets are a **hard gate** at W1 — a wave that widens the catalogue past the threshold without a working discovery mechanism has produced a product that is worse to use than Wave 0, which is the specific failure this programme exists to avoid.
- **W1 mixes a full process slice (`saas-fin`) with a read-only breadth slice (`analytics`) deliberately.** The analytics slice contains **no write tool at all**, so it adds catalogue volume — the thing that stresses discovery — at near-zero governance and identity risk.
- **W2 is where EBS lands**, ~2 waves after its enablement track started in W0. If the EBS track is not visibly progressing at the W1 checkpoint, W2 is resequenced (PeopleSoft is promoted, EBS slips to W3) — this is exactly the kind of call the checkpoint exists to make.
- **PeopleSoft is split across W2 and W3 on purpose.** PS Query REST needs no development at all and is the fastest route to a large read-only tool set — take it early and cheaply in W2. The ASF services and Component Interfaces, which need real configuration and carry the `function`-binding identity question, wait for W3.
- **W5 is not padding.** It carries the recorded server-density remediation (General Ledger 4, Accounts Receivable 3, Inventory 2 against the 5–15 target — top-up or merge, user's call) and the G9 retirement pass. Both are real work with architectural consequences.

**Throughput assumption (must be confirmed by the user before Phase 4 plans a schedule):** these waves are sized as **tool budgets, not durations**. No calendar dates are asserted because team size, review capacity and number of parallel enablement tracks are unrecorded. Once the pipeline exists (post-W0), throughput is bounded by **review capacity and app-side enablement, not by code generation** — which is why the autonomy goal G8 targets review-adjacent tasks, and why the enablement tracks start early.

---

## 5. Decision Gate D1 — customer-facing slice, commercial packaging

**This is a decision point, not a build wave. It has no code deliverable and no wave number. No build wave blocks on it.**

**The question (recorded as explicitly open, not to be resolved by any planning phase):** should MCPForge be a customer-facing accelerator, sliced per application/module — and if so, on what terms? Four sub-questions, all open:
1. Licensing unit — per module or per tool?
2. Does a slice ship with the portal (Registry / Governance / Developer Workspace), or only the gateway plus a fixed tool set?
3. Hosting — LTM-managed or customer-hosted?
4. Does facilitator behaviour (intake, dedupe, governance) travel with the slice, or stay an LTM-delivered layer on top?

Rev 4 of the concept spec settled the **architecture** of slicing (§4 of that spec) and deliberately nothing else. The positioning line in `omf_architecture_decisions.md` ("internal CoE accelerator, not a productised asset") is **reopened, not superseded**. Do not treat it as settled either way.

### Technical proof required before this conversation is worth having
D1 should not be convened until all five of these are demonstrably true:

| # | Proof | Where it comes from |
|---|---|---|
| **P1** | **Two different slices deployed from one base**, with a build-artefact diff showing only overlay configuration differs — zero core divergence, zero manifest divergence, zero fork | G7 @ M1 (W1) |
| **P2** | **A slice deployed to a second, differently-configured environment** — not the CoE instance — with the invariant core untouched | W1 |
| **P3** | **The capability probe has produced a real enablement backlog against an instance the CoE does not own**, proving the "wildly variable instance" claim survives contact with reality | G6 @ M2, pulled forward into W1 if any customer instance is available |
| **P4** | **Headless mode proven** — gateway + tools with no portal, passing the same contract-test suite. *Sub-question 2 cannot be priced if the product cannot be shipped that way* | G7 @ M2 — **pull this forward to W1** specifically to unblock D1 |
| **P5** | **Actual effort and cost figures** from W0 and W1 — real hours per module server, per tool, per enablement track — to price against instead of estimating | W0 + W1 checkpoints |

### Timing
**D1 convenes immediately after the Wave 1 checkpoint** — the earliest point at which P1, P2, P4 and P5 exist and roughly 35% of the catalogue is live across three or more applications. Convening earlier means pricing a mechanism nobody has run twice. Convening later means the commercial answer arrives after W2–W3 have already made irreversible-ish choices about what ships with a slice.

### Rules for D1
- **It is gated separately and decided by the user (and whoever owns commercial strategy), not by a build wave and not by a planning phase.**
- **W2 must be startable regardless of D1's outcome or delay.** If D1 slips, W2 proceeds. Nothing in the build sequence is allowed to become blocked on a commercial decision.
- **Its outputs become constraints on W2+**, recorded as a decision record in `build-plan/` and propagated into project memory.
- If D1 resolves to "internal CoE only," maturity level **M4 is struck from the roadmap** and W5 becomes the end state. If it resolves to customer-facing, M4 becomes a real wave with its own scope (versioned overlays, upgrade path, support model, packaging) to be planned then — **not now**.

---

## 6. The "revisit strategy" checkpoint — a real recurring process step

**Every wave boundary has a checkpoint. It is mandatory, timeboxed, has a fixed agenda, and produces a written artefact.** This is the mechanism the user asked for explicitly: execute one wave, then revisit strategy before committing to the next.

**Artefact:** `C:\GenAIGenerated\LTM\MCP\MCPForge\docs\build-plan\WAVE_<N>_CHECKPOINT.md`
**Verdict — exactly one of three, stated at the top of the artefact:**
- **PROCEED** — next wave starts as planned.
- **RESEQUENCE** — next wave changes content or order. The change and its reason are recorded; the roadmap table in this document is amended, not replaced.
- **STOP-AND-FIX** — no new wave starts. A remediation wave is defined with its own exit criteria.

### Fixed agenda — all eight items, every time

**1. Exit-criteria audit.** Each numbered exit criterion for the closing wave, marked pass/fail with a link to evidence (test run, probe output, approval record, metric report). **Any fail blocks PROCEED unless an explicit written waiver names who accepted the risk and until when.** No implicit passes.

**2. Metric trend review.** TTFC · VTC · DH · SA@1 · MTB · scaling-invariant delta · probe resolution rate · contract-test pass rate · mean review time per tool · unassisted-autonomy rate. Compared against the previous wave. **Any regression is a mandatory discussion item**, even if the absolute number still passes.

**3. Architecture-invariant re-test.** Did anything in this wave force a violation of the ten settled decisions in §0 — particularly the module boundary, no-Tier-4, manifest-first, no-fork, and never-more-privilege-than-the-human? A violation is resolved one of two ways only: a written architecture change record that supersedes the decision, or a rollback. **Silent drift is the specific failure mode this item exists to catch.**

**4. Enablement reality vs prediction.** What the capability probe actually found in this wave, against what `mcpforge_enablement_facts.md` predicted (effort tier, version gates, binding types reachable, ownership). **Update that memory file with actuals.** This is the single largest input to resequencing — an application that came back materially harder or easier than predicted changes what the next wave should be.

**5. Sequencing re-decision.** Given items 2 and 4: is the next wave still the right next wave? **This is an explicit re-vote, not a default.** The person running the checkpoint must state the case for the planned next wave; if nobody can, the sequence changes.

**6. Autonomy retrospective.** What proportion of this wave the autonomous Claude Code + PowerShell lane completed unassisted. Every human intervention logged with its cause. **Each cause produces one of: a spec improvement, a new guardrail, or an accepted permanent human decision point.** This feeds Phase 4's model-routing and task-backlog design directly, and it is how G8's targets are actually reached rather than hoped for.

**7. Open-items ledger.** Items closed this wave · items newly opened · **items open for two or more consecutive waves are escalated to the user by name** — a chronically open item is either genuinely blocked (say so) or nobody owns it (assign it).

**8. Cost ledger.** Tokens and calendar time per tool delivered, per module server delivered, and per enablement track. Trend across waves. This is what makes D1's P5 real, and it is the honest test of whether the platform is actually making delivery cheaper.

### Checkpoint discipline
- Runs **before** any work on the next wave begins. Not in parallel.
- Timeboxed. If the agenda cannot be completed, the verdict defaults to **STOP-AND-FIX**, not to PROCEED-with-notes.
- The Wave 1 checkpoint additionally hands off to **D1** (§5) — the two are adjacent but separate: the checkpoint decides the build sequence, D1 decides commercial packaging, and neither decides the other's question.
- **Accessibility gate 5 (03 §12.7 — added by W0-J21).** Item 1's exit-criteria audit for any wave that shipped portal surfaces must include, as its own checklist line with a pass/fail and a date, a manual screen-reader pass (NVDA on Windows) over the write path and the catalog, once per wave. This is the one 03 §12.7 gate that is deliberately **not** a CI gate — it is judgement, not automation — and it is tracked here, in the wave's own `WAVE_<N>_CHECKPOINT.md`, precisely because "checked by a person once a quarter is accessibility that regresses in week two" (03 §12.7's own words). As of this task no `WAVE_0_CHECKPOINT.md` exists yet (Wave 0 has not closed) — this line is the standing instruction for whoever runs that checkpoint, not a claim that the pass has happened.

---

## 7. Wave exit criteria — what must be objectively true to close a wave

These are the criteria audited by checkpoint agenda item 1. Each is testable. "Working" and "done" are not criteria.

### Wave 0 exit criteria (→ M0)
1. **11 tools live** across 3 module servers (`jde-fin-gl`, `jde-fin-ap`, `jde-scm-po`), each with a YAML manifest in git as its sole source of truth.
2. **Contract tests pass at 100%** for all 11 tools. Regenerating every generated artefact from the manifests and diffing produces **zero differences**.
3. **Capability probe reports zero silent failures.** Every one of the 11 bindings is either resolved-and-live or auto-disabled-and-visible with an owning team named. No third state.
4. **Identity carriage verified, not assumed**, for every `function` binding: the probe reports which context each JDE orchestration actually executed under (calling user vs service account). Any tool that ran as a service account is constrained or blocked, with the decision recorded.
5. **Gateway is the only door:** a direct call to a module server from outside the trust boundary is refused, demonstrated in a test.
   > **EXTENDED by §11 — Phase 5, 27 Aug 2026.** Criterion 5 as written evidences the **egress** door only. §11.5 adds the ingress half as new criterion **14**; both are required to close Wave 0.
6. **One Procure-to-Pay process-scoped role** spans all three servers and grants exactly its declared scope — verified by an automated scope test (holder sees the P2P tools, nothing else).
7. **One write tool** completed the full path in a live run: dry-run → confirmation round-trip → execute → immutable audit record retrievable by tool id and caller.
   - **SUPERSEDED by §10.4 — Correction applied by Phase 2, per user direction, 27 Aug 2026.** Criterion 7 is now **six write-capable tools** through the full path, plus a live reversal, a refusal at confirm, a refusal at policy, and an idempotent replay. See §10.4 for the replacement wording.
8. **Every tool has an approval record** from the review path its binding type mandates (`function` bindings: standard review, expedited unavailable).
9. **Portal is a UX over git**: a manifest change in git appears in the portal without a database write; a portal-only edit is structurally impossible.
10. **The benchmark suite exists and runs in CI** — ≥ 10 labelled intents per module server (≥ 30 total), ≥ 20% near-miss pairs, ≥ 10% out-of-catalogue negatives. All five G5 metrics reported per run. **Baseline recorded.**
11. **100% of error paths return an agent-actionable next step.** Zero dead-end errors in the eval suite.
12. **EBS enablement track opened** — ISG responsibility holder named, IREP interface inventory started, wrapper schema requested. Evidence: a written status line, not an intention.
13. **Autonomy baseline recorded**: proportion of Wave 0 build tasks completed by the autonomous lane without human intervention, with every intervention logged and categorised.

### Wave 1 exit criteria (→ M1)
1. **~53 tools live across ≥ 3 applications** (JDE + Oracle SaaS + platform/analytics services), all manifest-backed, contract tests at 100%.
2. **All four non-`function` binding types live and tested**: `rest`, `database`, `wrapped-vendor` join `function`. Each has an implemented handshake template and a passing sandbox harness.
3. **G5 hard gate — all five metrics meet target at ~53 tools**: TTFC ≤ 2,000 (role-scoped) / ≤ 4,000 (cold) · VTC ≤ 30 default, ≤ 40 hard · DH median ≤ 2, p95 ≤ 3 · SA@1 ≥ 90% · MTB within budget. **A wave that widens the catalogue past the 40–60 degradation threshold without meeting these cannot be closed as PROCEED.**
4. **Scaling-invariant baseline established**: TTFC for the Wave 0 P2P role measured before and after Wave 1's additions; delta recorded (target ≤ 5%).
5. **P1 proven — two slices from one base.** Build-artefact diff shows only overlay config differs: zero core divergence, zero manifest divergence, zero fork.
6. **P2 proven** — a slice deployed to a second, differently-configured environment with the invariant core untouched.
7. **P4 proven (pulled forward)** — headless mode (gateway + tools, no portal) boots and passes the same contract-test suite.
8. **Process-scoped roles enforced at the gateway** for every declared role, each verified by an automated scope test.
9. **Duplicate detection blocks** a submission scoring above the similarity threshold from reaching review without a merge-or-justify decision — demonstrated with a real near-duplicate.
10. **Probe output is a machine-readable artefact** consumed by the portal, not a log file.
11. **Consumption graph live** — every tool → consuming agent, platform, scope, call count.
12. **No tool marked identity-carrying without probe evidence.** Every OIC tool either has verified user-context threading or is constrained to read-only, low-sensitivity data.
13. **Autonomy ≥ 70%** of new-tool tasks completed unassisted.
14. **P5 available** — real effort/cost figures per module server, per tool, per enablement track, from W0 and W1.

### Wave 2 exit criteria
1. **~80 tools live.** `ebs-p2p` (4 servers / 16 tools) live, JDE remainder live, PeopleSoft PS Query read-only set live.
2. **`plsql` binding proven in production shape**: every EBS package call goes through a **dedicated wrapper schema**; a test attempting direct execution against an APPS-owned package **fails the harness**.
3. **MO_GLOBAL / FND context initialisation** succeeds per call for a test user and org, and is asserted in the contract tests — not assumed.
4. **PeopleTools release verified ≥ 8.59** before any ASF work is scheduled (the version threshold is binary, not gradual).
5. **Privilege-escalation suite runs across all live binding types**; 100% of attempts fail closed.
6. **Scaling invariant holds** — TTFC for unrelated existing roles up ≤ 5% despite ~50% catalogue growth.
7. **EBS probe results reconciled** against the enablement facts file; the file updated with actuals (EBS is the application most likely to differ from prediction).
8. **Autonomy ≥ 80%**.

### Wave 3 exit criteria (→ M2)
1. **~101 tools live.** `svc-field` (Siebel + Oracle Field Service) live, PeopleSoft ASF and Component Interfaces live.
2. **A package bounded by process, not product, is deployed** — the `svc-field` slice spans two applications and runs as a single deployment.
3. **SA@1 ≥ 90%**, DH p95 ≤ 3, scaling invariant holds at ~100 tools.
4. **Governance is unbypassable**: no production path exists that puts a tool live without an approval record; attempting one fails the deployment, demonstrated.
5. **Security-anomaly monitoring live**, with either a true-positive found or a documented zero-finding period.
6. **P3 proven** — probe has run against an instance the CoE does not own, and predictions were reconciled against actuals.
7. **Kill-switch works**: any single tool, server or binding type disabled at runtime with no redeploy; the disabled tool reports an agent-actionable reason.
8. **Every Siebel business-service method's identity carriage verified per method** (not per application) — the `function` binding rule applied at the right granularity.
9. **Autonomy ≥ 85%**; adding a tool to an already-enabled application is a routine autonomous task.

### Wave 4 exit criteria
1. **~129 tools live.** EBS remainder, Hyperion/Essbase, EPM Cloud.
2. **MaxL / CalcScript / LCM wrapping in production**, with the execution identity of the wrapper host explicitly documented and constrained per tool — this is the estate's weakest identity story and must not be papered over.
3. **Essbase 21c REST paths distinguished from wrapped paths** in the manifests; only the REST paths may be marked identity-carrying.
4. **All five binding types have a documented, implemented, tested handshake template.** Zero binding types in production without one.
5. **Scaling invariant holds at ~130 tools.**
6. **G9 first retirement pass**: every tool live since W1 with zero calls is reviewed; retire-or-justify decision recorded per tool.

### Wave 5 exit criteria (→ M3)
1. **150 tools across 42 module servers** — full catalogue parity with the concept catalogue. Manifest schema validation passes at 100%, no exemptions, no `TODO` bindings on main.
2. **Server density resolved**: no live module server outside the 5–15 tool target without a recorded justification (General Ledger, Accounts Receivable and Inventory specifically — topped up or merged, decision recorded).
3. **SA@1 ≥ 95%.** Scaling invariant holds at 150 tools.
4. **Published headline figure**: tokens consumed per successful business action versus the naive full-catalogue baseline — **target ≤ 25%**.
5. **Gateway p95 added latency < 150 ms** (excluding target-system time), and it has not degraded as the catalogue grew.
6. **Zero permanently dark tools** — nothing disabled by the probe for two consecutive waves remains in the catalogue unfixed.
7. **Published**: percentage of catalogue with at least one real consumer. Reported honestly whatever it is.
8. **Adding a whole module server to an already-enabled application is a routine autonomous task.**

---

## 8. Open risks and assumptions carried forward

Every item below is inherited from project memory or discovered during this pass. **Later phases must respect these, not rediscover them.** Each names the phase that owns it and what happens if it is ignored.

### R1 — OIC service-account identity gap *(highest-severity inherited risk)*
**Owner: Phase 2.** OIC is the one place where a tool can silently run under a service account and quietly grant every caller the same access — flagged as a highlighted exception row in the concept console's governance table. **Hard constraint:** the gateway must refuse to mark any tool identity-carrying without probe evidence, and any tool whose probe reports service-account execution is automatically constrained to read-only, low-sensitivity data or blocked. *If ignored:* the central security claim ("the MCP layer never holds more privilege than the human") becomes false in production while the portal continues to assert it.

### R2 — The `function`-binding identity question is in Wave 0, not later
**Owner: Phase 2.** The same question OIC raises applies to **every** `function` binding — JDE orchestrations, Siebel business-service methods, Essbase MaxL/CalcScript/LCM wraps. It must be **verified per binding, never assumed, never per-application**. Wave 0 is built entirely on `function` bindings, so this is a Wave 0 problem. *If ignored:* Wave 0 ships with an unverified identity model and every later wave inherits it.

> **EXTENDED by §11 — Phase 5, 27 Aug 2026.** R1 and R2 concern *which human* a call acts as. §11 adds R15 and R16, which concern *which software* is making it and how the credentials behind non-identity-carrying bindings are held.

### R3 — The concept console is a demo artefact, not a source of truth
**Owner: Phase 2 (one-time task).** `mcpforge-console_1.html` (283,800 bytes, Rev 4, 27 Aug) is the canonical **demo**. The real application must **never** read from it at runtime. However, its embedded `SERVERS` (42), `TOOLS` (150), `RICH` (12), `PACKAGES` (6) and `ENABLEMENT` (7) JSON literals are the **best available catalogue seed**. Recommended: a **one-time extraction** of those literals into versioned seed YAML under `C:\GenAIGenerated\LTM\MCP\MCPForge\`, after which the console is frozen as a demo and the manifests become the sole source of truth. *If ignored:* either the catalogue gets retyped by hand (error-prone, expensive) or the real app develops a dependency on an HTML demo file.

**Duplicate-file status update (discovered this pass, partially resolves the recorded open item):** the no-suffix file `mcpforge-console.html` **no longer exists under that name** — the folder now contains `mcpforge-console og.html` (231,606 bytes, mtime 18 Aug, i.e. the stale Rev 2 build, renamed) alongside the canonical `mcpforge-console_1.html`. The ambiguity is therefore largely resolved by the rename, but the stale copy is still present and still two revisions behind. **Recommendation: confirm the rename was deliberate and either archive or delete the `og` file.** Note also that the Rev 4 build spec's own header text still says the no-suffix file is canonical — that text is now wrong and contradicts `mcpforge_status.md`. Phase 4 should carry a memory-correction task.

### R4 — Server density is uneven and unresolved
**Owner: Phase 2 (schema/boundary), resolved in Wave 5.** General Ledger 4 tools, Accounts Receivable 3, Inventory 2, against the 5–15 target. Top-up or merge is the user's call and is still open. *Why it matters beyond tidiness:* it weakens the module-boundary claim (decision #1) and it distorts the TTFC math, because a 2-tool server costs nearly as much discovery overhead as a 12-tool one. **Do not build those three servers at their current sizes without deciding first.**

### R5 — Token-efficiency mechanism vs spec-baseline MCP
**Owner: Phase 2 — escalate if unresolvable.** Settled decision #7 forbids Claude-specific or non-baseline client assumptions, so the G5 discovery mechanism must be **server-side / gateway-mediated**. If Phase 2 concludes the §3 targets cannot be met server-side alone, that is a genuine conflict between goal G5 and decision #7 and must go to the user, not be resolved unilaterally in either direction.

### R6 — Write scope in Wave 0 is a recommendation, not a settled decision
**Owner: user, before Wave 0 starts.** Recorded as open ("read-only vs narrow write slice"). §4.1 recommends exactly one write tool through the full dry-run/confirm/audit path. **This needs explicit user confirmation before Wave 0 is planned in detail** — it changes Wave 0's exit criteria (#7) and its risk profile.

**RESOLVED 27 Aug 2026 by user direction — see §10.** The answer is **near read/write parity**: 6 write-capable tools and 5 read tools in Wave 0, not one write tool. R6 is closed and no longer needs a user decision. R7 (SSO) is also closed — local user store for Wave 0, LTM AD before Wave 1, behind a pluggable provider interface.

### R7 — SSO / identity provider for the internal instance is undecided
**Owner: Phase 2 — this is a Wave 0 blocker.** Recorded as open: SSO against LTM AD vs a local user store. The gateway cannot resolve a caller identity on day one without an answer, and Wave 0 exit criteria #4, #5 and #7 all depend on real identity. **This must be decided before Wave 0 build starts, not during it.**

### R8 — Portal delivery shape is undecided
**Owner: Phase 3.** Recorded as open: standalone Tool Forge app vs extending an existing portal shell. Interacts with D1 sub-question 2 (does a slice ship the portal?) and with Wave 1 exit criterion #7 (headless mode must work). **Phase 3 should design so the portal is separable from the gateway regardless of which shape is chosen** — that keeps D1's options open at no extra cost.

### R9 — Domain stewardship is unresourced
**Owner: user.** Recorded as open: a part-time domain steward per application CoE. The roadmap assumes **one named steward per application per wave** — someone who can compose JDE orchestrations, choose PS Queries, own EBS responsibility mapping, and author the benchmark intents for their module (which explicitly must not be authored by the tool's builder). *If a wave's applications have no named steward, that wave slips regardless of engineering capacity.* This is the most likely cause of a schedule miss and the least visible one.

### R10 — Deck reconciliation backlog
**Owner: Phase 4 (carry as a task, do not silently drop).** `MCPForge_Concept_3.pptx` predates Rev 2 branding and reflects none of Rev 3 or Rev 4 (binding types, facilitator framing, enablement page, slice architecture). It also carries unaddressed external review comments: Nexus undefined · gateway chokepoint/rollback · bypass risk · personas incomplete · latency uncalculated · scoring-engine reliability · governance enforcement not shown · Slide 13 Fusion/data-store distinction · Slide 15 SoD risk in process roles · Slides 25–26 happy-path only. The facilitator line also still needs to reach the deck and the exec email. **Not a build blocker, but a live communications risk** — the deck currently contradicts the architecture being built.

### R11 — Illustrative numbers must not become real baselines
**Owner: all phases.** The concept console's probe strip (150 probed / 126 resolved / 24 disabled / 5 apps with backlog) and all consumption-graph call counts are **illustrative**, generated for the demo. The real application must measure its own and must never inherit these as targets or baselines. *If ignored:* the first real probe run looks like a regression against numbers that were never real.

### R12 — The 150-tool catalogue is a design target, not validated demand
**Owner: checkpoints (agenda item 7) + G9.** Nothing in memory establishes that all 150 catalogued tools have a consumer. Building all 150 because a spec listed 150 is exactly the sprawl MCPForge exists to prevent. The G9 retirement rule and the consumption graph exist to keep this honest; **a Wave 5 that reaches 150 tools with 30% of them unused has hit its target and failed its purpose.**

### R13 — Wave 0 depends on a JDE instance that is not confirmed
**Owner: user, week 1 of Wave 0.** Requires AIS Server deployed and reachable, and Orchestrator Studio on the Tools release in use. Fallback trigger and its cost are pre-declared in §4.1. **Confirm instance availability before committing to the wave order.**

### R14 — Throughput and team size are unrecorded
**Owner: Phase 4.** No dates are asserted anywhere in this document because team size, review capacity and the number of parallel enablement tracks are unknown. Phase 4 must either obtain these from the user or plan in tool-budget units rather than calendar units. **Do not invent a schedule.**

### A1–A5 — Assumptions this roadmap rests on
- **A1.** The 70/30 split holds: the invariant core is buildable with zero customer dependency, so only enablement gates a wave. *If false, the whole sequencing logic changes.*
- **A2.** Enablement-cost ordering from `mcpforge_enablement_facts.md` is still accurate (verified against Oracle documentation, Aug 2026). Re-verified at every checkpoint, agenda item 4.
- **A3.** Codegen from manifests is cheap enough that **review capacity and enablement, not code production, are the binding constraints** post-Wave 0. This is what justifies the autonomy targets in G8.
- **A4.** Hyperion/EPM 11.2 has Oracle Premier Support through at least 2033. **Never describe on-prem EPM as end-of-life** — earlier drafts got this wrong. The difficulty is the missing unified REST surface, not the support status.
- **A5.** The process taxonomy may be seeded from the Novigo.AI 240-agent and 169-use-case libraries — documents, not code, so no coupling is created. No other accelerator (MORPH-ED included) is a dependency.

---

## 9. Handoff to Phases 2–4

**Phase 2 — architecture, stack, tool-discovery mechanism.** Owns R1, R2, R3 (extraction task), R4 (boundary), R5 (escalate if unresolvable), R7 (Wave 0 blocker). Must design: the manifest schema (extending the settled `bindingType` field), codegen, the gateway, the five binding-type handshake templates, the capability probe, and — most importantly — **the concrete mechanism that delivers §3's metrics server-side**. Must not: re-open the ten settled decisions in §0, or resolve D1.

**Phase 3 — UX design system.** Owns R8. Must design the portal as a UX over git (never a database system of record), separable from the gateway so headless mode stays possible, covering Registry, Developer Workspace, Business Intake, Governance & Approvals, Consumption Graph and Application Enablement. Must carry the facilitator framing and must present the slice mechanism **without implying any commercial answer** while D1 is open.

**Phase 4 — autonomy, model routing, task backlog.** Owns R10 (deck backlog), R14 (schedule), and the memory-correction task from R3. Must produce the Wave 0 task backlog in a form an autonomous Claude Code + PowerShell run can execute from `C:\GenAIGenerated\LTM\MCP\MCPForge\docs\build-plan\`, with named human decision points, and must design the intervention log that feeds checkpoint agenda item 6. Must also perform the single consolidated `MEMORY.md` index update at the end of the planning sequence.

**Items requiring a user decision before Wave 0 build begins:** R6 (write scope), R7 (SSO), R13 (JDE instance), R4 (server density — before those three servers are built), and confirmation of the R3 file-rename status.

---

---

## 10. Correction applied by Phase 2, per user direction, 27 Aug 2026

**Status: this section supersedes the Wave 0 write-scope recommendation in §4.1, Wave 0 exit criterion 7 in §7, and risk R6 in §8. Nothing else in this document changes. The superseded text is deliberately left in place above so that the change of direction is visible rather than silent.**

### 10.1 What the user said

> *"I just don't want read only, looking for as much write as read, write is the real game changer. You have reports for read."*

Read and reporting capability is treated by the user as **already solved elsewhere** — BI, FDI/OAC, existing report catalogues, existing extracts. It is not where MCPForge's value sits. The differentiator is agents **doing things**: creating, submitting, approving, releasing, cancelling. A Wave 0 that proves the read path beautifully and the write path exactly once has proved the wrong half of the product.

### 10.2 The correction

**Wave 0 targets near read/write parity — roughly half of its tools write-capable — not one write tool.**

Replacement for the superseded §4.1 write-scope bullet:

> **Write scope (corrected):** Wave 0 ships **6 write-capable tools and 5 read tools** out of its 11. Every write tool goes through the complete path: **plan / dry-run -> confirmation round-trip bound to an argument hash -> execute -> immutable audit record carrying the created business key -> a declared and tested reversal**. Write capability is not an add-on at the end of Wave 0; it is the spine of Wave 0.

**Verbs come from the closed verb list** already fixed in the Rev 4 build spec's catalogue model. Write verbs: `create · update · cancel · submit · approve · release`. Read verbs: `search · get · list · get_status · run_report · download · explain · reconcile · simulate`. **A Wave 0 tool set weighted toward `get` / `list` / `search` / `run_report` does not satisfy this correction regardless of how many tools it contains.**

### 10.3 Rebalanced Wave 0 tool selection — `jde-fin`, still 3 servers / 11 tools

The concept catalogue's existing `jde-fin` slice is **8 read / 3 write** and spends three of its eleven slots on reporting. Rebalanced to **5 read / 6 write**, staying inside the same three module servers, the same tool count, and the same closed verb list:

| # | Tool id | Server | R/W | Why it earns a Wave 0 slot |
|---|---|---|---|---|
| 1 | `jde.fin.gl_journal.search` | `jde-fin-gl` | read | Finds the object a write will act on. Also the near-miss partner for `.get` in the benchmark suite. |
| 2 | `jde.fin.batch.get_status` | `jde-fin-gl` | read | Closes the write loop — verifies what the write actually did. A write path without a verification read is not a proven write path. |
| 3 | `jde.ap.voucher.get` | `jde-fin-ap` | read | Precondition read for the voucher dry-run and for the reversal precondition check ("is it still unpaid?"). |
| 4 | `jde.ap.voucher.search` | `jde-fin-ap` | read | Duplicate-detection input before a create; the near-miss partner for `.get`. |
| 5 | `jde.scm.purchase_order.get_receipt_status` | `jde-scm-po` | read | The three-way-match precondition. This is what makes the cross-module P2P role real rather than decorative. |
| 6 | `jde.fin.journal.create` | `jde-fin-gl` | **write** | Retained from the concept slice. The baseline financial create. |
| 7 | `jde.fin.journal.submit` | `jde-fin-gl` | **write** | **New.** Proves a *two-step* write (create then submit/post) and a `native-reverse` reversal class — JDE journal reversal. Two-step writes are the common shape in Oracle apps and were entirely unproven under the old scope. |
| 8 | `jde.ap.voucher.create` | `jde-fin-ap` | **write** | Retained. Cross-module: consumes the PO from server 3. |
| 9 | `jde.ap.voucher.cancel` | `jde-fin-ap` | **write** | **New.** The compensating reversal for #8. A write tool whose entire purpose is to prove that "reversal" is implemented and exercised, not declared in a manifest and never run. |
| 10 | `jde.scm.purchase_order.create` | `jde-scm-po` | **write** | Retained. |
| 11 | `jde.scm.purchase_order.approve` | `jde-scm-po` | **write** | **New.** `approve` is the verb that makes a process-scoped role commercially interesting, and it is the verb that most needs segregation-of-duties checking. A role granting both `purchase_order.create` and `purchase_order.approve` is an SoD finding — Wave 0 should surface that mechanism, not discover it in Wave 3. |

**Dropped from the concept slice:** `jde.fin.integrity_report.run_report`, `jde.fin.account.get`, `jde.fin.trial_balance.run_report` — three read/reporting tools. Per the user's direction, reporting is the lowest-value use of Wave 0 capacity. They return in Wave 1 or later as cheap catalogue volume, where they are also genuinely useful because volume is what stresses the discovery mechanism.

**Net effect:** server count unchanged (3), tool count unchanged (11), enablement cost roughly unchanged on the read side — but the Procure-to-Pay process role now spans `PO create -> PO approve -> voucher create -> journal create -> journal submit`, an actual end-to-end business action, rather than a set of lookups with one write bolted on.

### 10.4 Revised Wave 0 exit criterion 7

Replaces §7 -> Wave 0 exit criteria -> item 7:

> **7. Six write-capable tools**, across all three module servers, each completed the full path in a live run against the real instance: plan / dry-run -> confirmation round-trip (token bound to caller + tool id + canonical argument hash, single-use, TTL-bounded) -> execute -> immutable audit record retrievable by tool id, by caller **and by created business key**. In addition, all four of the following are demonstrated at least once:
> - **(a) A live reversal** — a completed write was reversed using its declared reversal, and the reversal appears in the audit trail linked to the original call.
> - **(b) A correct refusal at confirm** — a write was refused because the arguments changed between the plan and the confirmation.
> - **(c) A correct refusal at policy** — a write was refused for breaching a declared business guardrail (amount ceiling, or an SoD conflict between `create` and `approve` on the same entity).
> - **(d) Idempotent replay** — replaying a confirmed write returned the original result instead of executing a second time.

### 10.5 Knock-on effects — stated plainly, because this makes Wave 0 more expensive

This correction is the right call on product grounds and it is **not free**. Later phases must plan against the raised cost rather than the original one.

1. **Wave 0 becomes the highest-risk wave in the programme, by design.** The original scope front-loaded architecture risk and deferred blast-radius risk. This scope front-loads both. That is the correct trade — the alternative is discovering that the confirmation, reversal and audit design is wrong at Wave 2 with 80 tools live — but it must be planned for, not absorbed silently.
2. **A new app-side prerequisite that did not exist before: validate-pair orchestrations.** Six writes need a dry-run each. For a `function` binding that means the JDE steward must author a `*_VALIDATE` sibling orchestration alongside each `*_EXECUTE` one. This is low-code steward work, not developer work, but it is **week-one work** and belongs in the Wave 0 prerequisite list next to the AIS / Orchestrator Studio availability check (R13). Where a validate pair cannot be produced, that tool falls back to precondition-read dry-run and must carry human approval — a materially worse product, so the pairs matter.
3. **The entire write-safety machinery moves into Wave 0.** Two-phase confirm with argument-bound plan tokens, idempotency keys, per-tool business guardrails, the reversal registry, segregation-of-duties checking during role compilation, and the approval queue in the portal are all now Wave 0 deliverables. `02_TECHNICAL_ARCHITECTURE.md` (Phase 2) specifies all of them as Wave 0 scope for exactly this reason.
4. **Governance load rises.** All six writes are `function` bindings, which never qualify for expedited review — six standard reviews, six approval records, against one before.
5. **The benchmark suite gains a write dimension.** Intents whose correct answer is a write tool; near-miss pairs across the create/submit and create/approve boundary; and negatives whose correct answer is *"that would require an approval you do not hold"* rather than *"no tool exists."*
6. **Rough effort:** Wave 0 is on the order of **1.6-2.0x the original scope**. The tool count did not change; the machinery behind more than half of them did. **If Wave 0 has to be trimmed under time pressure, cut a read tool — never a write tool.** Cutting writes returns Wave 0 to proving the wrong half.
7. **Phase 3** must design the plan / confirm / approve / reverse experience as Wave 0 UX, not as a later addition. **Phase 4** must sequence the write-safety machinery *before* tool volume in the Wave 0 backlog, and must treat the six validate-pair orchestrations as a named human dependency with a named owner.

### 10.6 R6 is closed; R7 is closed elsewhere

- **R6 — "Write scope in Wave 0 is a recommendation, not a settled decision" is RESOLVED** by user direction on 27 Aug 2026: near read/write parity, 6 write / 5 read, as specified above. It no longer requires a user decision before Wave 0 planning.
- **R7 — SSO / identity provider is RESOLVED** by user direction on the same date: a **local user store for Wave 0, swapped to LTM AD (SSO) before Wave 1**, behind a pluggable identity-provider interface so the swap is configuration rather than a rewrite. The implementation is specified in `02_TECHNICAL_ARCHITECTURE.md` §4.4.
- The items still requiring a user decision before Wave 0 build begins are therefore **R13** (JDE instance availability), **R4** (server density, before those three servers are built), confirmation of the **R3** file-rename status, and the new **validate-pair orchestration owner** introduced by §10.5 item 2.

*Correction applied by Phase 2, per user direction, 27 Aug 2026.*

---

## 11. Correction applied by Phase 5, per user direction, 27 Aug 2026 — consumer registration, binding-type authorization, usage governance and credentials

**Status: this section extends §0 item 9, G2 @ M0, G4 @ M2, and Wave 0 exit criterion 5, and adds Wave 0 exit criterion 14 and risks R15–R16. Nothing else in this document changes. Superseded/extended text is left in place above with inline markers pointing here.**

### 11.1 What the user said

> *"there should be an agent registration/securing agent interaction with MCPforge and proper governance and usage tracking should be there. Like let's say, some tools like PLSQL package based may be opened, but shouldn't be used as open.. access control and protocols should be handled. Likewise application login details."*

That unpacks into four sub-threads: **(1)** agent/consumer registration and secured interaction; **(2)** governance and usage tracking at the consumer level; **(3)** binding-type-aware authorization — "opened but not open"; **(4)** application credentials and secrets. Full analysis in `05_GOVERNANCE_ACCESS_CONTROL_AND_CREDENTIALS.md`.

### 11.2 The correction

**The Consumer Registry.** Every call is now made by a `Consumer` acting for a `Principal`. Authorization is the intersection of what the consumer may do and what the human may do — never the union, never a substitute. A consumer record is a git artefact, reviewed and approved exactly like a role, and an unregistered, suspended, expired or retired consumer is refused at session establishment. This closes the front door that nothing in Phases 1–4 defended — every existing control authenticated the human, not the software holding the session.

**The binding-authorization stage.** Being inside a role's scope is no longer sufficient to execute a `plsql` or `function` write, a write-classified `wrapped-vendor` tool, or any tool carrying a `policyException`. Those are now **elevated posture**: an explicit, named, expiring, approval-recorded `bindingGrant` is required, checked at call time, not only at definition time. This is the literal statement of the user's own phrasing — "opened, but shouldn't be used as open."

**Consumer-level usage tracking and the detector substrate.** A `consumer_usage` rollup and seven declarative anomaly detectors (three built at Wave 0) turn "what did this agent do across many individually-legal calls" into an observable, alertable pattern — something no per-tool rate limit could ever see.

**The `SecretStore` seam and the four-part stored-credential test.** A credential is never anything but a `secretRef://` reference outside the adapter layer. A binding may hold a stored credential only when it structurally cannot carry per-user identity (probe-verified), a per-user identity is still resolved and carried in by a named compensating control, and the credential is scoped to one module and one environment — otherwise it is a forbidden service-account fallback.

### 11.3 Goal amendments

- **G2 @ M0** — extended as marked above: M0 additionally requires a registered, active, authorized consumer on every call, refused at session establishment if absent.
- **G4 @ M2** — extended as marked above: the anomaly-monitoring *substrate* ships at Wave 0; the *product* (triage, alert routing, true-positive evidence) remains M2/Wave 3.
- **G3 gains, at M0:** every binding whose probe reports that identity does not carry natively holds a credential that passes the four-part legitimacy test in `05` §4.4, and that test is a `forge validate` rule and a privilege-escalation case — not a paragraph.
- **G9 @ M1 gains** a one-line note: the consumption graph's "consuming agent" is now an **authenticated** `consumer_id` rather than a self-declared value, which is what makes G9 evidenceable at all.

### 11.4 Wave 0 placement, effort and risk

**Decision: Wave 0, with two named carve-outs.** Five reasons: the write-parity precedent applies verbatim (01 §10 already established that a security-shaping request from this user gets applied retroactively rather than deferred); two of the new artefacts — `consumer_id` as an `audit_call` column, and `ConsumerAuthorized` as a sixth predicate in `visible(session)` — have maximal blast radius and are cheapest to build before any row/predicate history exists; the work is entirely inside the 70% invariant core, with zero customer dependency; `/activity/consumption` cannot honestly be shipped in Wave 0 without an authenticated source for "agent"; and exit criterion 5 is otherwise only half-proved (egress only, no ingress defence).

**Carve-outs:** the anomaly-monitoring *product* stays at Wave 3 (substrate only at Wave 0); `OciVaultStore` is not built at Wave 0 (interface and contract suite are — the local `EncryptedFileStore`/`OsKeychainStore` pair satisfies Wave 0, following the same discipline as `W0-C5` and `W0-D3`).

**Effort delta: +12–15% on Wave 0** — small, because almost every new capability extends a mechanism that already exists (the git-artefact/approval flow, the kill switch, the five-predicate intersection, the eight-stage policy chain, the pluggable-seam pattern) rather than inventing a new one. **Task arithmetic: 96 → 111 tasks** (15 new, 17 modified). Model split moves from 34 Opus / 55 Sonnet / 7 human to **43 Opus / 60 Sonnet / 8 human**. Full reasoning in `05` §5.

**Six named risks** (full detail in `05` §5.5): chain-order risk (an ordering mistake in the policy chain is an authorization bypass); audit-schema churn (`W0-C2` must carry the new columns before the first row exists, or the hash chain gets a discontinuity); Wave 0 demoability (the `p2p × function` standing authorization is a required deliverable, not optional, because every Wave 0 write tool is `function`-bound and therefore elevated posture); bootstrap deadlock (the portal is itself a consumer, so `forge dev` must self-register `portal-local` in environment class `local` only); token-budget accounting (the `access` field on find results, ≤6 tokens/result, must be accounted for deliberately in the MTB gate); and support legibility (`CONSUMER_NOT_AUTHORIZED` and `TOOL_NOT_IN_SCOPE` must never share wording).

### 11.5 New Wave 0 exit criterion 14

**14. The front door is closed and elevated bindings are not open.** All four demonstrated in a live run:
**(a)** A call presenting a valid user identity from an **unregistered** consumer is refused at session establishment with `CONSUMER_UNREGISTERED`, and no `tools/list` is served.
**(b)** A registered consumer **suspended mid-session** is refused on its next call within the kill-switch poll interval, with `CONSUMER_SUSPENDED`.
**(c)** An **elevated-binding tool held in the caller's role scope but with no elevated grant** is refused with `ELEVATED_GRANT_REQUIRED` through **both** a direct `tools/call` and `forge.invoke`, and is absent from `tools/list` while remaining findable through `forge.find` with its `agentMessage`.
**(d)** A **consumer registration, a standing authorization and a credential rotation** each produced an approval record in `approvals/`, and each is visible as a compiled-artefact diff in its change proposal.

### 11.6 New risks R15 and R16

**R15 — Consumer credential compromise.** *Owner: Phase 2/build.* A leaked consumer credential is the new highest-value single secret in the system: it is the front door. Mitigations are the four-part scoping rule, 90-day rotation, `secretRef` discipline, the subject-fan-out detector, and one-act revocation. *If ignored:* the registration layer becomes a single shared key and re-creates, at the ingress, exactly the service-account problem the identity design eliminated at the egress.

**R16 — Grant expiry becomes a rubber stamp.** *Owner: checkpoints, agenda item 7.* Elevated grants and standing authorizations expire at 180 days by design. The failure mode is not expiry — it is renewal becoming a batch click. **Every checkpoint must report the renewal rate and the proportion renewed without a stated reason**, and a renewal rate approaching 100% with no declines is itself the finding. *If ignored:* the expiry mechanism becomes ceremony and the elevated posture quietly becomes the standard posture.

### 11.7 Closing line

*Correction applied by Phase 5, per user direction, 27 Aug 2026.*

---

*MCPForge · BlueVerse ValueMesh · LTM Oracle AI Practice. Phase 1 of 4 — goals and roadmap. Supersedes nothing; the concept-console build spec remains authoritative for the demo artefact only.*
