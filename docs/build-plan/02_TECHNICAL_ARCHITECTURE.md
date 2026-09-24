# MCPForge — Real Application: Technical Architecture

**Phase 2 of 4 · Planning stream: REAL PRODUCTION APPLICATION (not the concept console)**
Written 27 Aug 2026 · Companion to `01_GOALS_AND_ROADMAP.md` (Phase 1)

---

## 0. How to read this document

**Audience, in order:** Phase 3 (UX design system for the portal), Phase 4 (autonomy, model routing, Wave 0 task backlog), and then the autonomous Claude Code + PowerShell build lane running on the user's machine.

**What this document is.** Phase 1 set *what must be true and in what order*. This document sets **how it is built**: the stack, the manifest-to-running-tool pipeline, the five binding-type handshakes including their write/dry-run/reversal mechanics, the gateway, the tool-discovery and token-efficiency mechanism, and the slice/package build system. It is written to be concrete enough that **Phase 4 can turn it into a task backlog without making further big-question judgment calls.** Small implementation-detail calls (a library choice inside a module, a table index, a CSS class) are expected and fine.

**What this document does not do.** It does not re-open Phase 1's ten settled decisions, it does not resolve Decision Gate D1 (commercial packaging), and it does not design screens — Phase 3 owns UX.

### 0.1 Three user decisions applied as given, not re-derived

1. **Discovery is strictly spec-baseline MCP (2026-07-28).** No Claude-specific assumptions, no proprietary REST facade, no reliance on any client-side feature outside the baseline. The mechanism in §5 uses only: scoped `tools/list` responses, cacheable list responses (`ttlMs` / `cacheScope`), `notifications/tools/list_changed`, ordinary MCP tools for search and description, structured tool IDs, and manifest-level token budgets. **It works with any MCP client.**
2. **Identity: a local user store for Wave 0, swapped to LTM AD (SSO) before Wave 1.** The identity layer is pluggable so the swap is a config change, not a rewrite — and the per-user carrying-through principle ("the MCP layer never holds more privilege than the human using it") holds identically under both. See §4.4.
3. **Wave 0 targets near read/write parity, not one write tool.** Applied to Phase 1's document as its new §10 (dated correction, superseded text retained). The architectural consequence is that **the entire write-safety machinery — two-phase confirm, argument-bound plan tokens, idempotency, business guardrails, the reversal registry, SoD checks, the approval queue — is Wave 0 scope**, not Wave 2 scope. It is specified in §3.1 and §3.2-§3.6 accordingly.

### 0.2 Risks inherited from Phase 1 that this document owns and closes

| Risk | Owner per Phase 1 | Status after this document |
|---|---|---|
| **R1** OIC service-account identity gap | Phase 2 | **Closed by design** — §3.6, §4.5. The gateway may not mark a tool identity-carrying without probe evidence; the probe's `whoami` echo is the evidence; service-account execution auto-constrains or blocks. |
| **R2** `function`-binding identity is a Wave 0 problem | Phase 2 | **Closed by design** — §3.6 specifies the per-binding `whoami` probe, and the runtime identity echo on every write call. |
| **R3** Console is a demo artefact, not a source of truth | Phase 2 (one-time task) | **Specified** — §2.7 gives the exact one-time seed-extraction procedure. Verified working during this pass. |
| **R4** Server density uneven (GL 4, AR 3, Inventory 2) | Phase 2 (boundary) | **Rule set, decision named** — §4.7. Recommendation for the user is stated; the decision itself stays with the user. |
| **R5** Token efficiency vs spec-baseline MCP | Phase 2 — escalate if unresolvable | **NOT ESCALATED — resolved server-side.** §5 gives the full mechanism and the arithmetic. One parameter is tightened (VTC default) with the written reason Phase 1 requires. |
| **R7** SSO / identity provider undecided | Phase 2 — Wave 0 blocker | **Closed by user decision** — §4.4 implements it as a pluggable provider with both implementations contract-tested in Wave 0. |

---

## 1. Tech stack

### 1.1 What I know and do not know about the comparison systems — stated plainly

The user asked: *"you know most of my apps, mostly react JS, Python and Node on certain cases. you look at other apps like ARIA, MORPHED, DEXA etc.. but see what's best. and recommend."*

**I have no documented technical detail on ARIA, MORPHED or DEXA.** The only recorded reference anywhere in this project's memory is a single line in `omf_architecture_decisions.md`: *"Reuse: build clean, no code dependency on MORPH-ED or other accelerators."* That is a **dependency** decision, not a stack description. I have no record of their languages, frameworks, deployment model, auth model, CI, or house conventions.

So this recommendation is reasoned from three things I *do* have:
1. The user's stated general pattern — **React on the front end, Python and Node on the back end "on certain cases."**
2. The technical demands of *this specific system* — an MCP server product, manifest-driven codegen, five heterogeneous binding types including PL/SQL and direct Oracle database work.
3. The build model — an **autonomous Claude Code + PowerShell lane** doing most of the construction, which favours a language with a dense, well-documented ecosystem and strong static types.

**Explicit invitation to correct:** if ARIA, MORPHED or DEXA have a stack, a repo convention, a CI pipeline, a deployment target or a house component library that MCPForge should align with, tell me and this section gets revised. Alignment with an existing LTM house pattern is worth more than any marginal technical preference below, and I would rather change this than have MCPForge be the odd one out in the estate.

### 1.2 The recommendation

> **TypeScript / Node.js for the entire core — gateway, registry, codegen, CLI, probe, portal backend. React (Next.js) for the portal front end. Python for exactly one thing: an isolated Oracle adapter worker that executes `database` and `plsql` bindings and performs the DB-side half of the capability probe.**

Not "polyglot." One core language, plus one narrowly-scoped worker with a hard, stated boundary.

#### Component-by-component

| Component | Language / runtime | Key libraries | Why this one |
|---|---|---|---|
| **Gateway** (MCP endpoint, routing, policy, audit) | TypeScript, Node 22 LTS, ESM, `strict` | `@modelcontextprotocol/sdk` (TS), Fastify, Ajv (compiled validators), Kysely + `pg` | The MCP TypeScript SDK is the reference implementation with the richest tooling and the most documented surface. The gateway is 90% protocol, policy and I/O — Node's strength, and no CPU-bound work. |
| **Registry + discovery index** | TypeScript | `wink-bm25-text-search` or a hand-rolled BM25 (≈200 lines), `onnxruntime-node` for the optional embedding channel | The index is ≤150 documents. This is not a search-infrastructure problem; it is a small in-memory ranking problem (§5.4). No vector database, ever, at this scale. |
| **Codegen + manifest toolchain** | TypeScript | `yaml`, `ajv`, `handlebars` (or EJS), `prettier` | Shares its types with the gateway *and* the portal — one type definition of a manifest, three consumers, zero contract drift. This is the single strongest argument for one language. |
| **`forge` CLI** | TypeScript, published as a single Node binary | `commander`, `execa` | Phase 4's PowerShell lane drives this. It must be scriptable, deterministic, and return machine-readable JSON on `--json`. |
| **Capability probe** | TypeScript (orchestrator) + Python (DB checks only) | see above | The probe orchestrates per-binding checks; the DB and PL/SQL checks delegate to the Python worker. |
| **Portal (Tool Forge)** | TypeScript, **Next.js (App Router) + React 19** | Tailwind, TanStack Query, a small component set (Phase 3 owns the design system) | Matches the user's stated React pattern. Server Components read from git directly, which is exactly what "the portal is a UX over git" needs. Same repo, same types, same build. |
| **Oracle adapter worker** | **Python 3.12** | `python-oracledb` (thin by default, thick when Oracle Client features are needed), FastAPI + uvicorn, pydantic v2, `uv` for deps | See §1.3 — this is the one place Python genuinely wins. |
| **Persistence** | **SQLite (Wave 0 / local — §10)** → PostgreSQL 16 (multi-user / OCI). One schema, two dialects, via Drizzle ORM | `drizzle-orm`, `better-sqlite3`, `pg` | Audit, sessions, idempotency, probe results, consumption graph. See §1.5 for the "why not Oracle" nuance and §10 for the Wave 0 correction. |
| **Tests** | Vitest (unit/contract), Playwright (portal E2E), temp-file SQLite as the default CI store **plus a second CI matrix entry running the same store contract suite against Postgres via Testcontainers** (§10.4 item 8); Oracle Free 23ai for adapter tests | — | |
| **Telemetry** | OpenTelemetry (traces + metrics) | — | Separate from audit. Different retention, different guarantees, different consumers. |

#### Why not the alternatives

- **Why not Python for the gateway.** The MCP Python SDK is capable, but the TS SDK is the reference implementation, the portal is React regardless, and the codegen toolchain is what binds them. Splitting gateway (Python) from portal (TS) would mean maintaining the manifest type model twice — and manifest-model drift between the thing that *generates* tools and the thing that *displays and governs* them is precisely the failure mode that "manifest-first" exists to prevent.
- **Why not Java, despite an Oracle-heavy estate.** Every binding we actually intend to use is reachable over HTTP (AIS/REST, ORDS, Siebel REST, PS ASF, SaaS REST) or over SQL*Net (the Python worker). We deliberately do **not** use EBS or Siebel Java APIs directly — that path implies deploying our code inside the customer's app server, which breaks the "gateway is the only door" boundary and the "no fork" promise at the same time. Removing the JVM removes a whole deployment class.
- **Why not Go/Rust.** Nothing here is CPU- or latency-bound to the degree that would justify a stack the autonomous build lane and the existing team are less fluent in. The p95 gateway budget of 150 ms is comfortable in Node (§4.8).

### 1.3 Where Python is used, exactly, and why — with a hard boundary

Python is used **only** inside the **Oracle Adapter Worker (`oaw`)**, and only for these four jobs:

1. **`database` binding execution.** `python-oracledb` is the maintained successor to cx_Oracle, is Oracle's own driver, and in thick mode reaches Oracle client features the Node drivers do not cover cleanly: DRCP connection pooling, Oracle Wallet / TCPS, advanced type handling (LOBs, `XMLTYPE`, object types), and array binds. It also has first-class support for `DBMS_SESSION.SET_IDENTIFIER` / `CLIENT_IDENTIFIER` / `MODULE` / `ACTION`, which is the mechanism that carries the human's identity into the Oracle audit trail for non-identity-carrying bindings (§3.4). This is not a preference; it is a maturity gap.
2. **`plsql` binding execution** where the call is made directly over SQL*Net rather than through ORDS — including `OUT` parameter handling, `x_return_status` / `x_msg_data` error-stack extraction, ref cursors, and savepoint-scoped dry-runs (§3.5).
3. **The DB-side half of the capability probe** — grant introspection (`ALL_TAB_PRIVS`, `ALL_OBJECTS`), wrapper-package validity, FND/MO context establishment, and the `commitsInternally` classification that decides whether a PL/SQL dry-run can use savepoint rollback at all.
4. **Wave 4 only: Essbase MaxL / CalcScript / LCM wrapping.** These are CLI/interactive-session wraps; Python's `subprocess`/`pexpect` story for driving an interactive MaxL session is materially better than Node's. This is a Wave 4 decision, flagged now so Phase 4 does not have to rediscover it.

**The boundary — this is a rule, not a guideline:**

> The Oracle Adapter Worker **never speaks MCP**, **never makes a policy decision**, **never resolves an identity**, and **never writes an audit record**. It is a dumb, sandboxed executor. It receives a **signed binding descriptor** (a generated artefact: statement text or package/procedure name, typed bind values, row cap, timeout, client identifier, dry-run flag) over a private loopback/HTTP contract, executes exactly that, and returns a typed result or a typed error. Everything about *whether* a call is allowed, *who* is calling, and *what gets recorded* stays in the TypeScript gateway.

That boundary is what makes the polyglot split safe: there is exactly one brain, and Python holds none of it. It also means the worker is trivially testable in isolation and can be replaced (by a Node driver, later, if the driver gap closes) without touching policy code.

**Deployment:** the worker runs as a **separate process** (a sidecar container in Kubernetes, or a supervised second process in a single-VM deployment), listening only on loopback or a private network, authenticated with a per-boot shared secret, and with its own egress rules. It is never in-process with the gateway.

### 1.4 Repository layout (monorepo)

```
MCPForge/
  manifests/                     # SOURCE OF TRUTH — hand-authored YAML
    jde/fin/gl/*.tool.yaml
    jde/fin/ap/*.tool.yaml
    jde/scm/po/*.tool.yaml
    _servers/jde-fin-gl.server.yaml
  roles/                         # process-scoped roles (P2P, R2R, O2C...)
  packages/                      # slice definitions (jde-fin, ebs-p2p, ...)
  enums/                         # shared lookup lists referenced by enumRef
  evals/                         # benchmark intents, authored by module stewards
  approvals/                     # generated approval records (governance evidence)
  generated/                     # CODEGEN OUTPUT — committed, CI-verified clean
    tools/<toolId>/{schema.json,tool.ts,handler.generated.ts,binding.custom.ts}
    index/catalogue-index.json
    cards/<toolId>.json
    roles/<roleId>.scope.json
    docs/tools/<toolId>.md
  core/
    gateway/        # TS  — MCP endpoint, policy chain, audit
    registry/       # TS  — index build + query, scoping
    codegen/        # TS  — manifest -> artefacts
    cli/            # TS  — the `forge` command
    probe/          # TS  — probe orchestrator
    portal/         # TS  — Next.js app
    shared/         # TS  — manifest types, error taxonomy, token counter
  adapters/
    oracle-worker/  # PY  — the only Python in the repo
    rest/           # TS  — generic REST executor
    vendor/         # TS  — wrapped-vendor MCP client
  overlays/         # per-deployment config; VALUES ONLY, no code (CI-enforced)
  seed/             # one-time extraction from the concept console (§2.7)
  tools/            # build scripts
```

Package manager: **pnpm workspaces** for the TS side, **uv** for the Python worker. Node 22 LTS pinned via `.nvmrc` and `engines`. Everything reproducible from a clean clone with `pnpm install && forge codegen && pnpm test`.

### 1.5 Persistence: Postgres by default, with an honest caveat

> **SUPERSEDED FOR WAVE 0 AND LOCAL DEVELOPMENT — see §10, "Correction applied by Phase 4, per user direction, 27 Aug 2026." The Wave 0 runtime store is **SQLite**, behind an ORM abstraction (Drizzle) configured for both dialects. The reasoning below still governs the eventual multi-user / OCI deployment; it is retained rather than rewritten so the change of direction is visible.**

PostgreSQL 16 is the default runtime store (audit, sessions, idempotency, probe results, consumption graph, approval queue state). It is free, operationally simple, has the JSON and window-function support the audit design wants, and Testcontainers makes it trivial in CI.

**The caveat, stated because an Oracle-shop customer will raise it:** a customer-hosted deployment inside an Oracle estate may be told to use Oracle Database rather than Postgres for the runtime store. Therefore **all runtime persistence goes through a thin repository interface** (`core/gateway/store/*.ts`), with SQL kept close to ANSI in the audit path, and Postgres-specific features (`jsonb` operators, `gen_random_uuid()`) isolated behind that interface. An Oracle 23ai implementation is a **deferred, not designed-out** option; it becomes real only if D1 resolves to customer-hosted. **Do not build it speculatively.**

**Note what is *not* in the database:** manifests, roles, packages, generated artefacts and approval records. Those are git. The database holds **events and runtime state only**. That is the precise reading of "the portal is a UX over git, never a database-only system of record": definitions live in git, events live in Postgres, and the portal writes definitions by opening a pull request (§4.6).

### 1.6 Unknowns that need a user answer before Wave 0 build starts

These are stack-adjacent facts I do not have and cannot invent:

1. **Git host** — **ANSWERED 27 Aug 2026: host-agnostic for Wave 0, local git only, no hosted platform assumed (§10.1).** Original question, retained: GitHub, GitHub Enterprise, Azure DevOps, or Bitbucket? This determines the portal's PR-creation client and the CI system. (An LTM estate more often means **Azure DevOps**, but that is an assumption, not a record.)
2. **Runtime target** — **ANSWERED 27 Aug 2026: local-first for Wave 0 — everything runs on a developer machine, Docker is fine, no cloud account or OCI service is required to build or demo W0 — with OCI as the eventual production target (§10.1).** Original question, retained: Kubernetes (OKE/AKS), plain Linux VMs, or Windows Server? The build path is `C:\GenAIGenerated\...`, so the **development** machine is Windows; the deployment target is unrecorded. Recommendation: develop on Windows with Docker Desktop + WSL2, target Linux containers.
3. **Container registry and image signing** — needed for the slice-diff proof in §6.4 (digest equality is the proof).
4. **Whether Postgres is acceptable** in the internal CoE instance, per §1.5. **DEFERRED and no longer a Wave 0 blocker — Wave 0 uses SQLite (§10). The question returns at the OCI migration, and §10.2's abstraction is what keeps the answer cheap.**

Phase 4 should carry these four as named decision points in the Wave 0 backlog.

---

## 2. The manifest-first pipeline, made concrete

### 2.1 The rule

> **A human (or an agent) writes exactly two things: a YAML manifest, and — for the minority of tools whose binding is genuinely irregular — a hand-owned binding file. Everything else is generated, committed, and verified byte-identical by CI.**

Target, and it is a measurable one: **≥ 80% of tools have zero hand-written code.** Their binding is fully declarative (a REST call from a URL template, a named orchestration, a named SQL statement, a named wrapper procedure) and the generic executor for that binding type handles it from the manifest alone. The 80% figure is a G8 (autonomy) lever and should be reported at every checkpoint.

### 2.2 The manifest — a complete worked example

This is `manifests/jde/fin/ap/voucher.create.tool.yaml`, one of Wave 0's six write tools. Every field shown is real; nothing is illustrative.

```yaml
apiVersion: mcpforge/v1
kind: Tool
id: jde.ap.voucher.create            # {app}.{module}.{entity}.{verb} — structurally enforced
version: 1.0.0                       # semver; bump rules in 2.6
server: jde-fin-ap
title: Create a voucher

# --- discovery surface (see 5.3 for the token budget these feed) -------------
purpose: Create an AP voucher against a supplier, optionally matched to a PO.
aliases: [supplier invoice, enter a bill, AP invoice entry, book a payable]
disambiguation: >
  Creates a NEW voucher. To find existing vouchers use jde.ap.voucher.search;
  to read one use jde.ap.voucher.get; to reverse one use jde.ap.voucher.cancel.
archetype: transactional             # transactional | analytical | platform | wrapped
verb: create                         # from the closed verb list
entity: voucher
app: jde
module: ap
functionalArea: Accounts Payable
processTags: [P2P]
sensitivity: financial               # public | internal | confidential | financial | personal
write: true
coreForRoles: [p2p]                  # counts against that role's resident token budget

# --- binding -----------------------------------------------------------------
binding:
  type: function                     # rest | database | plsql | function | wrapped-vendor
  technology: JDE AIS Orchestration
  ref: AP_VOUCHER_CREATE             # allowlisted name; never taken from a parameter
  refVersion: "1.4"
  identity:
    carries: unverified              # unverified | verified | no   (ONLY the probe may write 'verified')
    probe: MCPFORGE_PROBE_WHOAMI
    onServiceAccount: block          # block | readonly-lowsens
    echoOn: write                    # never | write | sampled | always
  execution:
    timeoutMs: 30000
    maxConcurrency: 4
    responseBytesMax: 262144

# --- inputs ------------------------------------------------------------------
input:
  - { name: supplier_number, type: string,  required: true,  desc: JDE address book number of the supplier., example: "4242" }
  - { name: po_number,       type: string,  required: false, desc: Purchase order to match against. }
  - { name: amount,          type: number,  required: true,  desc: Gross amount in company currency., minimum: 0.01 }
  - { name: currency,        type: string,  required: true,  desc: ISO currency code., enumRef: iso_currency }
  - { name: company,         type: string,  required: true,  desc: JDE company code. }
  - { name: gl_date,         type: string,  required: false, desc: "GL date, YYYY-MM-DD. Defaults to today.", format: date }

# --- outputs -----------------------------------------------------------------
output:
  summaryTemplate: "Voucher {document_number} created for {supplier_number}, {amount} {currency}."
  resultKeys:                        # the business keys. These ARE the reversal handle.
    - { name: document_number,  path: "$.voucher.docNumber" }
    - { name: document_type,    path: "$.voucher.docType" }
    - { name: document_company, path: "$.voucher.docCo" }

# --- write safety (required whenever write: true) ----------------------------
writeSafety:
  dryRun:
    strategy: validate-pair          # native | validate-pair | precondition-read | shadow-write | transactional
    ref: AP_VOUCHER_CREATE_VALIDATE
  confirm:
    required: true
    tokenTtlSeconds: 300
    planTemplate: >
      Create an AP voucher for supplier {supplier_number} ({supplier_name}) for
      {amount} {currency}, company {company}, GL date {gl_date}, matched to PO
      {po_number}. This creates an OPEN PAYABLE in JD Edwards.
  humanApprovalRequired: false       # true forces an out-of-band portal approval before a token is minted
  reversal:
    class: compensating-tool         # native-reverse | compensating-tool | transactional | irreversible
    tool: jde.ap.voucher.cancel
    argMap: { document_number: "$.result.document_number", document_type: "$.result.document_type", document_company: "$.result.document_company" }
    windowHours: 720
    preconditions: Voucher must be unpaid and not yet posted to a closed period.
  idempotency: { scopeHours: 24 }
  guardrails:
    - { kind: maxNumeric, field: amount, value: 250000, message: Voucher amount exceeds the MCPForge ceiling for this tool. }
    - { kind: sodConflict, with: jde.scm.purchase_order.approve, scope: sameEntityChain }

# --- governance ---------------------------------------------------------------
governance:
  reviewPath: standard               # expedited is structurally unavailable for plsql/function and for irreversible writes
  owner: JDE Finance CoE
  steward: <named person, filled at intake>

# --- evaluation ---------------------------------------------------------------
eval:
  intentsFile: evals/jde-fin-ap/intents.yaml
  minIntents: 10
```

**Schema validation** (`forge validate`) enforces, among ~40 rules:
- `id` matches `^[a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+\.(search|get|list|create|update|cancel|submit|approve|release|run_report|run_process|get_status|download|simulate|reconcile|explain|resolve)$` — the closed verb list, structurally.
- `write: true` requires a complete `writeSafety` block with a `dryRun.strategy` that is not `none`, and a `reversal.class`.
- `reversal.class: irreversible` requires `humanApprovalRequired: true` and `reviewPath: standard`.
- `binding.type` in `{plsql, function}` forces `reviewPath: standard` (expedited is rejected).
- `binding.identity.carries: verified` **may not appear in a hand-authored manifest at all** — only the probe writes it, and it writes it to a separate probe artefact, never back into the manifest. A manifest asserting `verified` fails validation. This is the structural form of R1/R2.
- Any two tools sharing the `{app}.{module}.{entity}` prefix must **both** carry a `disambiguation` string (§5.5).
- `purpose` ≤ 14 words; `aliases` ≤ 8 entries; enum lists longer than 12 values must use `enumRef`, not inline values (§5.3 token budget).

### 2.3 What is generated, from what, into what

`forge codegen` reads `manifests/**`, `roles/**`, `packages/**`, `enums/**` and writes, deterministically (sorted keys, fixed formatting via prettier, no timestamps, no random ids):

| Artefact | Path | Hand-editable? |
|---|---|---|
| **JSON Schema** (draft 2020-12) — the canonical input schema published over MCP | `generated/tools/<id>/schema.json` | No |
| **Tool registration + policy metadata** — the object the gateway registers, carrying sensitivity, write flag, guardrails, role tags, budget accounting | `generated/tools/<id>/tool.ts` | No |
| **Handler** — argument validation (compiled Ajv validator from the same schema), two-phase confirm handling, dry-run dispatch, guardrail evaluation, result-key extraction, audit calls, error mapping | `generated/tools/<id>/handler.generated.ts` | No |
| **Binding body** — only created when the manifest sets `binding.custom: true`; otherwise the generic executor handles it | `generated/tools/<id>/binding.custom.ts` | **YES — the only hand-owned generated-tree file** |
| **Unit tests** — schema-boundary tests (required fields, type coercion, enum rejection, guardrail thresholds) | `generated/tools/<id>/unit.test.ts` | No |
| **Contract tests** — run against a recorded/mock target: happy path, each declared error, dry-run shape, confirm-token binding, argument-mismatch refusal, idempotent replay, reversal round-trip for write tools | `generated/tools/<id>/contract.test.ts` | No |
| **Eval entry** — a skeleton intents file with the negatives and near-miss pairs auto-derived; the ≥10 positive intents are filled in by the module steward | `evals/<server>/intents.yaml` (created, never overwritten) | **YES — steward-owned** |
| **Docs** | `generated/docs/tools/<id>.md` | No |
| **Discovery card** (the ≤60-token object, §5.3) | `generated/cards/<id>.json` | No |
| **Catalogue index entry** (lexical + structured fields, optional embedding) | `generated/index/catalogue-index.json` | No |
| **Role scope** (globs resolved to explicit tool-id lists) | `generated/roles/<roleId>.scope.json` | No |
| **Portal card** | *not generated* — the portal renders from the manifest + `cards/<id>.json` at read time | n/a |

Every generated file carries a first-line header:

```
// GENERATED BY forge codegen FROM manifests/jde/fin/ap/voucher.create.tool.yaml
// manifest-sha256: 7f3c…  codegen-version: 1.4.2   DO NOT EDIT
```

### 2.4 How regeneration handles hand-edited handler code without clobbering it

This is the question that kills most codegen systems. The answer here is **separation plus a contract hash — never a merge.**

**Three-file split.** Generated logic and hand-written logic never live in the same file. There are no "protected regions," no marker comments inside generated code, and no three-way merge. `handler.generated.ts` is regenerated wholesale every time. `binding.custom.ts` is *never* written by codegen after its first creation.

**The stub.** When a manifest first declares `binding.custom: true`, codegen creates `binding.custom.ts` once, with a typed stub:

```ts
// HAND-OWNED. codegen will never overwrite this file.
// mcpforge:contract-hash a91c4e02
import type { Ctx, Args, Result } from './handler.generated';

export async function execute(ctx: Ctx, args: Args): Promise<Result> {
  throw new Error('NOT_IMPLEMENTED: jde.ap.voucher.create binding body');
}
export async function dryRun(ctx: Ctx, args: Args): Promise<Result> { … }
```

**The contract hash.** `contract-hash` is a hash of *only the manifest fields the custom code can depend on*: input names and types, `output.resultKeys`, `binding.ref`/`refVersion`, `writeSafety.dryRun.strategy`. On every `forge codegen`:

- Hash unchanged → the custom file is left completely alone. No diff, no noise.
- Hash changed → codegen **does not touch the file** and **fails the build** with:
  ```
  CUSTOM_BINDING_CONTRACT_DRIFT  jde.ap.voucher.create
    changed: input.gl_date (added, optional, string/date)
             output.resultKeys.document_company (added)
    file:    generated/tools/jde.ap.voucher.create/binding.custom.ts
    fix:     update the file, then `forge codegen --accept-contract jde.ap.voucher.create`
  ```
  `--accept-contract` rewrites only the hash comment. It cannot be run in CI (it is refused when `CI=true`), so acceptance is always a deliberate human or agent act recorded in a commit.

This gives three properties that matter: hand-written code is **never** silently overwritten; hand-written code can **never** silently drift out of sync with its manifest; and the failure message names the exact fields that changed, which is what makes it an autonomous-agent-fixable failure rather than a human-only one.

**The regeneration invariant (G1, CI-enforced):**
```
forge codegen && git diff --exit-code generated/
```
`generated/` **is committed**. That is a deliberate choice: it makes a manifest change's real blast radius visible in code review (a one-line manifest edit that rewrites nine schemas shows up as nine schema diffs), which is what makes governance reviewable rather than notional. The cost is repo noise; the benefit is that the approval record covers what actually ships.

### 2.5 Where the pipeline is exercised in the flow of work

```
intake (portal)          ->  a Business Intake submission, deduped against the index (§5.4)
  |
authoring                ->  `forge new tool` scaffolds the YAML from answers; human/agent edits it
  |
`forge validate`         ->  ~40 schema + policy rules; fails fast, names the rule
  |
`forge codegen`          ->  all artefacts above; contract-drift check
  |
steward writes intents   ->  >= 10 labelled intents in evals/<server>/intents.yaml (NOT by the tool's author)
  |
pull request             ->  generated/ diff visible; review path forced by bindingType
  |
review + approval        ->  approval record committed to approvals/<id>.yaml as part of the merge
  |
CI                       ->  §7.2 pipeline: regen-diff, unit, contract, policy, token budget, benchmark, slice-diff
  |
`forge package`          ->  slice artefact built (§6)
  |
deploy + `forge probe`   ->  bindings verified against the real instance; unresolved -> auto-disabled, visibly
  |
live                     ->  gateway serves it; consumption graph starts counting
```

### 2.6 Versioning and schema evolution

- **Manifest schema version** is `apiVersion: mcpforge/v1`. A minor bump adds optional fields only. Codegen refuses a manifest whose `apiVersion` it does not know, naming the required migration — never a silent best-effort parse (G1 @ M2).
- **Tool version** is semver on the manifest. Patch = description/alias/doc changes. Minor = new optional input, new result key. **Major = anything that can break a caller**: removing or renaming an input, tightening a type, changing a verb, changing `write`. A major bump requires a fresh approval record regardless of binding type.
- **A tool id is immutable.** Renaming a tool is a retire-and-create pair, both recorded, because agents and consumption records reference the id.
- **Deprecation:** `status: deprecated` keeps the tool callable but removes it from every `tools/list` and marks its discovery card so `forge.find` returns it with a `supersededBy` pointer. Retirement (G9) is `status: retired` — findable, not callable, returns an agent-actionable error naming the successor.

### 2.7 R3 — the one-time catalogue seed extraction (verified working)

The concept console `mcpforge-console_1.html` is a demo artefact and the real application must never read it at runtime. But its embedded literals are the best available catalogue seed. **This procedure was run and verified during this planning pass** — the `TOOLS` literal parses cleanly as JSON with a single regex.

`tools/seed-extract.ts`, run **once**:
1. Read `C:\GenAIGenerated\LTM\MCP\mcpforge-console_1.html`.
2. Extract with `/const (SERVERS|TOOLS|RICH|PACKAGES|ENABLEMENT)\s*=\s*([\[{].*?[\]}]);\n/s` and `JSON.parse` each — all five are single-line JSON literals (confirmed).
3. Emit `seed/servers.yaml`, `seed/tools.yaml`, `seed/rich.yaml`, `seed/packages.yaml`, `seed/enablement.yaml`, preserving `bindingType`, `sens`, `functionalArea`, `technology`, `bindRef`, and each server's derived `slices`.
4. Emit `seed/EXTRACTION_REPORT.md` with the counts, asserting 42 servers / 150 tools / 12 rich / 6 packages / 7 enablement entries, and **failing if any assertion misses**.
5. Commit `seed/`. **Delete the extractor.** The console is frozen as a demo from that commit onward.

Seed files are **not manifests**. They are the input a human or agent uses when authoring a real manifest for a tool that is entering a wave. A seed entry is never deployed; a manifest is. The one field that must **not** be carried across is `calls` (the illustrative consumption counts) — R11.

**Also carried in this task:** all `calls`, `agentName` and `agentPlatform` values and the probe strip figures (150/126/24/5) are demo fixtures. `forge validate` rejects any manifest containing a `calls` field, so they cannot leak into the real system by copy-paste.

---

## 3. Binding-type handshakes, implemented

The concept spec documents five binding types as a table. This section implements them. Because Wave 0 now targets near read/write parity (§0.1 item 3), the **write mechanics are specified first and in full**, then per binding type — a PL/SQL write and a REST write genuinely do need different confirmation and rollback patterns, and both are designed below.

### 3.1 The write-safety machinery — common to every binding type

Five mechanisms, all Wave 0 scope, all implemented once in the gateway and reused by all five binding types.

#### 3.1.1 Two-phase confirm, using nothing but ordinary tool arguments

**Design constraint that shapes everything:** it must work on **any** MCP client. So it does **not** use `elicitation` (not universally implemented), does not use sampling, does not use a second tool per write (that doubles the resident token cost), and does not use an out-of-band channel. It uses one extra input field.

Every write tool's generated schema includes:

```jsonc
"confirm": {
  "type": ["string","null"],
  "description": "Omit or null to PLAN (no change is made). Pass the confirmToken returned by the plan to EXECUTE."
}
```

**Call 1 — plan.** `confirm` absent/null. The gateway: validates arguments; checks authorization, guardrails and SoD; performs the binding-type-specific dry-run (§3.2-§3.6); and returns `isError: false` with structured content:

```jsonc
{
  "status": "confirm_required",
  "plan": "Create an AP voucher for supplier 4242 (ACME LTD) for 18,400.00 GBP, company 00100, GL date 2026-08-27, matched to PO 0000451. This creates an OPEN PAYABLE in JD Edwards.",
  "effects": [ { "system": "JDE PY920", "object": "F0411 voucher", "action": "insert", "reversible": true } ],
  "warnings": [ "PO 0000451 is only 60% receipted." ],
  "confirmToken": "cnf_01J9…",
  "expiresAt": "2026-08-27T14:22:10Z",
  "reversal": { "class": "compensating-tool", "tool": "jde.ap.voucher.cancel", "windowHours": 720 },
  "next": "Show the plan to the human. If approved, call this tool again with identical arguments plus confirm=<confirmToken>."
}
```

**Call 2 — execute.** Same arguments plus `confirm: "<token>"`. The gateway verifies the token before doing anything else.

**The token is the security control, not a formality.** `confirmToken` is an opaque HMAC-signed value whose payload binds:

```
{ callerSubject, toolId, toolVersion, argsCanonicalHash, planHash, nonce, exp }
```

`argsCanonicalHash` is sha256 over a canonical JSON serialisation of the arguments **excluding `confirm`** (sorted keys, normalised numbers). At execute time the gateway recomputes it from the arguments actually presented. If they differ → **refuse**, with `PLAN_ARGUMENT_MISMATCH` naming the fields that changed. This is what stops an agent planning a 100 GBP voucher, showing that to a human, and then executing an 100,000 GBP one. Tokens are single-use (a nonce table in Postgres, consumed atomically), TTL-bounded (default 300 s), and never valid across callers or tool versions.

**Where a human must be in the loop.** `humanApprovalRequired: true` changes the plan response to:

```jsonc
{ "status": "awaiting_human_approval", "approvalId": "apr_…", "approvalUrl": "https://…/approvals/apr_…",
  "next": "A named approver must approve this in the MCPForge portal. Poll forge.approval.status with approvalId, or ask the human to approve and retry." }
```

No `confirmToken` is minted until a human approves in the portal. Phase 3 owns that queue's UX; the gateway owns the state machine.

#### 3.1.2 Idempotency

`idempotencyKey = sha256(callerSubject | toolId | toolVersion | argsCanonicalHash | confirmToken)`. Written to `idempotency_record` **before** the binding is invoked, with the outcome written back after. A repeat within `writeSafety.idempotency.scopeHours` (default 24) returns the **original** result with `"replayed": true` instead of executing again.

This matters more than it looks. Agents retry. Network timeouts are ambiguous. Without this, a timeout on a voucher create is indistinguishable from a failure, and the honest agent behaviour (retry) produces duplicate payables. **This is Wave 0 exit criterion 7(d).**

#### 3.1.3 Business guardrails

Declared per tool in `writeSafety.guardrails`, evaluated in the gateway at plan time and again at execute time (never only at plan). Kinds:

- `maxNumeric` / `minNumeric` on a named field (amount ceilings).
- `allowedValues` on a named field (companies, business units the caller may act on).
- `rateLimit` — N executes per caller per window for this tool.
- `sodConflict` — the caller may not execute this tool if they also hold a grant for a conflicting tool on the same entity chain (`purchase_order.create` + `purchase_order.approve`). Evaluated against the caller's **resolved role scope**, not just the current call. Detected at role-compile time as a warning, and enforced at call time as a refusal.
- `timeWindow` — e.g. no GL posting outside an open period, evaluated from a precondition read.

A guardrail breach is a refusal with `POLICY_GUARDRAIL_BREACH`, the guardrail's own `message`, and a next-action hint. **Wave 0 exit criterion 7(c).**

#### 3.1.4 The reversal registry

`writeSafety.reversal.class` is one of four, and codegen refuses a write tool without one:

| Class | Meaning | Who can use it | Wave 0 example |
|---|---|---|---|
| `native-reverse` | The target system has a first-class reversal for this exact operation | rest, function, plsql | `jde.fin.journal.submit` → JDE journal reversal |
| `compensating-tool` | Reversal is a *different tool* in the catalogue, with a stated window and preconditions | any | `jde.ap.voucher.create` → `jde.ap.voucher.cancel` |
| `transactional` | The whole unit of work is one transaction the wrapper controls and can roll back before commit | database, plsql (only when `commitsInternally: false`) | EBS wrapper writes, Wave 2 |
| `irreversible` | No reversal exists. Payment transmitted, EDI sent, email issued. | any | e.g. a future `payment.release` |

`irreversible` forces `humanApprovalRequired: true` and `reviewPath: standard`, and the plan response says so **in words** in the `plan` string, not only in a field an agent might not render.

**The registry is live, not documentation.** At execute time the gateway writes `reversal_class`, the reversing tool id, and the extracted `result_keys` into the audit record. `forge audit reverse <callId>` (and the portal's equivalent) constructs the reversing call by applying `reversal.argMap` to the original call's result keys. That is how Wave 0 exit criterion 7(a) is demonstrated: it is a one-command operation, not an improvised script.

#### 3.1.5 The error taxonomy — "no dead ends" as code, not as a wish

One error type, generated into every handler, mapped from every binding type:

```jsonc
{
  "code": "TARGET_PRECONDITION_FAILED",
  "message": "PO 0000451 is closed and cannot be vouchered.",
  "condition": "purchase_order.status = CLOSED",
  "next": "Use jde.scm.purchase_order.get_receipt_status to confirm status, or create the voucher without a PO match by omitting po_number.",
  "retryable": false,
  "correlationId": "req_01J9…"
}
```

Codes are a closed enum: `INPUT_INVALID · AUTH_REQUIRED · IDENTITY_UNRESOLVED · TOOL_NOT_IN_SCOPE · TOOL_DISABLED · POLICY_GUARDRAIL_BREACH · APPROVAL_REQUIRED · PLAN_REQUIRED · PLAN_EXPIRED · PLAN_ARGUMENT_MISMATCH · TARGET_PRECONDITION_FAILED · TARGET_ERROR · TARGET_TIMEOUT · TARGET_UNAVAILABLE · ROW_CAP_EXCEEDED · RATE_LIMITED · INTERNAL`.

**Every one of them requires a non-empty `next`.** A unit test generated for every tool asserts that each declared error path produces a `next` string; the eval harness asserts zero dead ends across the suite (Phase 1 G5, W0 exit criterion 11). An error without a next action fails the build.

---

### 3.2 Binding type 1 — REST / OAuth

**Catalogue weight:** 66 of 150 tools. Wave 1's `saas-fin`, plus EPM Cloud, OFSC, Commerce, Sales, CPQ, OIC, PeopleSoft ASF.

**Auth / identity.** The only binding type where identity carries end to end natively. The gateway performs **OAuth 2.1 token exchange** (RFC 8693): it exchanges the caller's authenticated session for a per-user access token at the target's authorization server, scoped to the specific resource and the specific scopes the tool declares. For Oracle SaaS this is a registered trusted client performing a JWT-user-assertion exchange keyed on the caller's UPN. Tokens are cached per `(subject, resource, scopeSet)` with a TTL strictly shorter than the token's own lifetime, encrypted at rest with a per-deployment key, and evicted on logout.

**Prohibited, structurally:** a shared service-account token for a REST binding. If the target cannot issue a per-user token, the manifest cannot declare `identity.carries: verified` (only the probe can), and the tool falls under the non-identity-carrying policy (read-only, low sensitivity, or blocked) — the same rule OIC triggers.

**Sandboxing.** No code execution, so the sandbox is a request cage compiled from the manifest at codegen time:
- **Method is fixed at generation.** A read tool's generated executor is constructed with the literal method `GET`; it has no code path that can issue a `POST`. This is stronger than a runtime check.
- **Host + path template allowlist.** The URL is built from a template with typed, URL-encoded substitutions. Parameters can never contribute a host, a scheme, or a path segment containing `/` or `..`.
- No redirect following. Response size cap (`responseBytesMax`). Connect + read timeouts. Per-tool concurrency cap. Egress from the gateway restricted at the network layer to the allowlisted hosts.

**Dry-run — three strategies, and `none` is not allowed:**
1. `native` — the target supports validation without commit (Fusion ESS parameter validation; some REST resources support a validate/preview mode). Preferred where it exists.
2. `shadow-write` — create in a draft/incomplete/unposted state, and require a separate `submit`/`approve` tool to make it real. This is the *best* pattern where the application supports it, because the "dry run" is a real object the human can inspect, and abandonment is the default.
3. `precondition-read` — the gateway performs the reads that establish the effect (does the supplier exist, is the PO open, what is the current value) and renders a before/after diff in the plan. Weakest, but never worse than nothing.

**Reversal.** Usually `compensating-tool` (a cancel/void/delete endpoint declared as a sibling tool). `native-reverse` where the API has an explicit reverse operation. `transactional` is never available — HTTP has no transaction.

**Audit shape (REST-specific fields on top of the common record):** the **URL template** (not the interpolated URL — the parameters are already recorded, redacted, in `args_redacted`; interpolating them again duplicates sensitive values in a second field with different redaction), HTTP method, response status, the target's own correlation/request id where it returns one, token subject actually presented, scopes granted, and the extracted `result_keys`.

---

### 3.3 Binding type 2 — Database / SQL

**Catalogue weight:** 26 of 150. OAC, FDI, EBS reporting views, ADB, PeopleSoft PS Query.

**Auth / identity.** There is **no per-user session inside the database**, so identity is a compensating control, not a carriage. Three mechanisms, all mandatory:
1. **A dedicated, per-module, read-only database user** against a **reporting or query-layer schema** — never the application schema, never `APPS`. Grants: `SELECT` on named objects only. The probe asserts that the user holds **no** `INSERT/UPDATE/DELETE/EXECUTE` grants and fails the binding if it does.
2. **`DBMS_SESSION.SET_IDENTIFIER(callerSubject)`** plus `DBMS_APPLICATION_INFO.SET_MODULE('MCPFORGE', toolId)` on every call, and cleared on connection return. This puts the **human's identity into Oracle's own audit trail, V$SESSION and AWR**, which is what makes the compensating control auditable on the customer's side, not just ours. It is also the hook a customer's existing **VPD / Oracle Real Application Security** policies can key on — where a customer has row-level policies driven by `CLIENT_IDENTIFIER`, this binding type becomes genuinely identity-aware. The probe reports whether such policies are present.
3. A **caller-to-database-identity mapping** in git (`overlays/<deployment>/mappings/db-identity.yaml`) where the reporting layer expects an application user id rather than a directory identity. **A missing mapping is a hard failure. There is no service-account fallback.**

**Sandboxing — the strongest cage of the five, because it needs to be:**
- **No dynamic SQL, ever.** The statement text lives in the manifest, is hashed at codegen, and is loaded by hash at runtime. Parameters are **bound**, never interpolated. There is no code path in the adapter worker that concatenates a parameter into SQL.
- **Mandatory row cap** injected by codegen (`FETCH FIRST :__rowcap ROWS ONLY`), and a second, independent cap enforced in the worker's fetch loop. Exceeding it is `ROW_CAP_EXCEEDED` with a `next` that names the narrowing parameter to use.
- **Read-only transaction** (`SET TRANSACTION READ ONLY`) for every read tool.
- Hard call timeout at the driver, plus an Oracle **Resource Manager consumer group** for the MCPForge user with a CPU and elapsed-time cap. This is the control that stops a badly-shaped agent query hurting a production reporting instance, and it is configured on the customer's side — so it belongs in the enablement checklist, not only in our code.

**Writes — the policy is: `database` bindings are read-only.**

> **A `database` binding may not be write-capable. A write against an Oracle application goes through a `plsql` binding (a wrapper package), never through raw DML.**

> **EXTENDED by §11.4 — Phase 5, 27 Aug 2026.** This rule is unchanged and is not subsumed by the new binding-authorization stage; §11.4 states why `database` stays standard posture. The single exception path below (`policyException`) **is** elevated posture regardless of binding type.

This is a rule, enforced by `forge validate` (`write: true` + `binding.type: database` is rejected). It removes an entire class of risk — no agent-triggered DML against an application schema, ever — and it costs nothing, because every Oracle application that supports writing supports it through an API package.

The single exception path is a non-application, MCPForge-owned or customer-owned data store where DML is genuinely appropriate. It requires an explicit governance exception recorded in the manifest (`policyException: <approvalRef>`), and then the mechanics are: `EXPLAIN PLAN` plus an affected-row count computed with the same predicate **inside the same transaction**, presented as the plan, followed by `ROLLBACK` — a true `transactional` dry-run and a true `transactional` reversal, the only binding type where both are real. **(Phase 5, 27 Aug 2026:** any tool carrying a `policyException` is **elevated posture** and requires an explicit, expiring, approval-recorded grant to execute — see §11.4.)

**Audit shape:** statement id + statement hash, bind values (redacted by sensitivity class), rows returned, bytes, elapsed, the Oracle SID/serial and the `CLIENT_IDENTIFIER` **echoed back from `V$SESSION`** (proving the identifier was actually set, rather than merely sent), and the consumer group in force.

---

### 3.4 Binding type 3 — PL/SQL package

**Catalogue weight:** 17 of 150, all EBS. Lands in Wave 2. **This is the hardest security surface in the estate** and the design below is what Wave 2's exit criteria 2 and 3 audit against.

**Auth / identity.** No native per-user database session either, so:

1. **A dedicated wrapper schema, `MCPFORGE_WRAP`.** It owns wrapper packages. The MCPForge database user holds `EXECUTE` on the **wrapper only**. It holds **no grants at all** on `APPS`-owned packages. The wrapper is `AUTHID DEFINER` and holds narrow, explicitly-granted `EXECUTE` on exactly the APPS packages its procedures need. The probe asserts both halves: wrapper grant present, direct APPS grant absent. **Wave 2 exit criterion 2 is exactly this assertion.**
2. **EBS context initialisation happens inside the wrapper, per call**, from a caller identity the gateway supplies:
   ```sql
   FND_GLOBAL.APPS_INITIALIZE(p_user_id, p_resp_id, p_resp_appl_id);
   MO_GLOBAL.set_policy_context('S', p_org_id);
   ```
   The gateway resolves `(LTM identity) -> (EBS FND user id, responsibility, org)` from a **git-managed mapping** (`overlays/<deployment>/mappings/ebs-identity.yaml`) with a database-backed cache. **A missing or ambiguous mapping is a hard failure with `IDENTITY_UNRESOLVED`.** There is no service-account fallback and no default responsibility. This mapping table *is* the compensating control, and because it is in git it is diffable, reviewable and auditable — which is the property a service account can never have.
3. `forge validate` requires `binding.ref` to match `^MCPFORGE_WRAP\.[A-Z0-9_]+\.[A-Z0-9_]+$`. **Anonymous PL/SQL blocks are structurally impossible** — there is no field in the manifest that can carry one and no code path in the worker that executes one.

**Sandboxing.** Two supported call paths, both cages:
- **ORDS module** over the wrapper schema (preferred where ORDS is already deployed): the ORDS module exposes only the wrapper procedures; ORDS runs as its own low-privileged schema; standard REST caps apply on top.
- **Direct SQL\*Net** via the Python adapter worker: same wrapper-only grant set, same signed binding descriptor, plus statement timeout and Resource Manager caps as in §3.3.

**Dry-run — and the trap that makes this binding type hard.**

Two mechanisms, and which one is available is **discovered by the probe, not assumed**:

1. **The validate-only convention.** Every wrapper write procedure must expose a validation form — either a `p_validate_only IN VARCHAR2` parameter or a sibling `_VALIDATE` procedure — that runs the same parameter and business validations and returns the same `x_return_status` / `x_msg_data` error stack **without committing**. The wrapper *generator* enforces this shape: `forge codegen` emits the wrapper package skeleton with both forms, and a write manifest whose `bindRef` has no validation form fails validation.
2. **Savepoint rollback.** The wrapper sets a savepoint, calls the API, captures `SQL%ROWCOUNT` and the would-be output keys, and issues `ROLLBACK TO SAVEPOINT` when in dry-run mode.

> **The trap: many Oracle EBS public APIs commit internally.** A `COMMIT` inside the called API destroys savepoint rollback — the "dry run" would actually write. Getting this wrong is the single most damaging mistake available in this architecture.

So the manifest carries `binding.commitsInternally: true | false | unknown`, it **defaults to `unknown`**, and **the capability probe classifies it**: in a non-production environment the probe calls the wrapper's mandatory `PROBE_COMMIT_BEHAVIOUR` procedure, which sets a savepoint, performs a marker insert into a wrapper-owned scratch table, calls the target API with benign parameters, rolls back to the savepoint, and reports whether the marker survived. If the marker survived, the API committed.

- `commitsInternally: false` → savepoint dry-run is permitted; `reversal.class` may be `transactional`.
- `commitsInternally: true` → **savepoint dry-run is forbidden by the gateway**; dry-run falls back to validate-only plus precondition reads; `reversal.class` must be `compensating-tool` or `irreversible`.
- `unknown` → the tool cannot be enabled for write at all. The probe must classify it first.

**Reversal.** EBS standard cancel/reverse APIs, declared as compensating tools (AP invoice cancel, GL journal reverse). `transactional` only in the `commitsInternally: false` case.

**Audit shape — with one addition unique to this binding type.** The wrapper writes its **own** row into `MCPFORGE_WRAP.CALL_LOG` **in the same transaction as the business write**, carrying the correlation id the gateway supplied, the FND user id it initialised, the responsibility and org, and the output keys. That means the database-side audit and the committed business data can never diverge: either both are there or neither is. The gateway's own record is written separately. **A nightly reconciliation job compares the two and alerts on any divergence** — a gateway record with no wrapper row means a call the gateway thought happened and did not, and the reverse means a write that bypassed the gateway. That reconciliation is the practical, ongoing test of "the gateway is the only door" for the PL/SQL surface.

---

### 3.5 Binding type 4 — Function / orchestration script

**Catalogue weight:** 36 of 150 — JDE (17), Siebel (8), Hyperion (8), PeopleSoft Component Interfaces (3). **All of Wave 0 is this binding type**, including all six of its write tools, so everything here is Wave 0 scope.

**Auth / identity — the open question, answered by measurement rather than assertion.**

For JDE, an AIS call needs an AIS session token. There are exactly three ways to get one, and they have very different consequences:

| How the token is obtained | Identity carries? | Allowed? |
|---|---|---|
| **(a) SSO / trusted token provider** — the gateway exchanges the caller's identity for a per-user AIS token via the JDE token provider configured on the instance | **Yes** | Yes — the target state |
| **(b) The human's own JDE credentials, held by MCPForge** | Nominally yes | **No.** MCPForge never holds a human's password for a target system. Structurally excluded. |
| **(c) A shared service account** | **No** | Only under the non-identity-carrying policy: read-only, low sensitivity, or blocked. **No write tool may run this way.** |

**The probe decides which is true, per binding, at install.** Implementation:

- Every `function`-binding application must expose one **probe binding**, authored by the module steward as part of enablement: `MCPFORGE_PROBE_WHOAMI` (JDE orchestration), an equivalent Siebel business service method returning `LoginName`, an Essbase session-context query. It takes no parameters and returns the identity of the context it actually executed under.
- At install and on every deploy, the probe authenticates **as a designated test user** using the configured auth flow, calls the probe binding, and compares the returned identity to the test user.
  - equal → `identity.carries: verified` written into the **probe report** (never into the manifest).
  - not equal (a service account came back) → `identity.carries: no`, and the gateway **automatically** applies `onServiceAccount`: `block` (default for write tools; a write tool with `carries: no` is auto-disabled, full stop) or `readonly-lowsens` for reads.
  - probe binding missing or erroring → `identity.carries: unverified` → the tool is **auto-disabled and visibly reported** with the owning team named. Never "assumed fine."

**And at runtime, not only at install.** `binding.identity.echoOn` controls a runtime check: every write orchestration is composed with a final step that returns the executing user, and the gateway asserts it matches the caller before recording success. Reads are sampled (1 in N, default 20). The cost is one extra field on the response; the benefit is that an instance whose SSO configuration silently changes is caught on the next write, not at the next quarterly probe. **`echoOn: write` is mandatory for every write tool in a `function` binding** — `forge validate` enforces it.

**Sandboxing.** The orchestration runs on the target, so the cage is at the boundary:
- Orchestration/service-method name comes from `binding.ref` only — **never** from a parameter. There is no "call arbitrary orchestration" tool, and none may be authored.
- Inputs are validated against the generated JSON Schema before dispatch, then mapped to the orchestration's typed inputs by a generated mapping. Unmapped extra fields are dropped, not forwarded.
- Response size cap, timeout, and a **per-orchestration concurrency limit** (`maxConcurrency`, default 4). AIS servers are easy to overwhelm; this is a real operational control, not a formality.

**Dry-run — the validate-pair convention (and the new Wave 0 prerequisite).**

> **Every write orchestration must be authored as a pair: `X_EXECUTE` and `X_VALIDATE`.** The validate form runs the same form-service validations with the final submit step branched out, and returns the same error structure.

This is **app-side, low-code work for the JDE steward**, and Phase 1's §10.5 now carries it as a named Wave 0 prerequisite. Six write tools means six pairs. Where a steward cannot produce a validate form for a given orchestration:
- `dryRun.strategy` degrades to `precondition-read`, and
- `humanApprovalRequired` is **forced to `true`** for any tool with `sensitivity: financial`,
so the product degrades safely rather than silently.

For Siebel, the equivalent is a business service method with a validation mode or a separate validation method. For Essbase (Wave 4), MaxL scripts get a `SET DRYRUN`-style guard or a calculation run against a scenario copy — Wave 4 will need to confirm which, and it is flagged here so it is not discovered late.

**Reversal.** JDE-native where it exists: journal reversal (`native-reverse`), voucher void, PO cancel/close (`compensating-tool`). Declared per tool, and Wave 0 exercises at least one live (`jde.ap.voucher.create` → `jde.ap.voucher.cancel`).

**Audit shape:** orchestration name + version, AIS session id, **the identity the target reported executing under** (`target_identity_observed` — this is the field that makes R1/R2 permanently visible rather than a one-off check), whether it matched, the orchestration's own return status, and the extracted result keys.

---

### 3.6 Binding type 5 — Wrapped vendor MCP

**Catalogue weight:** 5 of 150 (Oracle AI Data Platform, Autonomous AI Database). Small, but it carries a specific hazard: MCPForge is not the author of these tools, and their surface can change under us.

**Auth / identity.** Pass through the vendor server's own mechanism, under one governing rule:

> **The wrap may narrow scope. It may never widen it.** MCPForge performs token *exchange*, never token *minting*, and asserts `grantedScopes ⊆ callerEntitlements` before every call.

Where the vendor server supports only a static API key or a shared service credential, it is treated exactly like a non-identity-carrying binding: `identity.carries: no`, read-only, low sensitivity, or blocked.

**Sandboxing.** The wrapped server runs as a **separate process or container**, never in-process with the gateway, with its own egress allowlist and its own resource limits. The MCPForge gateway speaks MCP to it *as a client*. This keeps a vendor server's bugs, dependencies and network access outside our trust boundary.

**The surface-drift control — this is the important part.** At every probe run, MCPForge calls `initialize` + `tools/list` on the vendor server and **diffs the advertised tool set against the wrap manifests**:
- A vendor tool we have classified and wrapped → published normally.
- A vendor tool that has **appeared** and is not classified → **not published**. It is reported in the probe output and shown in the portal as *"unclassified vendor tool, not published — needs classification and review."* An unreviewed write tool from a vendor must never silently become available through MCPForge.
- A wrapped tool that has **disappeared** or whose schema changed → auto-disabled with an agent-actionable reason and an owner named.

**Dry-run.** Vendor-dependent, and:

> **If the vendor tool has no dry-run, MCPForge does not synthesise one.** A fabricated "dry run" that does not actually exercise the vendor's validation is worse than none, because it produces false confidence.

The manifest declares `precondition-read` at best, and any write-capable wrapped tool with no real dry-run gets `humanApprovalRequired: true`.

**Reversal.** Whatever the vendor offers, declared explicitly; `irreversible` where nothing does.

**Audit shape:** vendor server id + version, the vendor tool name and its advertised schema hash at call time, the vendor's own correlation id, request/response envelopes (redacted), and the scope set asserted.

---

### 3.7 Summary — the five handshakes at a glance

| | **rest** | **database** | **plsql** | **function** | **wrapped-vendor** |
|---|---|---|---|---|---|
| **Identity** | Per-user OAuth token exchange — carries natively | None; `CLIENT_IDENTIFIER` + git-managed mapping as compensating control | None; wrapper schema + `FND_GLOBAL`/`MO_GLOBAL` from a git-managed mapping | **Verified per binding by probe** — SSO token exchange or nothing | Vendor's own; narrowed never widened |
| **Sandbox** | Method fixed at codegen, host/path allowlist, size + time caps | Named bound statement by hash, mandatory row cap, read-only txn, Resource Manager | Wrapper-only EXECUTE grant, no anonymous blocks, ORDS or worker | Allowlisted orchestration name, typed mapping, concurrency cap | Separate process, own egress allowlist, surface diff at probe |
| **Writes allowed** | Yes | **No** (policy) | Yes | Yes | Yes, if classified |
| **Dry-run** | native / shadow-write / precondition-read | n/a (read-only); `transactional` in the exception case | validate-only, **or** savepoint **only if `commitsInternally: false`** | **validate-pair orchestration**, else precondition-read | Vendor's own, or none — never synthesised |
| **Reversal** | compensating-tool / native-reverse | transactional (exception case) | compensating-tool / transactional | native-reverse / compensating-tool | vendor-dependent / irreversible |
| **Review path** | Expedited available for reads | Standard; expedited only for row-capped allowlisted reads | **Standard always** | **Standard always** | Expedited only for read-only vendor surfaces |
| **Unique audit field** | URL template + granted scopes | `CLIENT_IDENTIFIER` echoed from `V$SESSION` | wrapper `CALL_LOG` row in the same transaction | `target_identity_observed` | vendor schema hash at call time |

---

## 4. Gateway architecture

### 4.1 Process model — what "independently deployable module server" means in practice

Phase 1's settled decision #1 makes the **module** the deployment boundary, 5–15 tools. Taken naively that implies 42 network services. That is an operations bill nobody should pay for a 150-tool catalogue.

**Resolution: a module server is a versioned *artefact*, not necessarily a *process*.**

A module server is an independently versioned, independently releasable bundle (`generated/` output plus its manifest set plus its role tags) that runs in one of two modes:

- **Mode A — hosted in the gateway process (default).** The gateway loads N module bundles. Each has its own config namespace, its own credential scope, its own kill switch, its own version, its own release train. Lowest latency, one process to operate.
- **Mode B — standalone process behind the gateway (promotion).** The bundle runs as its own MCP server; the gateway is its only client.

**The promotion rule — a bundle moves to Mode B when any *one* of these is true** (deliberately a lower bar than the server-split rule, because promotion is cheap and reversible):
1. It needs a runtime the gateway does not have (the Python Oracle worker is always Mode B).
2. It has a materially different auth boundary — different tenancy, different network zone, a credential the rest of the gateway must not be able to reach.
3. It carries a different data-sensitivity class needing process isolation (e.g. personal data under a separate DPA).
4. Its release cadence is genuinely independent and its blast radius on restart is unacceptable.
5. It is a wrapped-vendor server (always Mode B, per §3.6).

Wave 0 runs three module bundles in Mode A plus the Oracle worker unused (JDE is `function`/REST). Mode B first appears in Wave 1 (wrapped-vendor) and Wave 2 (Oracle worker for EBS).

This preserves every property the decision was made for — independent versioning, independent grants, independent kill switch, no cross-module coupling — without 42 deployments.

### 4.2 The request path

```
MCP client
  |  Streamable HTTP, spec-baseline 2026-07-28
  v
[1] Transport + protocol          session id, initialize, capability negotiation
[2] Authentication                OAuth 2.1 resource-server validation (or local-store session) -> Principal
[3] Identity resolution           Principal -> subject, display name, groups; target-identity mappings loaded
[4] Scope resolution              visible(session) = Deployed ∩ Granted ∩ Activated ∩ ProbeEnabled ∩ ¬KillSwitched
[5] Dispatch                      tools/list  -> scoped list (§5)
                                  tools/call  -> policy chain below
[6] Policy chain (ordered, fail-closed)
      6a  tool in resolved scope?                 -> TOOL_NOT_IN_SCOPE
      6b  tool enabled by probe + kill switch?    -> TOOL_DISABLED
      6c  rate limit / concurrency                -> RATE_LIMITED
      6d  argument validation (compiled Ajv)      -> INPUT_INVALID
      6e  sensitivity vs role ceiling             -> POLICY_GUARDRAIL_BREACH
      6f  guardrails incl. SoD                    -> POLICY_GUARDRAIL_BREACH
      6g  write? plan-or-confirm state machine    -> PLAN_REQUIRED / PLAN_ARGUMENT_MISMATCH / APPROVAL_REQUIRED
      6h  idempotency lookup                      -> replay
[7] Binding executor              rest | oracle-worker(database|plsql) | function | vendor-client
[8] Result shaping                result-key extraction, redaction by sensitivity, row cap re-check, summary
[9] Audit                         outbox row written in the same transaction as idempotency completion
  |
  v
MCP client
```

Steps 4 and 6a are deliberately **two independent checks of the same fact**. Scope resolution decides what is listed; 6a re-checks at call time against the resolved set. A tool that was never listed still cannot be called — which matters because §5's fallback `forge.invoke` path lets a client name a tool id directly.

> **EXTENDED by §11.2 and §11.4 — Phase 5, 27 Aug 2026.** The path gains step **`[2a]` consumer authentication and registration check** between `[2]` and `[3]`, and the policy chain gains **`6a′` consumer active and authorized** and **`6e′` binding-type authorization**. The updated chain is in §11.4.2. Stage labels are primed rather than renumbered so every existing reference stays valid.

### 4.3 Process-scoped roles, enforced at the gateway, without a Tier-4 layer

**A role is a git artefact.** `roles/p2p.yaml`:

```yaml
apiVersion: mcpforge/v1
kind: Role
id: p2p
label: Procure-to-Pay
description: Raise and approve purchase orders, voucher against them, and post the resulting journals.
includes:
  - jde.scm.purchase_order.*
  - jde.ap.voucher.*
  - jde.fin.journal.*
  - jde.fin.gl_journal.search
  - jde.fin.batch.get_status
excludes: []
sensitivityCeiling: financial
writeAllowed: true
coreTools:                       # the resident set. Counts against budgetTokens.
  - jde.scm.purchase_order.create
  - jde.scm.purchase_order.approve
  - jde.ap.voucher.create
  - jde.fin.journal.create
  - jde.fin.journal.submit
  - jde.ap.voucher.search
budgetTokens: 1300               # CI-enforced ceiling on the resident set (§5.6)
segregationOfDuties:
  - conflict: [jde.scm.purchase_order.create, jde.scm.purchase_order.approve]
    disposition: warn-and-require-exception
mutuallyExclusiveWith: []
```

**Compilation.** `forge codegen` resolves every glob into an **explicit tool-id list** and writes `generated/roles/p2p.scope.json`. This is not an optimisation; it is a governance mechanism. When a new tool matching `jde.ap.voucher.*` is added, the compiled scope file changes, and that change shows up as a **diff in the pull request** — so silently widening a role by adding a tool is impossible. Reviewers see the grant change, not just the tool addition.

**Enforcement.** At step 4, `granted = ∪ scope.json of every role the caller holds`. At step 6a, membership is re-checked. There is no other grant mechanism — no per-user tool grants, no ad-hoc allowlists, no "admin sees everything." An admin who needs a tool holds a role that includes it.

**What a role explicitly is not.** It is a **grant plus a narrowing lens**. It has no runtime, no orchestration, no composite tools, no state machine, no execution order. If a business process needs five tools called in sequence, **the agent does that**, not MCPForge. This is the settled no-Tier-4 decision restated in implementation terms: there is no deployable artefact for a process, only a file that lists tool ids and a lens that filters a list.

**Segregation of duties.** `forge validate` walks each role for declared `conflict` pairs and for the implicit pattern (`create` and `approve` verbs on the same `{app}.{module}.{entity}`). A conflict produces a build **warning** plus a required `sodException` record naming an approver, or a build **failure** if `disposition: block`. At runtime the `sodConflict` guardrail (§3.1.3) refuses the *call*, not just the grant. Both halves are needed: the role check catches design-time mistakes, the call check catches a caller who legitimately holds two roles that are individually fine.

This is also the direct answer to the external deck-review comment about SoD risk in process roles (R10) — it is now a mechanism, not an acknowledgement.

### 4.4 Identity — pluggable, local for Wave 0, LTM AD before Wave 1

**One interface, everything downstream consumes only `Principal`:**

```ts
interface IdentityProvider {
  authenticate(req: Request): Promise<Principal>;          // 401 shape is provider-specific, Principal is not
  resolveGroups(p: Principal): Promise<string[]>;
  metadata(): ProviderMetadata;                            // token endpoints, issuer, JWKS — for MCP OAuth discovery
}
interface Principal {
  subject: string;          // stable, opaque, immutable — the audit key
  displayName: string;
  email?: string;
  groups: string[];
  idp: 'local' | 'oidc';
  authTime: Date;
  amr: string[];            // how they authenticated — recorded in audit
}
```

**Wave 0 — `LocalUserStore`.** Users in Postgres; Argon2id password hashes; optional TOTP; the gateway itself issues **short-lived signed JWTs with an OIDC-shaped claim set**. That last point is the key design move: even in Wave 0 every downstream component consumes a JWT with `sub`/`groups`/`iat`/`exp`, so nothing downstream has to change when the issuer changes. Admin UI in the portal (Phase 3).

**Wave 1+ — `OidcProvider` against LTM AD** (Entra ID or ADFS). The portal uses authorization code + PKCE. MCP clients use the OAuth 2.1 flow the MCP spec defines, with the gateway as Resource Server and LTM AD as Authorization Server; the gateway publishes the protected-resource metadata the spec requires.

**Role mapping is git, not the IdP.** `overlays/<deployment>/mappings/groups-to-roles.yaml` maps AD group DNs (or local group names) to MCPForge role ids. This means the role grant is reviewable in a pull request rather than buried in a directory, and it means the Wave 0 local store and the Wave 1 AD deployment use *the same mapping file format*.

**What makes the swap a config change and not a hope.** Three things, all Wave 0 scope:
1. `identity.provider: local | oidc` in the overlay, plus a provider block. No other code path knows which is in use.
2. **One identity contract-test suite, run against both providers in Wave 0 CI** — the OIDC provider tested against a disposable Keycloak (or an Entra dev tenant) in Testcontainers. The AD swap is therefore proven before it is needed, at small cost, instead of being discovered at the Wave 1 boundary.
3. `Principal.subject` is the only identity value written to audit, mappings and idempotency keys. A **subject-migration tool** (`forge identity remap`) exists from Wave 0 to rewrite the local-subject → AD-subject correspondence in the mapping files, because the one thing that genuinely changes at swap time is the subject value.

**The principle, as enforced code.** "The MCP layer never holds more privilege than the human using it" is implemented as four rules, each with a test in the privilege-escalation suite (Phase 1 G3 @ M2):
1. No binding may use a credential that is not either (a) exchanged from the caller's identity, or (b) declared non-identity-carrying and therefore constrained by policy.
2. A missing target-identity mapping is a hard failure. **There is no service-account fallback anywhere in the codebase.** This is enforced by a lint rule and a code-review checklist item, because it is the one shortcut that would quietly hollow out the whole security claim.
3. `identity.carries: verified` can only be written by the probe, never by a manifest.
4. Any tool whose probe reports service-account execution is auto-constrained (read-only, low sensitivity) or auto-disabled, with no manual override path in code — only a governance exception with an approval record.

> **EXTENDED by §11.5 — Phase 5, 27 Aug 2026.** Rule 2 is about **substitution**, not storage, and §11.5 makes that explicit as a four-part test rather than leaving it implicit. A binding that structurally cannot carry per-user identity may hold a scoped credential; it may never be used as a substitute for an identity that should have resolved and did not.

### 4.5 The capability probe — real implementation

**When it runs:** at install; on every bundle deploy; on a daily schedule; and on demand from the portal or `forge probe`.

**What it is:** a TypeScript orchestrator that, for every tool in the deployed catalogue, generates a probe plan from the manifest's binding type and executes it. **Probe plans are read-only or validate-only by construction** — `forge validate` refuses a probe plan that would execute a write, and the probe runner refuses to run against a target flagged `production` for any check classified as mutating.

**Per binding type:**

| Binding | Probe checks |
|---|---|
| `rest` | Token acquisition for the test identity succeeds · the declared host/path resolves (`OPTIONS`, metadata endpoint, or a bounded safe `GET`) · the response shape matches the declared output paths · identity check against a `/me`-style resource where one exists |
| `database` | Connect as the module DB user · `SELECT 1` · every referenced object exists (`ALL_OBJECTS`) and is readable (`ALL_TAB_PRIVS`) · **no write grants held** · `SET_IDENTIFIER` propagates (read back from `V$SESSION`) · VPD/RAS policies present? (reported, not required) · Resource Manager group in force? |
| `plsql` | Wrapper package exists and is `VALID` · `EXECUTE` granted on wrapper · **`EXECUTE` NOT granted on any APPS-owned object** · `PROBE_CONTEXT` returns the FND user/resp/org it can establish for the test identity · `PROBE_COMMIT_BEHAVIOUR` classifies `commitsInternally` (§3.4) |
| `function` | Auth flow yields a token for the test identity · `MCPFORGE_PROBE_WHOAMI` returns **which identity actually executed** · for write tools, the `*_VALIDATE` sibling exists and returns the expected error structure · orchestration version matches `refVersion` |
| `wrapped-vendor` | Vendor `initialize` + `tools/list` succeed · advertised tool set diffed against wrap manifests · schema hashes compared · scope narrowing asserted |

> **EXTENDED by §11.4.4 — Phase 5, 27 Aug 2026.** The `plsql` probe additionally reconciles the gateway's compiled `bindingGrants` against the database-side `EXECUTE` grants and reports any grant present on one side only. Built at Wave 0, exercised at Wave 2.

**Output — a machine-readable artefact, not a log** (`probe-report.json`, schema-validated, Phase 1 W1 exit criterion 10). Per tool:

```jsonc
{
  "toolId": "jde.ap.voucher.create",
  "status": "disabled_identity_unverified",
  "bindingType": "function",
  "checks": [ { "name": "whoami", "result": "fail", "detail": "executed as SVC_MCPFORGE, expected TESTUSER01" } ],
  "identityCarries": false,
  "commitsInternally": null,
  "owningTeam": "JDE Finance CoE",
  "remediation": "Configure the AIS token provider for SSO on PY920, or re-scope this tool to read-only. Owner: JDE CNC.",
  "agentMessage": "This capability exists but is disabled: identity could not be verified for this binding. Do not retry; it will not succeed until the owning team enables it."
}
```

Status is a closed enum: `resolved · degraded_readonly · disabled_missing_binding · disabled_no_grant · disabled_identity_unverified · disabled_schema_drift · disabled_kill_switch`. **There is no third state and no silent failure** — every tool in the catalogue has exactly one of these after every probe run (Phase 1 W0 exit criterion 3).

**How the gateway consumes it, and the one subtle decision:**

> A disabled tool is **excluded from `tools/list`** (it must not consume the context budget of an agent that can never call it) but **remains discoverable through `forge.find`**, which returns its card with `status: "disabled"` and the `agentMessage` above.

That is the resolution of the tension between "no dead ends" and "protect the token budget." The agent asking "how do I create a voucher?" gets a clear, actionable *"this exists and is switched off, here is why and who owns it, do not retry"* instead of either a silent absence or a wasted 200 tokens in every session.

Consumers of `probe-report.json`: the gateway (enable/disable), the portal Application Enablement page (the enablement backlog, per app, with owners), CI (a probe regression fails a deploy), and the wave checkpoint (agenda item 4, reconciling prediction against actuals in `mcpforge_enablement_facts.md`).

### 4.6 Audit trail — storage and shape

**Where.** PostgreSQL, one append-only table plus satellites. **Not git** — git holds definitions, the database holds events (§1.5).

**Immutability.** The application role holds `INSERT` and `SELECT` only; `UPDATE`/`DELETE` are revoked at the database. Each row carries `prev_hash` and `row_hash`, forming a per-deployment hash chain; `forge audit verify` re-walks the chain and reports the first break. Rows stream to the customer's SIEM through a standard sink where one exists.

**Shape** (the columns that matter; types elided):

```sql
audit_call (
  id, ts, correlation_id, session_id, parent_call_id,

  -- who
  caller_subject, caller_display, caller_idp, caller_amr, caller_roles[], on_behalf_of,

  -- what
  tool_id, tool_version, manifest_sha, server_id, package_id, binding_type,
  archetype, verb, entity, sensitivity_class, is_write,

  -- where
  target_system, target_env, target_object,       -- binding.ref
  deployment_id, gateway_version, bundle_version,

  -- phase
  phase,                    -- plan | execute | reject | reverse
  confirm_token_hash, plan_hash, args_hash, idempotency_key, replayed,

  -- inputs and outputs
  args_redacted,            -- redaction driven by sensitivity_class + per-field flags
  result_keys,              -- THE reversal handle: business keys created or changed
  row_count, bytes_out,

  -- outcome
  outcome,                  -- ok | business_error | policy_denied | binding_error | timeout
  error_code, error_message_agent,               -- the exact text returned to the agent
  denied_by_rule,                                -- which policy rule refused, when policy_denied

  -- identity honesty
  identity_carrying, target_identity_observed, identity_match,
  compensating_control,                          -- 'client_identifier' | 'wrapper_schema' | 'none'

  -- reversal
  reversal_class, reverses_call_id, reversed_by_call_id,

  -- performance
  latency_ms_total, latency_ms_gateway, latency_ms_target,

  -- integrity
  prev_hash, row_hash
)
```

> **EXTENDED by §11.3 — Phase 5, 27 Aug 2026.** The `who` block gains `consumer_id`, `consumer_record_sha`, `consumer_auth_method`, `consumer_session_id` and `human_in_the_loop`; a new `audit_credential_ref(call_id, secret_ref, version)` satellite joins the others. **These land inside `W0-C2`, before the first audit row exists** — a later migration would put a schema discontinuity in the hash chain.

Satellites: `audit_probe` (probe runs and per-tool results), `audit_approval` (human approvals: who, when, what plan hash), `audit_listing` (scoped `tools/list` responses — which tools were exposed to whom, needed to reconstruct why an agent chose what it chose), `consumption_edge` (tool → consuming agent/platform/scope, rolled up for G9). **(Phase 5:** `consumer_id` is what feeds this satellite. Before Phase 5 there was no authenticated source for its 'consuming agent' value — see `05` §1.2.)

**Three queries the shape is designed to answer in one hop**, because these are the ones that get asked under pressure:
1. *"Everything this person did in this system this week"* — `caller_subject` + `target_system` + `ts` range.
2. *"Who created document 12345, through which tool, under whose approval, and has it been reversed?"* — GIN index on `result_keys`, then `reversed_by_call_id`.
3. *"Show me every write that was planned and never confirmed"* — `phase='plan'` with no matching `execute` on the same `plan_hash`. This is the abandoned-intent view, and it is genuinely useful for spotting an agent that keeps proposing things humans keep declining.

**Redaction.** Per-field, driven by `sensitivity` plus optional per-input `redact: true`. Redacted values are replaced by `sha256(value)[:12]` rather than removed, so equality can still be reasoned about ("the same bank account appeared in these six calls") without exposing the value.

**Retention.** Configured per deployment in the overlay, defaulting to 7 years for `financial`, 2 years otherwise. Retention deletion is the one exception to append-only and runs as a privileged, separately-audited job.

### 4.7 Kill switch, caps, and server density

**Kill switch (Phase 1 G2 @ M2, W3 exit criterion 7).** A `runtime_flags` table, hot-reloaded on a 5-second poll, with entries at four granularities: **tool · module server · binding type · whole deployment** — **EXTENDED by §11.2 (Phase 5, 27 Aug 2026): five granularities. `consumer` joins the list.** `forge kill consumer:<id> --reason "…"`. Disabling emits `notifications/tools/list_changed` and removes the tool from subsequent listings; a call to a killed tool returns `TOOL_DISABLED` with the flag's own reason text and a `next`. No redeploy, no restart. `forge kill jde.ap.voucher.create --reason "..." --until 2026-09-01`.

**Caps.** Row caps (per tool, from the manifest, re-checked after fetch); response byte caps; per-tool and per-caller rate limits; per-binding concurrency limits; global gateway concurrency. All in the overlay so a customer deployment can tighten them without a code change; none can be loosened past a compiled-in hard ceiling.

**Server density (R4) — the rule, and a recommendation the user must confirm.**

The rule: **a module server below 5 tools is not deployed as its own server.** The reason is not tidiness. Every server carries fixed discovery overhead — an entry in role scopes, an index partition, a probe plan, a kill-switch entry, a release train — so a 2-tool server costs nearly what a 12-tool one costs while contributing a sixth of the value, and it distorts the TTFC arithmetic in §5.6.

Options are top-up to ≥5 in the same wave, or merge into the nearest sibling module in the same application and pillar. **Recommendation for the user (not a decision this document may take):** top up **General Ledger** (4) and **Accounts Receivable** (3) — both are core finance modules with obvious missing verbs from the closed list — and **merge Inventory** (2) into Procurement, since the P2P story already spans them. This must be settled **before those three servers are built** (Wave 2 and Wave 5), not at Wave 5.

### 4.8 "The gateway is the only door" — how it is actually enforced, and the latency budget

**Enforcement is network-level, not politeness.** Three controls, all testable:
1. Target systems accept connections only from the gateway's egress identity — mTLS client certificate, service-principal, or IP allowlist, depending on the target. A module bundle in Mode B accepts connections only from the gateway (mTLS, mutual).
2. The database users, ORDS endpoints and wrapper-schema grants exist **only** for the gateway's credentials. There is no second credential that could be used from elsewhere.
3. For the PL/SQL surface, the wrapper `CALL_LOG` reconciliation (§3.4) detects a bypass **after the fact** even if a network control were misconfigured — a wrapper row with no matching gateway record is a bypass alarm.

Wave 0 exit criterion 5 ("a direct module-server call from outside the trust boundary is refused") is tested by a CI job that attempts exactly that against the deployed environment and asserts refusal.

**Availability.** The gateway is stateless apart from session and plan-token state, both in Postgres. Run N replicas behind a load balancer. Plan tokens work across replicas because they are HMAC-signed and their nonces live in the shared database. This answers the "gateway is a chokepoint" review comment (R10): it is a chokepoint by design for *policy*, and horizontally scalable for *capacity*.

**Latency budget** (Phase 1 G2 @ M3: p95 gateway-added < 150 ms, excluding target time). Answering the "latency uncalculated" review comment with an actual budget:

| Stage | Budget (p95) |
|---|---|
| Transport + protocol | 3 ms |
| Auth (cached JWT validation, JWKS cached) | 5 ms |
| Identity + mapping resolution (cached) | 3 ms |
| Scope resolution (in-memory set ops) | 1 ms |
| Policy chain incl. compiled Ajv validation | 5 ms |
| `forge.find` when called (BM25 + optional 150-vector cosine) | 12 ms |
| Confirm-token verify + nonce consume (1 DB round trip) | 8 ms |
| Idempotency lookup/insert (1 DB round trip) | 8 ms |
| Result shaping + redaction | 4 ms |
| Audit write (outbox insert, same txn as idempotency) | 6 ms |
| Headroom | ~95 ms |
| **Total budget** | **150 ms** |

Measured per stage with OpenTelemetry spans and reported at every checkpoint. The two database round trips are the only real risk; if p95 drifts, the fix is a co-located database or a Redis session/nonce cache — noted here so it is a known lever rather than a surprise.

---

## 5. Tool discovery and token efficiency — the mechanism

This is the section Phase 1 called out as the most important thing Phase 2 owns, and the one with a named escalation path if it could not be solved inside the spec baseline.

**Verdict up front: R5 is not escalated. The targets are reachable server-side, with spec-baseline MCP only, and the arithmetic is in §5.7.** One Phase 1 parameter is tightened rather than relaxed, with the written reason Phase 1 requires (§5.10).

### 5.0 The constraint, restated as a design brief

Everything below uses **only** these primitives, all baseline as of 2026-07-28:

- `tools/list` — the server decides what is in it. This is the whole lever.
- Cache directives on list responses: `ttlMs`, `cacheScope`.
- `notifications/tools/list_changed`.
- `tools/call` on ordinary tools — including tools whose job is search and description.
- `_meta` on tool definitions, for optional machine-readable narrowing hints.
- OAuth 2.1 resource/scope semantics, which the gateway already needs for identity.
- Structured tool ids, which cost nothing and are already settled.

Nothing here needs client-side progressive disclosure, client tool filtering, a Claude-specific behaviour, or a REST facade. **A client that does nothing but `initialize` → `tools/list` → `tools/call` gets the full benefit**, because all of the intelligence lives in what the server chooses to put in the list and in what the search tool returns.

### 5.1 Four narrowing axes, and how they compose

The architecture already contains four independent structures. They are not four competing ideas; they compose as a set intersection, and that composition **is** the mechanism.

| Axis | What it is | Where it comes from | Who sets it |
|---|---|---|---|
| **Package (slice)** | What is *deployed* here at all | `packages/<id>.yaml` (§6) | Deployment config |
| **Role** | What this human is *granted* — P2P, R2R, O2C | `roles/<id>.yaml`, compiled to explicit tool-id lists (§4.3) | Identity + group mapping |
| **Persona / activation** | What this *session* is currently working on | `forge.activate`, session state | The client/agent, at runtime |
| **Probe + kill state** | What actually *works* right now | `probe-report.json` + `runtime_flags` (§4.5, §4.7) | The system |

```
visible(session) = Deployed(package)
                 ∩ Granted(∪ caller roles)
                 ∩ Activated(persona | default)
                 ∩ Enabled(probe status = resolved | degraded_readonly)
                 ∩ ¬KillSwitched
```

And the *structured* narrowing fields — module boundary, binding type, process tag, package tag, verb, entity, sensitivity, write flag — are the **facets of `forge.find`** (§5.4). Same fields, two uses: set membership decides what is *listed*, field matching decides what is *found*.

Because the tool id is `{app}.{module}.{entity}.{verb}`, every one of those axes except role membership is derivable from the id itself by prefix. `jde.ap.voucher.*` is a module+entity narrowing expressed as a string operation. That is why the naming convention is load-bearing and not cosmetic: it lets an agent narrow with no extra protocol surface and no extra round trip.

### 5.2 The discovery surface — four meta-tools, always resident

These are ordinary MCP tools. Any client can call them. They are the only thing that is *always* in `tools/list`.

**1. `forge.find`** — the search tool.
```jsonc
{ "query": "record a supplier invoice against a PO",   // natural language, optional
  "app": "jde", "module": "ap", "entity": "voucher",   // optional structured filters
  "verb": "create", "write": true, "bindingType": null,
  "process": "P2P", "package": null,
  "limit": 5 }                                          // default 5, max 10
```
Returns a shortlist of **tool cards** (§5.3), each ≤60 tokens, plus a `guidance` line. Or, when nothing clears the score floor, `{"result":"no_tool", ...}` (§5.4.4).

**2. `forge.describe`** — full definition on demand.
```jsonc
{ "toolIds": ["jde.ap.voucher.create"] }   // max 5 per call
```
Returns the complete JSON Schema, the examples, the error catalogue, the write-safety summary (dry-run strategy, reversal class, whether approval is required) and the sensitivity class. **Examples and error catalogues live here and nowhere else** — they are the largest part of a tool's documentation and they must not be in the resident definition (§5.3).

**3. `forge.activate`** — set this session's working scope.
```jsonc
{ "role": "p2p" }                                     // or
{ "toolIds": ["jde.ap.voucher.create", "..."] }       // or
{ "package": "jde-fin", "module": "ap" }
```
Sets session scope, returns the resulting tool count and token estimate, and **emits `notifications/tools/list_changed`**. The client's next `tools/list` returns the activated set. Refuses (with a clear message) any activation that would exceed the VTC hard cap or the caller's grants.

**4. `forge.invoke`** — the universal fallback executor.
```jsonc
{ "toolId": "jde.ap.voucher.create", "arguments": { … }, "confirm": null }
```
Executes any tool the caller is granted, through the **identical** policy chain, two-phase confirm, guardrails and audit path as a direct call. It exists so that a client which ignores `list_changed` — or a client whose agent simply prefers not to re-list — can still act immediately after `forge.describe`, with **zero** additional protocol requirements.

Honest tradeoff, stated because it matters: calling through `forge.invoke` means the client cannot validate arguments against a schema it has loaded. The gateway compensates by validating strictly server-side with the compiled validator and returning `INPUT_INVALID` errors that name the offending field, the expected type, and the corrective action — the same quality of message a client-side validator would give. In benchmark runs, `forge.describe` → `forge.invoke` scores the same SA@1 as `activate` → direct call; it costs one more round trip only when the agent guesses arguments wrong.

**Total resident cost of the four meta-tools: ~440 tokens.** They are written tersely on purpose and their budget is CI-enforced like any other tool's.

### 5.3 Token budgets — what each representation actually costs

Three representations of a tool, at three price points. **All three budgets are enforced at codegen time**, because a budget checked at runtime is a budget already blown.

**(a) The card — ≤60 tokens.** What `forge.find` returns, what the disabled-tool path returns, what the portal's compact list renders.
```jsonc
{ "id": "jde.ap.voucher.create",
  "purpose": "Create an AP voucher against a supplier, optionally matched to a PO.",
  "verb": "create", "entity": "voucher", "write": true,
  "binding": "function", "sensitivity": "financial",
  "roles": ["p2p"], "status": "resolved" }
```
Measured at 54 tokens with the pinned tokenizer. `purpose` ≤14 words is what holds the line.

**(b) The resident definition — ≤200 tokens typical, 400 hard cap.** What appears in `tools/list`. Name + description (the `purpose` string, reused — not a second prose blob) + input schema. Schema rules enforced by codegen:
- One-line parameter descriptions, ≤12 words.
- No nesting deeper than two levels.
- Enums longer than 12 values become `enumRef` and are fetched via a lookup tool, not inlined. (ISO currency alone would be 180 values.)
- **No examples, no error catalogue, no long-form prose** in the resident definition — those live in `forge.describe`.
A typical 5–6 parameter Oracle tool lands at 150–200 tokens.

**(c) The full description — ≤600 tokens.** What `forge.describe` returns: everything above plus examples, the error catalogue with `next` hints, write-safety details and the reversal contract.

**(d) The role budget — ≤1,300 tokens, CI-enforced.** The sum of the resident definitions of a role's `coreTools`. This is the budget that actually makes TTFC work, and it is new — Phase 1 specified a per-tool budget but the binding constraint is per-*role*. `forge validate` fails a role whose core set exceeds it, naming the tools to demote. Demoting a tool from `coreTools` does not remove it from the role; it just means the agent reaches it via `forge.find` (one extra hop) instead of finding it already resident.

### 5.4 `forge.find` — what it indexes and how it matches

**The index is a build artefact**, `generated/index/catalogue-index.json`, produced by `forge codegen` and loaded into gateway memory at boot. At 150 tools it is a few hundred kilobytes. **No vector database, no search service, no external dependency** — and at 10× the catalogue size that is still true.

#### 5.4.1 What each entry contains

1. **Structured fields** (exact-match filters, applied *before* ranking): `app, module, entity, verb, bindingType, archetype, sensitivity, write, processTags[], packageTags[], roles[], status`.
2. **A lexical document** for BM25: `title + purpose + aliases + entity + module label + app label + functionalArea + the tool id split on separators`. Aliases are where domain vocabulary lives ("book a payable", "supplier invoice", "three-way match") and they are the highest-leverage field in the whole manifest for selection accuracy.
3. **An optional embedding vector** (§5.4.3).
4. **Disambiguation text** for near-miss handling (§5.5).

**What is deliberately NOT indexed: the benchmark intents.** Indexing the eval set would make the benchmark measure itself. `forge validate` fails if any string in `evals/**` appears verbatim in an `aliases` list. This is a small rule with large integrity consequences and it must survive into Phase 4's backlog.

#### 5.4.2 The ranking pipeline

```
1. Hard filters      structured fields + visible(session) from §5.1.
                     A tool the caller cannot reach is never ranked, never returned.
2. Lexical channel   BM25 over the search document.
3. Semantic channel  cosine over embeddings (when enabled, §5.4.3).
4. Fusion            reciprocal rank fusion; a tool ranked well by both wins.
5. Deterministic boosts
     +  the query contains a closed-list verb that matches the tool's verb
     +  the query names an entity that matches the tool's entity
     +  the tool is in the caller's active role
     +  tiny tiebreak on consumption count (capped, so a popular tool cannot bury a correct rare one)
     -  penalty for status != resolved
6. Floor + margin    absolute score floor -> "no_tool"; small top-2 margin -> disambiguation (5.5)
```

Steps 1 and 5 are what make this work far better than generic search: the closed verb list and the fixed entity vocabulary mean a large part of a business intent maps to **structured** fields, not to fuzzy text. "Cancel the voucher" contains a verb from a 17-item closed list and an entity from the catalogue. That is a near-exact lookup wearing a natural-language coat.

#### 5.4.3 Do we need embeddings server-side?

**Not to hit the targets at 150 tools, and not in Wave 0.** BM25 over title + purpose + aliases, with the structured verb/entity boosts, should carry SA@1 to target on a catalogue this small and this well-labelled. The scorer is built **pluggable** and the decision is staged:

- **Wave 0:** lexical only. Measure SA@1 on the benchmark. Record it.
- **Wave 1 (the hard gate):** if SA@1 is below 90% on the lexical channel alone, enable the embedding channel — a small sentence-embedding model (bge-small / gte-small class, ~130 MB) run **in-process via `onnxruntime-node`**. Vectors are precomputed at codegen time and shipped in the index; only the query is embedded at runtime (single-digit milliseconds on CPU). Cosine over ≤150 vectors is a brute-force loop — no index structure required, and none until the catalogue is in the tens of thousands.
- **No external embedding API, ever.** It would add a network dependency, a cost, a data-residency question and a non-determinism to a component that must run in a customer's tenancy and produce reproducible CI numbers.

The client-facing contract is unchanged either way: `forge.find` is an ordinary MCP tool with a plain JSON input. Whether it is doing BM25 or hybrid retrieval behind that is an implementation detail — which is precisely the property that keeps this design spec-baseline.

#### 5.4.4 Negatives — when the correct answer is "no tool"

Phase 1 requires ≥10% of benchmark cases to be out-of-catalogue intents where returning a plausible-but-wrong tool scores as a failure equal to returning nothing.

`forge.find` returns:
```jsonc
{ "result": "no_tool",
  "reason": "No tool in this catalogue covers payroll adjustments. The closest capabilities are in AP and GL, which do not touch payroll.",
  "nearest": [ { "id": "jde.ap.voucher.create", "score": 0.21 } ],
  "next": "If this capability should exist, raise it through the MCPForge portal's Business Intake. Do not attempt to approximate it with another tool." }
```

**The floor is calibrated, not guessed.** Procedure, run at every wave boundary and recorded in the checkpoint artefact: sweep the score floor over the benchmark's negative set, choose the value that maximises F1 on negatives **subject to** SA@1 on positives not dropping below target. The floor is a committed configuration value with the calibration run that produced it. This is what stops "no_tool" becoming either useless (never fires) or destructive (fires on valid intents).

The `next` line matters as much as the verdict. Telling an agent explicitly *not* to approximate is the difference between a clean miss and a wrong write.

### 5.5 Near-miss pairs — the `.get` / `.search` / `.create` problem

Phase 1 requires ≥20% near-miss pairs. These are the cases that actually break tool selection in production: `voucher.get` vs `voucher.search`, `journal.create` vs `journal.submit`, `purchase_order.create` vs `purchase_order.approve`.

Three mechanisms, all structural:

1. **A required `disambiguation` field.** Any two tools sharing the `{app}.{module}.{entity}` prefix must both carry one. `forge validate` fails otherwise. It is written by the steward, in one sentence, and it names the siblings.
2. **Disambiguation is returned, not just stored.** When the top two results are within the margin **and** share an entity prefix, `forge.find` returns both cards plus a `choose` block:
   ```jsonc
   "choose": "voucher.get returns one voucher by document number. voucher.search finds vouchers by supplier, date or amount when you do not know the number."
   ```
   One extra line of context resolves a whole class of ambiguity that no amount of ranking would.
3. **The resident definition inherits it.** The generated description for a tool with siblings ends with a compressed form of the disambiguation, so an agent working from a resident list has it too, without a hop.

### 5.6 The scaling invariant, and why it holds by construction

Phase 1's hardest requirement: **TTFC must be effectively O(1) in catalogue size** — adding a module server must not raise TTFC for an unrelated existing role by more than 5%.

```
TTFC = C_init  +  C_meta  +  C_role  +  k · C_card  +  C_describe
        ~150      ~440       ≤1300      5 × 54         ≤600
```

Every term is independent of catalogue size N:

- `C_init` — protocol handshake. Fixed.
- `C_meta` — four meta-tools. Fixed, forever, at any catalogue size.
- `C_role` — the resident set is the *role's* core tools, capped by the CI-enforced role budget. A role's budget does not change when an unrelated module server is added. **This is the term that would break the invariant in a naive design, and the role budget is what pins it.**
- `k · C_card` — `forge.find` returns at most `limit` (default 5) cards of ≤60 tokens each. Fixed by the limit, not by how many candidates were considered.
- `C_describe` — one tool's full definition. Fixed.

The only catalogue-size-dependent quantity is the **server-side work inside `forge.find`** — the number of index entries scanned. That is latency, not tokens: sub-millisecond at 150 entries, a few milliseconds at 10,000. **Catalogue growth costs the server time, never the agent context.** That is the whole trick, and it is why the mechanism had to be server-side anyway.

**The one honest caveat:** the invariant holds *for roles whose core set does not change*. If a new module server is added **to an existing role's core set**, that role's TTFC rises — correctly, because the role genuinely got bigger. The checkpoint measures the invariant on **unrelated** roles, exactly as Phase 1 specified, and the role budget bounds the related case.

### 5.7 The arithmetic — do the targets hold?

Pinned tokenizer (`cl100k_base`, version-locked in `core/shared/tokens.ts`); the absolute values matter less than reproducibility, and CI compares like with like.

**Case A — session opened in a known process role (target: TTFC ≤ 2,000).**

| Item | Tokens |
|---|---|
| `initialize` + server info | ~150 |
| `tools/list`: 4 meta-tools | ~440 |
| `tools/list`: P2P core set (6 tools, budget-capped) | ≤1,300 |
| **Agent emits the correct call directly** | — |
| **TTFC** | **~1,890** ✔ under 2,000 |

If the needed tool is *not* in the core set, add one `forge.find` (query ~40 out, 5 cards ~330 in) → ~2,260. That case is over the 2,000 line, and it is the reason the role budget exists and the reason `coreTools` selection is a real design decision the steward makes, not an afterthought. **CI reports TTFC separately for core-hit and core-miss intents**, and the ≤2,000 gate applies to the core-hit case, which is the case the target was written for.

**Case B — cold session, no role hint, full 150-tool catalogue (target: TTFC ≤ 4,000).**

| Item | Tokens |
|---|---|
| `initialize` + server info | ~150 |
| `tools/list`: 4 meta-tools only (no role → no resident set) | ~440 |
| `forge.find` call + 5 cards + guidance | ~370 |
| `forge.describe` for the chosen tool | ~500 |
| **Agent emits the correct call** | — |
| **TTFC** | **~1,460** ✔ comfortably under 4,000 |

Cold is *cheaper* than warm, which is the correct shape: an agent that knows nothing pays for exactly what it looks up.

**Naive baseline for comparison** (Phase 1 G5 @ M3 asks for tokens per successful action versus naive): 150 full definitions at ~200 tokens = **~30,000 tokens** before the first useful token. Against ~1,460–1,890, that is **5–6% of naive** — against Phase 1's published target of ≤25%. The headroom is real and should be reported honestly rather than banked.

**The other three metrics:**
- **VTC** — resident definitions: 4 meta + ≤12 core = **≤16 default**, hard cap 30 (§5.10). Well inside Phase 1's ≤30/40.
- **DH** — median **2** (one `find`, one call) for cold; **1** for a core-set hit; **3** at p95 (`find` → `describe` → call, or `find` → `activate` → call). Meets median ≤2, p95 ≤3.
- **MTB** — card 54, resident definition 150–200, describe ≤600, role budget ≤1,300. All enforced at codegen.

### 5.8 Caching, and behaving well with any client

Every `tools/list` response carries:
```jsonc
"_meta": { "ttlMs": 900000, "cacheScope": "session",
           "catalogueVersion": "bundle:1.4.2+probe:9f2c+flags:0007+activation:p2p" }
```
`catalogueVersion` is a composite ETag over bundle version, probe report hash, runtime-flag generation and current activation. A client that caches gets a stable list for 15 minutes; a client that revalidates can compare one string.

`notifications/tools/list_changed` is emitted on: activation change, probe status change, kill-switch flip, bundle deploy, and role-grant change. This is what makes `forge.activate` feel instantaneous on clients that support it.

**Degradation ladder — the design works at every rung, which is what "any MCP client" has to mean:**

| Client capability | What the agent does | Cost |
|---|---|---|
| Full baseline (list_changed honoured) | `find` → `activate` → re-list → direct call | Best: schemas client-side, DH 2–3 |
| No `list_changed` handling | `find` → `describe` → `forge.invoke` | Same tokens, same governance, no client-side schema validation |
| Caches aggressively, re-lists rarely | Meta-tools are stable, so cached lists stay valid; `find`/`invoke` always work | Unaffected |
| Ignores everything, calls one tool | `forge.find` alone answers "what can I do here?" | Still useful |

**No rung requires a Claude-specific behaviour, and no rung fails.**

### 5.9 The benchmark suite

**Location and ownership.** `evals/<server>/intents.yaml`, authored by the **module steward, not the tool's builder** (Phase 1's rule, and it is the rule that makes the numbers mean anything).

```yaml
- intent: "Book the invoice we just got from ACME against PO 451"
  expect: jde.ap.voucher.create
  category: direct
  role: p2p
  cold: false
  author: <steward>
- intent: "Show me that voucher again, number 12345"
  expect: jde.ap.voucher.get
  category: near_miss           # pairs with voucher.search
  role: p2p
- intent: "Adjust this employee's payroll deduction"
  expect: none
  category: negative
  role: p2p
- intent: "Approve the PO I just raised"
  expect: jde.scm.purchase_order.approve
  category: sod_negative        # correct answer is a refusal, not a different tool
  role: p2p
```

**Composition, per Phase 1 plus the write dimension from the §10 correction:** ≥10 intents per module server; ≥20% `near_miss`; ≥10% `negative`; and — new — **≥30% of positive intents must resolve to a write tool** in any wave whose slice contains writes, plus at least one `sod_negative` per role that has an SoD pair.

**Two run modes, and this is a real design decision:**

- **Rank-1 mode (CI, every merge).** Deterministic, no model in the loop, free. SA@1 = the fraction of intents where the correct tool is `forge.find`'s rank-1 result (and where `no_tool` is returned for negatives). Token metrics computed analytically from the actual response payloads with the pinned tokenizer. **This is the gate.** It is deterministic, so a regression is unambiguous.
- **Agent mode (wave boundaries only).** A real model, through a real MCP client, against the mock gateway; measures what an agent actually does, including whether it uses `activate` well and whether it recovers from a wrong first guess. Non-deterministic and costs money, so it runs at checkpoints, not on every merge. Reported as a range over N runs, never as a single number.

**Harness.** Runs against a **mock gateway** with the real index, the real scoping code and recorded target responses — no live Oracle instance needed, so it runs on every merge from Wave 0 onward. `forge bench --json` emits all five metrics plus per-category breakdowns; CI fails the build on regression in any one of them.

### 5.10 The one Phase 1 number this document changes, with its reason

Phase 1's rule: a later phase may argue a number up or down **with a written reason recorded at the next checkpoint**. Exactly one is changed.

> **VTC: tightened from "≤30 default, hard cap 40" to "≤16 default, hard cap 30."**
>
> **Reason:** VTC and TTFC are in direct tension and Phase 1 set them independently. Thirty resident definitions at a realistic 200 tokens each is ~6,000 tokens — three times the role-scoped TTFC target of 2,000. The two numbers cannot both be met at 30 resident tools. Since TTFC is the metric that reflects what an agent actually pays, VTC is the one that moves. 16 resident definitions (4 meta + ≤12 role core) fits the 2,000-token target with headroom, and remains far below the 40–60 selection-degradation threshold that motivated the cap in the first place. The hard cap of 30 preserves an escape hatch for a genuinely large role, at the cost of that role missing the TTFC target — which the checkpoint will see, because CI reports TTFC per role.

No other Phase 1 number is altered. TTFC, DH, SA@1 and MTB are met as written.

---

## 6. Slice / package architecture, technically

Phase 1's Decision Gate D1 needs proof **P1: two slices deployed from one base, with a build-artefact diff showing only overlay configuration differs — zero core divergence, zero manifest divergence, zero fork.** This section defines what that means at the code, repo and deployment level, and how the proof is produced mechanically rather than argued.

### 6.1 A package is a selection, not a build

```yaml
# packages/jde-fin.yaml
apiVersion: mcpforge/v1
kind: Package
id: jde-fin
label: JD Edwards Financials
blurb: The reference slice. GL and AP, plus Procurement, because Procure-to-Pay reaches across into it.
servers: [jde-fin-gl, jde-fin-ap, jde-scm-po]
roles:   [p2p]
portal:  optional          # full | optional | none  -> headless capability, not a commercial statement
```

That is the entire definition. It contains **no code, no manifests, no schemas, no transformation** — only a list of server ids and role ids that already exist in the base. Adding a package adds one file. Adding a customer adds one overlay directory. Neither touches `core/`, `manifests/` or `generated/`.

### 6.2 Three artefacts, and the boundary between them

| Artefact | Contents | Varies by deployment? |
|---|---|---|
| **`mcpforge-core:<version>`** — an OCI image | Gateway, registry, codegen runtime, CLI, portal, adapters, the Python Oracle worker. **No manifests, no catalogue.** | **No — byte-identical everywhere.** |
| **`mcpforge-catalogue:<package>@<version>`** — a signed OCI artefact | The selected manifests, their generated artefacts, the compiled role scopes, the discovery index for that selection | Yes, by *selection only* |
| **`overlays/<deployment>/`** — config, mounted at runtime | Identity provider, endpoints, credential references, caps, retention, target-identity mappings, branding | Yes |

**The invariant that makes the no-fork claim testable:**

> A file present in two different catalogue artefacts is **byte-identical** in both, and identical to the same file in the full catalogue. The packaging step performs **selection and nothing else** — no templating, no substitution, no per-customer transformation.

`forge package <id>` therefore does exactly three things: resolve the package's server list to its manifests and generated artefacts; copy them unchanged; build the discovery index over just that selection (the index is a derived file whose inputs are all in the selection, so it is deterministic per selection).

### 6.3 What an overlay may and may not contain — CI-enforced

An overlay may contain: `config.yaml` (schema-validated), `mappings/*.yaml`, `branding/*` (images, a token file), `secrets.ref` (references to a secret store; never secret values). It may only **set values that the base schema declares**.

> **EXTENDED by §11.5 — Phase 5, 27 Aug 2026.** The store itself, the `secretRef://` format, rotation policy, blast-radius scoping and the emergency-revocation path are designed in §11.5. `overlay-purity` gains a **content** check, not only a file-type check.

An overlay may **not** contain: any `.ts`, `.js`, `.py`, `.sql` or `.yaml` file matching `kind: Tool | Server | Role | Package`. A CI job (`overlay-purity`) fails the build on any such file. This is the mechanical form of "customer specifics are overlay config, never a fork."

**Where a customer genuinely needs a bespoke tool**, it does not go in the overlay and it does not go in `core/`. It goes in a **separate customer manifest repository**, consumed at package time as a second manifest root:
```
forge package jde-fin --extra-manifests ../customer-acme-manifests
```
That produces `mcpforge-catalogue:jde-fin-acme`, which contains base manifests (byte-identical to base) plus the customer's own. The core image is still untouched, the base manifests are still unforked, and the customer's additions are versioned and reviewable in their own repo. **No branch of MCPForge is ever created for a customer.**

### 6.4 The P1 proof, produced by a CI job

`forge slice-diff <packageA> <packageB> --json` (CI job `slice-diff-proof`) emits:

1. **Core digest equality** — `mcpforge-core` image digest for deployment A == digest for deployment B. A single hash comparison, and the strongest form the proof can take: identical bytes, not "equivalent."
2. **Manifest hash table** — every file in A's catalogue artefact and every file in B's, with sha256. Assertion: every file id present in both has an identical hash, and every file's hash matches the same file's hash in the full catalogue.
3. **The difference, characterised** — the set difference between A and B must be **exactly** the set difference of their package server lists, expanded to files. Any file in the difference that is not explained by the server-list difference is a proof failure.
4. **Overlay diff** — a field-level diff of the two overlays, which is expected to be non-empty. That is the whole point: *this* is where deployments differ, and nowhere else.

Output is a short markdown report committed as the wave's evidence. When D1 convenes, P1 is a report with hashes in it rather than a claim.

### 6.5 Headless mode (P4, pulled forward to Wave 1 — and cheap enough to run from Wave 0)

`MCPFORGE_MODE=headless` starts the gateway without the portal. **Same image, one environment variable.** Because the portal is a separate Next.js app inside the image rather than a coupled component, this is a process-start decision, not a build variant.

The full contract-test suite runs in **both** modes in CI from Wave 0 onward. It costs one extra CI matrix entry and it means P4 is proven long before D1 needs it — which is worth doing precisely because D1 sub-question 2 ("does a slice ship with the portal?") cannot be priced if the product cannot be shipped that way.

**Phase 3 constraint that follows (R8):** the portal must read the gateway's data through the same HTTP/API surface an external client would, never through in-process access to gateway internals. If the portal can only work by reaching inside the gateway, headless mode is a fiction.

### 6.6 Deployment topology

```
                     +-------------------------------------------+
   MCP clients  -->  |  Load balancer / ingress (TLS)            |
                     +-------------------------------------------+
                                    |
                     +-------------------------------------------+
                     |  mcpforge-core  (N replicas, stateless)   |
                     |   - gateway (MCP endpoint, policy, audit) |
                     |   - Mode A module bundles                 |
                     |   - portal (unless headless)              |
                     +-------------------------------------------+
                        |            |                 |
             +----------+       +----+------+     +----+----------------+
             | SQLite   |       | Oracle    |     | Mode B module procs |
             | audit,   |       | Adapter   |     |  - wrapped-vendor   |
             | sessions,|       | Worker    |     |    MCP servers      |
             | nonces,  |       | (Python)  |     +---------------------+
             | probe    |       +-----------+
             | (W0;     |
             |  Postgres|
             |  at OCI) |
             +----------+             |
                                 SQL*Net / ORDS
                                      |
                          Oracle applications (EBS, JDE, ...)
```

Catalogue artefact is mounted read-only into the core container at start. A catalogue upgrade is a new artefact + a restart (or a hot reload of the bundle registry — implementable, but not Wave 0 scope). Secrets come from the platform's secret store, referenced by the overlay, never in an image or a repo.

> **EXTENDED by §11.5 — Phase 5, 27 Aug 2026.** The store itself, the `secretRef://` format, rotation policy, blast-radius scoping and the emergency-revocation path are designed in §11.5. `overlay-purity` gains a **content** check, not only a file-type check.

---

## 7. Cross-cutting: environments, testing, CI

### 7.1 Environments

| Env | Targets | Purpose |
|---|---|---|
| **dev** (local, Windows + WSL2/Docker) | Mocks only | Codegen, unit, contract, benchmark. **No live Oracle needed** — this is what makes the autonomous build lane viable, and it follows directly from the 70/30 split. |
| **probe** | A real non-production Oracle instance | The capability probe, `commitsInternally` classification, identity `whoami` verification, validate-pair checks. **All destructive classification happens here, never in production.** |
| **staging** | Non-production instances | Full write path including live dry-run, confirm, execute, reverse |
| **prod** | Production instances | Live. Probe runs in read-only mode only. |

### 7.2 The CI pipeline — stages and fail conditions

| # | Stage | Fails on |
|---|---|---|
| 1 | Lint + typecheck | any error; `no-service-account-fallback` lint rule (§4.4) |
| 2 | `forge validate` | any manifest/role/package schema or policy rule (~40 rules) |
| 3 | `forge codegen && git diff --exit-code generated/` | any drift — this is G1 |
| 4 | Custom-binding contract check | `CUSTOM_BINDING_CONTRACT_DRIFT` |
| 5 | `overlay-purity` | code or manifests found in any overlay |
| 6 | Unit tests | any failure |
| 7 | Contract tests (mock targets), **both modes** (full + headless) | any failure |
| 8 | Policy / privilege-escalation suite | any escalation attempt that does **not** fail closed |
| 9 | Token-budget gate (MTB) | card >60, resident definition >400, describe >600, role budget >1,300 |
| 10 | Discovery benchmark, rank-1 mode | regression in TTFC, VTC, DH, SA@1, or MTB against the recorded baseline |
| 11 | `slice-diff-proof` | any unexplained file difference between two slices, or core digest mismatch |
| 12 | Probe regression (deploy pipeline only) | a previously `resolved` tool now unresolved without a recorded reason |
| 13 | Package + sign + publish | — |

Stages 3, 8, 9, 10 and 11 are the ones that make Phase 1's goals into gates rather than intentions. **None of them may be marked "allowed to fail."**

### 7.3 Testing tiers

- **Unit** — generated per tool from the schema; boundary cases, type coercion, enum rejection, guardrail thresholds.
- **Contract** — generated per tool against recorded target responses: happy path, every declared error, dry-run shape, confirm-token binding, argument-mismatch refusal, idempotent replay, and for write tools the full reversal round trip.
- **Policy** — hand-written, per binding type, in the privilege-escalation suite: attempt to reach data the caller cannot reach natively; attempt a direct APPS-package call; attempt raw DML through a database binding; attempt to widen a vendor scope; attempt to call an unlisted tool through `forge.invoke`; attempt to confirm a plan with altered arguments. Every one must fail closed.
- **Discovery benchmark** — §5.9.
- **Portal E2E** — Playwright, Phase 3 will extend.
- **Probe** — the only tier that needs a real instance.

Everything except the last two runs offline on a laptop. That is deliberate: it is what lets the autonomous build lane iterate without waiting on an Oracle environment.

---

## 8. What Phases 3 and 4 need from this document

### 8.1 Phase 3 (UX) — what the portal must be able to render and do

Design constraints this architecture imposes, none of which are style choices:

1. **The portal writes to git, not to a database.** Every definitional change — a new tool, a role edit, a package, an approval — is a **branch + commit + pull request** through the git host's API. The portal shows PR state; it does not own the data. Runtime state (audit, probe results, approval queue state, consumption) is read from Postgres. Phase 3 should design for this split explicitly, because it changes what "Save" means on every screen.
2. **The write path needs first-class UX in Wave 0** (this is the §10 correction's biggest UX consequence): a **plan review** view rendering `plan`, `effects`, `warnings` and the reversal contract; an **approval queue** for `humanApprovalRequired` tools with a named approver, showing the exact plan hash being approved; and a **reversal action** on a completed call, driven from `result_keys`.
3. **The probe report is a primary screen, not a diagnostic.** Per application, per tool: status, the failing check, the owning team, the remediation text. This is the Application Enablement page made real.
4. **Role editing must show the compiled scope diff and any SoD conflict** before the PR is opened. A role editor that hides which tools a glob picks up is the exact failure this architecture is designed to prevent.
5. **The slice/package view must present the mechanism without implying a commercial answer** while D1 is open — the concept console's existing wording is the right precedent.
6. **A benchmark/metrics view** — TTFC, VTC, DH, SA@1, MTB per wave, with the per-role TTFC breakdown, because §5.10's tightened VTC makes per-role reporting the thing that matters.
7. **Headless separability (R8):** the portal talks to the gateway only over its API. No in-process coupling, ever.

### 8.2 Phase 4 (autonomy, model routing, task backlog) — what is now decidable

Everything below is settled enough to become tasks without further architectural judgment:

- **The `forge` CLI surface** is the automation seam. PowerShell drives: `forge new tool · validate · codegen [--accept-contract] · test · bench [--json] · probe · package · slice-diff · kill · audit verify · audit reverse · identity remap`. All support `--json`.
- **Wave 0 build order is implied by this document** and should be sequenced roughly: manifest schema + `forge validate` → codegen + the three-file split → gateway skeleton + local identity provider → policy chain → audit store → the four discovery meta-tools + index → the `function` binding executor → the write-safety machinery (**before** tool volume, per §10.5) → the probe → the three module bundles' 11 tools → the benchmark harness → the portal.
- **The ~80% no-hand-written-code target** (§2.1) is the concrete autonomy lever: the tasks that need a human are manifest authoring judgment, steward intents, validate-pair orchestrations, and approvals — everything else should be autonomous.
- **Named human decision points inside Wave 0:** the four stack unknowns (§1.6); the R4 server-density call; who owns the six validate-pair orchestrations; the score-floor calibration sign-off; and each tool's governance approval.
- **The intervention log** (checkpoint agenda item 6) should categorise by which of these seams failed — that is the fastest route to spec improvements.
- **Still Phase 4's, unchanged:** R10 (deck reconciliation, which now also needs the SoD answer in §4.3 and the latency budget in §4.8 — two of the external review's open comments are now answerable), R14 (schedule; do not invent dates), the R3 memory-correction task, and the consolidated `MEMORY.md` index update.

---

## 9. Judgment calls the user should sanity-check

Nine things where I made a call that is defensible but is genuinely a call, not a deduction. Each names what changes if the user disagrees.

1. **TypeScript/Node core with a Python worker only for Oracle DB/PL-SQL work.** *If ARIA/MORPHED/DEXA set a different house pattern, say so and this is revised — alignment beats my preference.* Changing the core language changes §1.4 and most of §2; changing only the worker boundary changes very little, which is itself an argument for this shape.
2. **`database` bindings are read-only by policy; writes go through PL/SQL.** Removes a real risk class at essentially no capability cost. Reversible if a genuine need appears, but it should be a governance exception, not a default.
3. **`generated/` is committed to git.** Buys reviewable blast radius, costs repo noise. The alternative (generate in CI, commit only a lock file) is cleaner to look at and worse to govern.
4. **Postgres for the runtime store.** **SUPERSEDED for Wave 0 by §10 — SQLite locally, Postgres (or Oracle) later, behind Drizzle.** The original note read: *An Oracle-shop reflex will be "use Oracle." §1.5 keeps that possible; building it now would be premature.* That still holds for the eventual deployment.
5. **VTC tightened to 16 default / 30 hard** (§5.10). This is the one Phase 1 number changed, with its written reason. Worth a sanity-check because it is the number most likely to be quoted externally.
6. **Wave 0 ships lexical search only; embeddings are a Wave 1 conditional.** If SA@1 comes in below 90% at Wave 1, the embedding channel switches on. Deliberately staged rather than built up front.
7. **`forge.invoke` exists as a universal fallback.** It is what makes "any MCP client" true, and it slightly weakens client-side schema validation. The gateway compensates server-side. If the user would rather require `list_changed`-capable clients, this tool can be dropped — but the "works with any client" claim goes with it.
8. **Module servers default to in-process bundles with a stated promotion rule** (§4.1), rather than 42 processes. Preserves every property of the module boundary decision without the operations bill. If someone reads "independently deployable" as strictly "its own process," this needs re-litigating — but the promotion rule means it can be, per bundle, whenever it needs to be.
9. **Server-density recommendation** (§4.7): top up GL and AR, merge Inventory into Procurement. This is R4 and the decision is explicitly the user's; I have only stated the rule and a recommendation.

**And one thing worth flagging that is not a judgment call but a consequence:** the Wave 0 write-parity correction adds a hard app-side dependency — **six validate-pair JDE orchestrations, authored by a named steward, in week one.** If nobody is named for that, Wave 0's dry-run quality degrades to precondition reads and half its write tools end up requiring human approval for every call. It is the most likely quiet failure in this plan.

---

*MCPForge · BlueVerse ValueMesh · LTM Oracle AI Practice. Phase 2 of 4 — technical architecture. Companion to `01_GOALS_AND_ROADMAP.md`; supersedes nothing in it except where its new §10 says so.*

---

---

## 10. Correction applied by Phase 4, per user direction, 27 Aug 2026 — runtime datastore, git host, runtime target

**Status: this section supersedes §1.5, the persistence and tests rows of §1.2, §1.6 items 1, 2 and 4, and §9 judgment call 4, for Wave 0 and for all local development. Nothing else in this document changes. The superseded text is deliberately left in place above, with inline markers, so that the change of direction is visible rather than silent — the same pattern Phase 2 used on Phase 1's §10.**

### 10.1 What the user decided

Three decisions, given as decisions before Phase 4 started, applied here rather than re-derived:

1. **Git host: host-agnostic for Wave 0.** Local git only. No GitHub / GitLab / Azure DevOps assumption is baked in. The PR-based manifest workflow of §2.5 and §4.6 must work against a bare local repository first; hosted-platform integration is deferred. Phase 3 §11.3 already designed the portal vocabulary for this ("change / propose / review", never "GitHub pull request", and a visible *"local only — no remote configured"* state). **Implementation consequence:** the portal and the `forge` CLI reach git through a `ChangeHost` interface with two implementations — `LocalGit` (branch + commit + a review record committed under `approvals/`) and, later, `HostedGit` (branch + commit + a real PR through the host's API). Nothing above that interface knows which is in use, exactly as `IdentityProvider` (§4.4) works for identity.
2. **Runtime target: local-first for Wave 0; OCI is the eventual production target.** Everything in Wave 0 must build, test, run, probe and demo entirely on one developer machine. Docker is permitted and expected; **no cloud account, no OCI service, and no managed database may be a prerequisite for Wave 0 to be buildable or demoable.** OCI is where this eventually deploys, and the container-first shape of §6.6 is what keeps that cheap — but it is not a Wave 0 dependency.
3. **Runtime datastore: SQLite for Wave 0 and local development, not PostgreSQL.** Specified in full below.

### 10.2 The replacement for §1.5

> **Runtime state for Wave 0 and for all local development lives in SQLite** — one file, `./.mcpforge/runtime.db`, opened in WAL mode — reached **only** through the repository interface §1.5 already required (`core/gateway/store/*.ts`), implemented over **Drizzle ORM** with the SQLite and PostgreSQL dialects generated from **one schema definition**. Moving to Postgres for a real multi-user OCI deployment — or to Oracle Database, if a customer-hosted engagement requires it — is a **driver, connection-string and migration-set change, not a rewrite.**

**Why Drizzle rather than Prisma or hand-rolled SQL.** All three would satisfy "an abstraction." Drizzle is chosen on four grounds specific to this codebase:

- **One schema, two dialect outputs.** `drizzle-kit` generates a migration set per dialect from the same TypeScript schema file. The alternative — writing the DDL twice — is exactly the drift Phase 2 §1.2 rejected for the manifest type model, and the argument is the same argument.
- **It is SQL-shaped, not SQL-hiding.** §4.6's audit design is deliberately close to ANSI SQL, and §1.5 required Postgres-specific features to be isolated behind the interface. Drizzle's query builder keeps the SQL legible in review, which matters because the audit path is a governance surface, not just a data-access layer. Prisma's generated client would put a translation layer between a reviewer and the statement that writes the audit row.
- **No separate engine process, no code-generation step at runtime, and it works from a plain `pnpm install`** — which is what keeps "everything reproducible from a clean clone" (§1.4) true on a laptop with no Docker running.
- **The autonomous build lane handles it well.** Drizzle's schema files are ordinary TypeScript with no DSL file format to get subtly wrong, which is the same reasoning Phase 3 §3.2 item 4 used for shadcn/ui.

`better-sqlite3` is the SQLite driver (synchronous, fastest in-process option, no async overhead on a path that is already sub-millisecond); `pg` is the Postgres driver. Both sit under the repository interface; **no application code imports either directly**, and that is enforced by an ESLint `no-restricted-imports` rule alongside the `no-service-account-fallback` rule of §4.4.

### 10.3 The git / datastore split — reconfirmed, and it is *cleaner* under SQLite

The split §1.5 stated is unchanged and now matters more:

> **Definitions live in git. Events live in the runtime store.** Manifests, roles, packages, generated artefacts, overlays, eval intents and approval records are git. Sessions, the audit trail, the approval queue's runtime state, idempotency and nonce records, probe results and consumption edges are SQLite.

Two things make this hold better with SQLite than it did with Postgres, and one thing makes it need saying more loudly:

- **Better:** a local SQLite file is obviously ephemeral in a way a running Postgres container is not, which makes the boundary self-evident to a developer rather than a documented convention. `rm -rf .mcpforge/` must leave a working, complete, redeployable system — and that is now a *testable Wave 0 property*, added to the backlog as task `W0-C6`. It is the single sharpest test that no definitional data leaked into the runtime store.
- **Better:** the entire Wave 0 stack starts with `pnpm install && forge codegen && forge dev` and no container at all. That is what makes the autonomous build lane fast, and it follows directly from the 70/30 split (§7.1).
- **Needs saying more loudly:** because the file *is* ephemeral, **the audit trail is genuinely at risk on a clean checkout in a way a managed database is not.** Phase 3 §11.2 already designed the data-class chip and its tooltip for exactly this, and its empty-state note (*"this local instance stores audit records in SQLite; they start empty on a fresh checkout"*) is now a required Wave 0 deliverable rather than a nicety.

### 10.4 What Phase 2 assumed that SQLite cannot do — eight items, named, none silently dropped

This is the part the user specifically asked for. Each item states the assumption, where it is, what SQLite actually does, the Wave 0 disposition, and when it closes.

**1. Privilege-revoked immutability of the audit trail — the one genuine loss.**
*§4.6 says: "The application role holds `INSERT` and `SELECT` only; `UPDATE`/`DELETE` are revoked at the database."*
**SQLite has no users, no roles and no `GRANT` at all.** There is nothing to revoke. Wave 0 disposition, three layers:
  - (a) `BEFORE UPDATE` and `BEFORE DELETE` triggers on `audit_call` that `RAISE(ABORT, 'audit_call is append-only')`, with the retention job as the single, separately-audited exception path;
  - (b) the `prev_hash` / `row_hash` chain §4.6 already specifies, verified by `forge audit verify`;
  - (c) OS file permissions on `.mcpforge/runtime.db`.
**State this honestly and do not dress it up: on SQLite, audit immutability is *detectable*, not *preventable*.** Anyone with the file can open a `sqlite3` shell, drop the triggers and rewrite a row — the hash chain will then fail verification, which is the point of layer (b), but the write itself is not prevented. It becomes preventable again the moment the store is Postgres (or Oracle) with a real grant model.
**Consequences that follow, and they are real:** `forge audit verify` is **load-bearing at Wave 0, not a nicety** — it runs in CI, on every probe run, and on portal load of the Activity → Integrity panel (Phase 3 §5.3), all of which are therefore Wave 0 deliverables; and the Wave 0 checkpoint must record this as a **known, accepted, waived limitation with a named closure trigger (the Postgres migration)**, not pass exit criterion 7's "immutable audit record" silently.

**2. GIN index on `result_keys` for the business-key query.**
*§4.6 query 2 — "who created document 12345" — is designed around a GIN index over a `jsonb` column.*
SQLite has neither `jsonb` nor GIN. **Wave 0 disposition:** `result_keys` is *additionally* normalised into an `audit_result_key(call_id, key_name, key_value)` side table, written in the same transaction as the audit row, with a composite index on `(key_value, key_name)`. Same one-hop answer, portable to both engines. **This is arguably the better schema on Postgres too** — keep it after migration rather than reverting to GIN, because it makes the business-key search a plain indexed lookup on both.

**3. Array columns (`caller_roles[]`).**
*§4.6's shape uses a Postgres array type.*
SQLite has no array type. **Wave 0 disposition:** a JSON text column for display plus an `audit_call_role(call_id, role_id)` side table where membership queries are actually needed. Drizzle models both dialects identically. No behaviour lost.

**4. `gen_random_uuid()`.**
Trivial, listed for completeness. Ids are generated **in the application as UUIDv7** (time-ordered, which also gives index locality that `gen_random_uuid()` does not). No database function dependency on either engine.

**5. `jsonb` containment / path operators on `args_redacted`.**
None of the queries §4.6 actually designs need containment or path operators; SQLite's JSON1 (`json_extract`) covers every read path in use. Low risk. **Rule for the build lane:** any new query that would need a `jsonb` operator must instead add a normalised side table, as in item 2 — that keeps the two dialects at parity by construction rather than by luck.

**6. Horizontal scale-out of the gateway with shared nonce and session state — a claim that does not hold at Wave 0.**
*§4.8 states: "Run N replicas behind a load balancer. Plan tokens work across replicas because they are HMAC-signed and their nonces live in the shared database."*
**SQLite is a single-writer, single-host store, so that is a Postgres-era claim and it must not be quoted as a Wave 0 property.** Wave 0 disposition: **the gateway runs as one instance.** This is correct for a local-first Wave 0 regardless, and it costs nothing that Wave 0 needs. Importantly, **the security property survives even though the scaling property does not**: the confirm-token nonce remains single-use, because single-use is enforced by a `UNIQUE` constraint on the nonce column with the consuming `INSERT` inside the same transaction as the execute — which is atomic on one node. **No Wave 0 exit criterion may be written or evidenced as if multi-replica works.** Multi-replica returns with Postgres, and Wave 1's P2 proof (a slice in a second environment) is the natural place to re-test it.

**7. Concurrent writers under load.**
SQLite serialises writers. **Wave 0 disposition:** `journal_mode=WAL`, `busy_timeout=5000`, `synchronous=NORMAL`, all writes short, and the audit write already batched through the outbox pattern §4.2 step 9 specifies. At Wave 0's actual traffic — one developer, a benchmark harness, a probe run, a demo — this is not a constraint. It becomes one at CoE-instance scale, which is exactly when Postgres arrives. The latency budget in §4.8 is unaffected: `better-sqlite3` round trips are *faster* than the 8 ms Postgres round trips budgeted there, so the two database stages have more headroom at Wave 0, not less.

**8. Testcontainers-based CI for the store.**
*§1.2's tests row assumed a Postgres Testcontainer.*
**Wave 0 disposition, and this is the important one:** CI runs the store contract suite against a **temp-file SQLite by default** — fast, and with no Docker requirement, which matters because the autonomous build lane runs on a laptop — **and additionally runs the identical suite against Postgres in a second CI matrix entry.** This is precisely the discipline §4.4 already applies to the two identity providers: *both implementations are contract-tested in Wave 0 so the swap is proven, not hoped.* The datastore migration is then proven continuously from Wave 0 onward rather than attempted once, later, under time pressure. It is one extra matrix entry and it is the cheapest insurance in this document.

**Two things that look Postgres-specific and are not, so nothing needs changing:** window functions (SQLite ≥ 3.25 has them; the consumption rollups in `consumption_edge` use them) and common table expressions. Both work unchanged on both dialects.

### 10.5 Consequences elsewhere, stated so no phase has to rediscover them

- **Phase 3 is unaffected and was already correct.** §11.2's data-class chip, its `SQLite · local file` label, its ephemerality tooltip and its `runtime.store.kind` API field were written against this decision. Phase 3 §11.4's deliberate omission of presence features is also now *required* rather than merely recommended.
- **Wave 0 exit criteria (Phase 1 §7) are unchanged in wording.** Criterion 7's "immutable audit record" is satisfied at Wave 0 by trigger plus hash chain, with §10.4 item 1's limitation recorded in the Wave 0 checkpoint artefact as an accepted waiver naming its closure trigger. Criterion 3's probe-status persistence, criterion 8's approval records (git) and criterion 13's autonomy log are all unaffected.
- **§1.6 item 3 (container registry and image signing) remains open but is not a Wave 0 blocker.** The P1 slice-diff proof is a Wave 1 deliverable; at Wave 0, `forge slice-diff` compares local build outputs by file hash rather than by signed image digest, which proves the same invariant one notch weaker and is enough for Wave 0.
- **§6.6's topology box** now reads SQLite for Wave 0 with Postgres at OCI. Nothing else in the topology changes, because the store was always behind an interface.
- **Phase 4's backlog** carries the abstraction as `W0-C1`, the audit immutability triggers plus hash chain as `W0-C2`, the atomic nonce/idempotency layer as `W0-C3`, `forge audit verify` as `W0-C4`, the Postgres-dialect parity contract test as `W0-C5`, and the "delete the runtime store and everything still works" test as `W0-C6`.

*Correction applied by Phase 4, per user direction, 27 Aug 2026.*

---

## 11. Correction applied by Phase 5, per user direction, 27 Aug 2026 — consumer registration, binding-type authorization, usage governance and credentials

**Status: this section extends nine locations marked above — §3.3 (twice), §4.2, §4.4, §4.5, §4.6 (twice), §4.7, §6.3 and §6.6 — rather than reversing any of them. Superseded/extended text is left in place with inline markers pointing here. This is the section the build lane implements from; it carries full technical detail, unlike 01 §11.**

### 11.1 What the user asked, and what was already covered

> *"there should be an agent registration/securing agent interaction with MCPforge and proper governance and usage tracking should be there. Like let's say, some tools like PLSQL package based may be opened, but shouldn't be used as open.. access control and protocols should be handled. Likewise application login details."*

| Sub-thread | Already covered by | The gap |
|---|---|---|
| 1. Agent/consumer registration | §4.4 (`IdentityProvider` → `Principal`, human auth), §4.3 (role scope), §4.8 (egress-only "only door"), §4.6 (`consumption_edge`) | Every ingress control authenticates the **human**. Nothing authenticates or authorises the **software holding the session**. `consumption_edge` has no authenticated source. DCR was undecided. Exit criterion 5 evidences egress only. |
| 2. Governance/usage tracking | §4.6 (audit), §3.1.3/§4.7 (per-human-per-tool rate limits), 01 G4 @ M2 | G4 @ M2's anomaly monitoring has no design anywhere. All rate/quota controls are keyed `(human, tool)`, nothing bounds a consumer **across** tools or observes behaviour as a pattern. |
| 3. Binding-type-aware authorization | `bindingType` drives the handshake (§3.2–§3.6), the review path (validate rules), the sandbox harness, and `database` read-only-by-policy (§3.3) | All four gates are keyed on the *definition* or on sensitivity/scope, never on binding type **at call time**. Once a `plsql`/`function` tool is in scope, it executes exactly as easily as a REST read — "opened, and therefore open." |
| 4. Application credentials/secrets | §6.3, §6.6 (two sentences: overlays hold references, secrets come from a platform store) | No design: what the store is at Wave 0, what a reference looks like, who may resolve one, rotation policy, blast-radius containment, leak response. `overlay-purity` checks file types, not content. |

### 11.2 The Consumer Registry

**The rule, quotable and load-bearing:**

> **Every call is made by a `Consumer` acting for a `Principal`. Authorization is the intersection of what the consumer may do and what the human may do — never the union, never a substitute. A registered consumer with no resolved human identity is refused `IDENTITY_UNRESOLVED`; a valid human identity presented by an unregistered consumer is refused `CONSUMER_UNREGISTERED`. There is no consumer-only path and no human-only path.**

`CallerContext = { consumer: Consumer, principal: Principal }` replaces bare `Principal` at the gateway's internal boundary. Everything that consumes `Principal` today keeps working; the new field is additive.

**The record is a git artefact, because it is a grant.** `consumers/<id>.consumer.yaml`, validated by `forge validate`, compiled by `forge codegen`, changed only through the existing change-proposal → approval → merge flow. This means registration needs **no new governance machinery** — it inherits the change model, the approvals queue, the approval record and the compiled-artefact diff discipline unchanged.

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
  bindingTypes: [rest, wrapped-vendor]      # the new gate — see §11.4
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

**`humanInTheLoop` is not documentation.** The write-safety design (§3.1.1) assumes a human reads the plan sentence before confirming. A headless autonomous agent with no human in its loop cannot satisfy that assumption, and today nothing notices. So:

> **A consumer declaring `humanInTheLoop: false` forces `humanApprovalRequired: true` on every write it attempts, regardless of the tool's own setting.** The plan is then read by a named approver in the portal instead of by nobody.

That costs nothing to implement because the `awaiting_human_approval` path (§3.1.1) already exists.

**Registration is admin-approved. Self-service registration and RFC 7591 Dynamic Client Registration are both disabled.** Every other grant in this architecture — a role, a package, a tool — is a reviewed git diff with an approval record; a self-registering client would be the only grant in the system nobody reviews, and it would decide which software may hold a session at all. Because the record is a git artefact, admin approval is **free** — it is the change-proposal flow that already exists. DCR is therefore **structurally absent**: the `registration_endpoint` does not appear in the gateway's authorization-server or protected-resource metadata, and a `POST` to it returns `403` with an agent-actionable `next` naming the portal's registration flow — **never a silent 404**, because MCP clients commonly attempt DCR and a silent failure turns a governance decision into a debugging session.

**Bootstrap.** `forge consumer new --id <id> --class <class>` scaffolds the YAML; `forge consumer issue-credential <id>` mints the credential into the local secret store and prints it exactly once. Both are refused when `CI=true` and refused when the environment class is `staging` or `prod` — there, registration goes through the portal and produces an approval record. `forge dev` self-registers a `portal-local` consumer on first boot **in environment class `local` only**, because the portal is itself a consumer of the gateway API and a fresh clone would otherwise deadlock.

**Two enforcement points, deliberately, mirroring §4.2's own precedent ("steps 4 and 6a are deliberately two independent checks of the same fact"):**
- **New step `[2a]` in the request path, between Authentication and Identity resolution: consumer authentication and registration check.** An unregistered, suspended, expired or retired consumer is refused **at `initialize`** — it never reaches identity resolution, never gets a session, and never enumerates the catalogue through `tools/list`.
- **New per-call stage `6a′`, immediately after `6a`: consumer still active and this call within its declared authorizations.** A consumer suspended mid-session stops working on its **next call**, not at its next reconnect, via the existing `runtime_flags` 5-second poll — **now a fifth granularity: tool · module server · binding type · consumer · whole deployment.** `forge kill consumer:<id> --reason "…"`.

**Wave 1 OIDC nuance.** Where an external issuer is in use (LTM AD), the presented token's `client_id`/`azp` claim **may** additionally corroborate the consumer binding — but it is never a substitute for registration: at Wave 0 the local store issues its own JWTs with no external client registry at all, and an AD-registered `client_id` is governed by whoever administers that directory, not by MCPForge's approval flow.

### 11.3 Scope resolution and audit

The five-way intersection at §4.2 step 4 becomes six-way:

```
visible(session) = Deployed(package)
                 ∩ Granted(∪ caller roles)
                 ∩ Activated(persona | default)
                 ∩ Enabled(probe status = resolved | degraded_readonly)
                 ∩ ¬KillSwitched
                 ∩ ConsumerAuthorized(consumer)          ← NEW
```

`ConsumerAuthorized` = tools whose binding type is in the consumer's `authorizations.bindingTypes`, whose `sensitivity` is at or below its `maxSensitivity`, whose `write` flag is permitted by `writeAllowed`, and which fall inside its declared `roles` and `packages`. The existing five-way intersection's "a test per predicate proving that removing any one of them widens the set" becomes six-way with six such tests.

**Two consequences:**
- **TTFC can only fall.** Consumer scoping can only *narrow* `tools/list`. §5.6's O(1)-in-catalogue-size invariant holds unchanged, and §5.7's Case A/B numbers remain upper bounds — no metric needs re-deriving.
- **A consumer can hide a tool the human legitimately holds**, and the two refusals must therefore be **distinct error codes with distinct wording**: `CONSUMER_NOT_AUTHORIZED` ("your client is not authorized for this binding type / sensitivity / write") versus `TOOL_NOT_IN_SCOPE` ("you are not granted this tool"). This is a UX requirement with a security payoff — it tells an operator whether their client registration or their role is too narrow.

**Audit.** `audit_call`'s `who` block gains `consumer_id, consumer_record_sha, consumer_auth_method, consumer_session_id, human_in_the_loop`. `consumer_record_sha` pins **which version of the consumer's authorizations was in force** for that call. **This lands inside `W0-C2`, before the first audit row exists** — a hard sequencing requirement, not advice, because `row_hash` covers row content and a schema change mid-chain is a discontinuity. This is what finally feeds `consumption_edge`: `consumer_id` **is** the "consuming agent," authenticated rather than self-declared, which is what makes G9 @ M1 evidenceable.

### 11.4 The binding-authorization stage

**Where it goes in the chain.** `6e′` — binding-type authorization — is inserted **immediately after `6e` and before `6f`**. It is a **grant check**, of the same family as `6a` and `6e`, so keeping grant checks contiguous keeps the chain's structure legible. It must sit **before `6g`** so an unauthorized binding type can never mint a plan token. **The alternative — placing it before `6c` (rate limit) so an unauthorized call does not consume rate budget — was considered and rejected**, because the chain's own precedent already puts argument validation (`6d`) ahead of the ceiling check (`6e`), and a probing consumer burning its own rate budget is arguably the correct outcome, not a cost.

#### 11.4.2 The updated chain

```
[2a] Consumer authentication and registration check   -> CONSUMER_UNREGISTERED / CONSUMER_SUSPENDED
6a   tool in resolved scope?                           -> TOOL_NOT_IN_SCOPE
6a′  consumer still active and call within its authorizations  -> CONSUMER_NOT_AUTHORIZED / CONSUMER_SUSPENDED
6b   tool enabled by probe + kill switch?              -> TOOL_DISABLED
6c   rate limit / concurrency                          -> RATE_LIMITED
6d   argument validation (compiled Ajv)                -> INPUT_INVALID
6e   sensitivity vs role ceiling                       -> POLICY_GUARDRAIL_BREACH
6e′  binding-type authorization                        -> ELEVATED_GRANT_REQUIRED
6f   guardrails incl. SoD                              -> POLICY_GUARDRAIL_BREACH
6g   write? plan-or-confirm state machine               -> PLAN_REQUIRED / PLAN_ARGUMENT_MISMATCH / APPROVAL_REQUIRED
6h   idempotency lookup                                 -> replay
```

#### The two postures

| | **Standard posture** | **Elevated posture** |
|---|---|---|
| **Which bindings** | `rest`; `database` (read-only by policy); `wrapped-vendor` where the vendor surface is read-only | **`plsql`**, **`function`**, any write-classified `wrapped-vendor` tool, and **any tool carrying a `policyException`** |
| **Grant model** | **Default-allow within the role's scope.** Being in scope *is* the grant. | **Explicit allow-list grant required.** A role (or consumer) must name the binding type in `bindingGrants`; scope membership alone is never sufficient. For `plsql` the grant additionally names the **wrapper package** (`MCPFORGE_WRAP.<PKG>`); for `function`, the orchestration family. |
| **Approval** | The tool's own `humanApprovalRequired` governs. | **`humanApprovalRequired` is forced true for every write**, overriding the tool's own default — *unless* the grant carries a `standingAuthorization` (§11.4.4). |
| **Consumer** | Any registered consumer with the binding type authorized. | Additionally requires `attestation.humanInTheLoop: true`, or the write is refused outright. |
| **Anomaly thresholds** | Detector defaults. | Burst threshold halved; off-hours calls notable by default; first use of a wrapper package is always an event. |
| **Grant lifetime** | None — it is scope. | **Grants expire** (default 180 days). Renewal is a re-approval, not a rollover. |
| **Refusal** | n/a | `ELEVATED_GRANT_REQUIRED`, with a `next` naming the grant needed and the approver who can issue it. |

`bindingGrants` lives on the role (and optionally the consumer), is compiled by `forge codegen` into the role's scope artefact alongside the tool-id list — widening a binding grant is as visible as widening a role.

#### 11.4.3 The gateway grant and the database grant, reconciled

For `plsql`, the elevated grant names the wrapper package — the same unit the database-side control already uses (§3.4's `EXECUTE` on the wrapper only). Naming the package at the gateway means the gateway's grant and the database's grant are **two independent statements of the same fact**:

> A gateway `bindingGrant` naming a wrapper package for which the database holds no `EXECUTE` grant — or a database `EXECUTE` grant with no corresponding gateway grant — is a **probe finding**, reported per tool with its owning team.

This extends §4.5's `plsql` probe checks by one line. Built in Wave 0, exercised in Wave 2, when `plsql` bindings actually land — the same seam-early discipline as `W0-C5` (Postgres parity) and `W0-D3` (dual identity providers).

#### 11.4.4 `standingAuthorization` — the pivot that makes this implementable

Without an escape hatch, the elevated posture forces per-call human approval on **all six of Wave 0's write tools**, because every Wave 0 binding is `function`.

> A role × binding-type grant may carry `standingAuthorization: <approvalRef>` — a recorded, expiring, named-approver decision that this role may execute this binding type's writes through the ordinary plan → confirm path without a per-call approval.

Properties that keep it from becoming theatre:
- It is an **approval record in `approvals/`**, committed, with a named approver — Wave 0 exit criterion 8's machinery, reused.
- It appears in the **compiled scope diff**.
- It **expires** (default 180 days); renewal is a fresh approval.
- **It removes nothing else.** Plan → confirm, guardrails, SoD, and the identity requirement all still run.

**The gate is on by default, and turning it off is itself a governed, recorded, expiring act.** Two named failure modes for the build lane: implement the elevated posture and forget the standing authorization, and Wave 0 looks broken; implement the standing authorization and forget that it must be recorded and expire, and the gate is decoration.

#### 11.4.5 The discovery consequence

An agent should learn it lacks a grant **before** constructing arguments ("no dead ends," 01 G5, W0 exit criterion 11). **No field is added to the tool card** — it is budget-measured at 54 tokens against a ≤60 ceiling (§5.3) with almost no headroom. Instead, reuse the resolution §4.5 already reached for disabled tools:

> A tool the session lacks the elevated grant for is **excluded from `tools/list`** — it falls out of the six-way intersection automatically — but remains **findable through `forge.find`**, which returns its card with a per-result `access: "requires_grant"` and an `agentMessage` naming the grant and the owning approver.

The `access` field rides on the **find response**, costing ≤6 tokens per result — about 25 tokens on a five-result find. Immaterial against a cold TTFC of ~1,460 versus a 4,000 budget, but **must be accounted for deliberately in the MTB gate (`W0-G5`)** rather than discovered as a budget failure.

#### 11.4.6 `forge.invoke` — the sharpest test

`forge.invoke` executes any tool the caller is granted through the identical policy chain, and `W0-E8`'s privilege-escalation suite already tests calling an *unlisted* tool through it. Extended with the literal statement of the user's concern:

> Call an elevated-binding tool for which the session holds **no** elevated grant, through **both** entry points — a direct `tools/call` and `forge.invoke` — and both must refuse with `ELEVATED_GRANT_REQUIRED`.

#### 11.4.7 Reconciling with "`database` bindings are read-only by policy"

> **The elevated-grant concept sits *alongside* the read-only rule. It does not subsume it, and it extends it in exactly one place.**

Three reasons: **(1)** different times, different failure modes — the read-only rule is validate-time structural (`W0-B3`); the binding-authorization stage is runtime authorization; they do not overlap. **(2)** they answer different questions — the read-only rule removes an entire capability class because the estate loses nothing (every Oracle application that writes does so through an API package); `plsql` cannot be removed the same way because the estate genuinely needs PL/SQL writes, so the elevated posture is, for `plsql`/`function`, what "read-only by policy" is for `database`. **(3)** `database` therefore stays standard posture — it is already the most caged binding of the five by construction (no dynamic SQL, statement loaded by hash, bound parameters, a mandatory row cap enforced twice, a read-only transaction, Resource Manager caps); layering a grant model over a binding with no write path is ceremony this plan does not do.

**The one extension:** any tool carrying a `policyException` (§3.3's exception path) is elevated posture, regardless of its binding type — the only write path that escapes the read-only rule is also the one that cannot execute without a named, expiring, approval-recorded grant.

### 11.5 Credentials and secrets

`SecretStore` is the third instance of the pluggable-seam pattern already established twice (`IdentityProvider` §4.4, `ChangeHost` §10.1):

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

**Implementations, and what is built when.** **Wave 0 default — `EncryptedFileStore`:** an age/libsodium-sealed file at `./.mcpforge/secrets.age`, alongside the runtime database and `.gitignore`'d with it, unlocked by a key held in the OS keychain (DPAPI on Windows — where this builds — Keychain on macOS, libsecret on Linux), with an environment-variable key **for CI only**. A sealed file with an OS-held key satisfies both local-first and headless/CI/container operation while remaining one artefact to back up or destroy — a `.env` is just a file anyone can read. **`OsKeychainStore`** is a second Wave 0 implementation for interactive development, contract-tested against the same suite. **`OciVaultStore`** is the named production target, **not built in Wave 0** — that would make an OCI service a Wave 0 prerequisite, contradicting a settled decision (§10.1 item 2). The contract suite is written in Wave 0; the OCI implementation is the only missing piece — the same discipline `W0-C5` applies to the Postgres dialect and `W0-D3` to the OIDC provider.

**The six rules:**
1. **No secret value crosses the git boundary.** `overlay-purity` (`W0-K3`) gains a **content** check: any high-entropy string, PEM header, or `password:`/`secret:`/`token:`/`key:` key whose value is not a `secretRef://` URI, under `overlays/**`, `manifests/**`, `roles/**`, `packages/**` or `consumers/**`, **fails the build with the file and line named.**
2. **No secret value is returned above the adapter layer.** `SecretStore.get()` is callable only from `adapters/**` and `core/gateway/identity/**`, enforced by a fourth guard lint rule, `no-secret-value-escape`, beside `no-service-account-fallback`.
3. **Secrets are audited by reference and version, never by value.** `audit_call` gains `credential_refs[]` via a normalised side table — `audit_credential_ref(call_id, secret_ref, version)` — following the same normalisation precedent §10.4's items 2 and 3 set. "Which calls used the credential that just leaked?" becomes a one-hop indexed query.
4. **One credential per (binding × module × environment).** Never one shared credential across modules — a generalisation of §3.3's existing "dedicated, per-module, read-only database user" rule, applied to every binding type. A leaked EBS AP wrapper credential exposes the AP wrapper package set in one environment, not the estate.
5. **Rotation is scheduled, tested and visible.** Defaults: consumer client credentials **90 days**; binding credentials **180 days**; the local JWT signing key **90 days** with JWKS-style overlap; the worker shared secret **per boot** (already true). **The confirm-token HMAC key rotates at 90 days with a dual-key overlap window** — the retired key is accepted for *verification only* for one plan TTL plus a margin, because a hard cutover invalidates every in-flight plan token and turns a routine rotation into a self-inflicted outage. A credential past its interval is an amber finding in Governance → Consumers and Environments; past **2×** its interval it raises an anomaly event. `forge secrets status --json` reports age and next-due for every ref, and rotation may not be silently skipped.
6. **Emergency revocation is one act.** `forge secrets revoke <ref> --reason "…"` invalidates the value **and kill-switches everything referencing it in the same operation**, using §4.7's flags mechanism.

#### 11.5.1 The four-part stored-credential legitimacy test

"No service-account fallback" (§4.4 rule 2) forbids **substitution**, not **storage** — §3.3 and §3.4 already depend on a binding holding a credential of its own where the target structurally cannot carry per-user identity. What keeps that consistent, made explicit as a test rather than left implicit:

> **A stored credential is legitimate only when all four hold:**
> 1. **The binding type structurally cannot carry per-user identity**, as reported by the probe — never as asserted by a human or a manifest.
> 2. **A per-user identity is nonetheless resolved for the call**, and a missing or ambiguous mapping is a hard failure.
> 3. **A named compensating control carries that identity into the target**, and is echoed back into the audit record.
> 4. **The credential is scoped to one module and one environment.**
>
> **If any of the four fails, the credential is a service-account fallback and is forbidden.**

All four are checkable from data the system already holds: (1) is `identity.carries` in the probe report; (2) is the git-managed mapping and `IDENTITY_UNRESOLVED`; (3) is `compensating_control`, already a column in `audit_call`; (4) is the `SecretRef` scope. The four-part test becomes a `forge validate` rule plus a privilege-escalation case, not a paragraph nobody reads.

**One supporting field:** `binding.credentialClass: per-user-exchanged | module-scoped-stored | none` on the manifest, with two validate rules: reject `module-scoped-stored` on a binding whose probe reports `identity.carries: verified`; reject `per-user-exchanged` on `plsql` (structurally impossible).

### 11.6 Usage tracking and the detector substrate

> **Wave 0 ships the substrate: consumer-level counters, the detector interface, three detectors, and the event schema. Wave 3 ships the monitoring product: triage workflow, alert routing, tuning, and the true-positive evidence 01 G4 @ M2 asks for.**

**`consumer_usage`** — hourly and daily rollups, written from the same outbox transaction as the audit row: calls · writes · plans minted · plans never confirmed · refusals by error code · distinct tools touched · distinct binding types touched · **distinct human subjects acted for** · bytes out · p95 latency. Cheap, because it rolls up data already being written, and it is what makes a consumer's declared `limits` enforceable (`RATE_LIMITED`, with a `next` naming the window and its reset).

**Seven anomaly patterns**, each a declarative detector configured in the overlay with a tunable threshold and a compiled-in hard ceiling (the same tighten-never-loosen shape §4.7 already uses for caps):
1. **Burst write activity** — writes per consumer per window above N× trailing baseline, or above declared `writesPerDay`. The highest-value detector: idempotency suppresses identical retries, but forty *different* vouchers in four minutes are forty legal calls.
2. **Off-hours elevated-binding calls** — a `plsql`/`function` write outside the consumer's `operatingWindow`. The classic first indicator of a credential used by someone other than its owner.
3. **Scope probing** — a rising rate of `TOOL_NOT_IN_SCOPE` / `CONSUMER_NOT_AUTHORIZED` / `ELEVATED_GRANT_REQUIRED` refusals from one consumer.
4. **Subject fan-out** — one consumer acting for an unusual number of distinct `caller_subject`s, or a single human subject appearing under a consumer that has never carried them before. Catches a leaked consumer credential paired with harvested user tokens.
5. **Identity-echo mismatch rate** — `identity_match = false` occurrences per consumer (§3.5's `echoOn` records this per call; the *rate* is the anomaly).
6. **Plan-abandonment ratio** — a high plan:execute ratio per consumer, simultaneously a quality and a probing signal.
7. **First write to a tool** — the first ever call by consumer C to write-capable tool T. Not an alarm — a low-severity notable event, high signal in a young deployment.

> A detector may observe and alert. It may **never** silently change an authorization, a threshold or a scope. The single exception is that a detector configured `severity: critical` may trip the **consumer kill switch** — a visible, audited, human-reversible act carrying a reason string, using §4.7's existing mechanism. A loud automatic cut-off is acceptable. A quiet automatic throttle is not, because silent degradation is the failure mode this entire product is built to prevent.

**Schema:** `anomaly_event(id, ts, consumer_id, detector_id, severity, window, observed, threshold, audit_call_ids[], state)`, referencing the audit rows that triggered it so every alert is one click from its evidence.

**Wave 0 / Wave 3 split as scope discipline:** the substrate is schema and therefore blast-radius work that must be early (04 §1.1 Test 1). The workflow is UI and operations, has no blast radius, and needs real traffic to tune — which Wave 0 does not have. Pulling Wave 3's goal forward would be scope inflation wearing a security costume.

### 11.7 New error codes

**The closed error taxonomy in §3.1.5 grows from 17 codes to 21:**

| Code | Meaning | Worked `next` |
|---|---|---|
| `CONSUMER_UNREGISTERED` | The presenting consumer has no registration record, or none matching its credential | *"Register this client via the portal's Consumers registration flow before retrying; see the operator for onboarding."* |
| `CONSUMER_SUSPENDED` | The consumer is registered but currently suspended, expired or retired | *"This client's registration is suspended (reason: <reason>). Contact <steward> to resolve, or wait for reinstatement."* |
| `CONSUMER_NOT_AUTHORIZED` | The consumer's own declared authorizations (binding type, sensitivity, write flag, roles, packages) do not permit this call — **the client may not, regardless of what the human may** | *"Your client is not authorized for this binding type / sensitivity / write. Request a broader consumer authorization from <owner>, not a role change."* |
| `ELEVATED_GRANT_REQUIRED` | The tool is elevated posture and the caller's role/consumer holds no `bindingGrant` for it | *"This tool requires an elevated binding grant (<grant name>). Request it from <approver>; it is not covered by role scope alone."* |

`CONSUMER_NOT_AUTHORIZED` and `TOOL_NOT_IN_SCOPE` must never share wording. One says your client may not; the other says you may not.

### 11.8 What this does not change

Per-user identity passthrough is unchanged and is still required on every call. The no-service-account-fallback rule is unchanged and is now more precisely stated. `database` read-only-by-policy is unchanged. The write-safety machinery is unchanged. The five handshakes are unchanged. The discovery mechanism and every G5 number are unchanged.

*Correction applied by Phase 5, per user direction, 27 Aug 2026.*
