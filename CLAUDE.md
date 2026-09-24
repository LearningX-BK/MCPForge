# MCPForge — project instructions

**MCPForge is a governed control plane and runtime gateway that turns Oracle application capability into MCP tools.** LTM · BlueVerse ValueMesh · Oracle AI Practice.

This file is read at the start of every session in this repository. It is short on purpose. **The plan lives in four documents in `docs\build-plan\` inside this repo and you must read the relevant ones before writing code.**

---

## 1. Read this first, in this order

| # | Read | When |
|---|---|---|
| 1 | `docs\build-plan\04_AUTONOMY_MODEL_ROUTING_AND_TASKS.md` | Always. How the build runs, which model does what. |
| 2 | `.\TASKS.md` | Always. Your task is in here. Do **one** task. |
| 3 | `docs\build-plan\02_TECHNICAL_ARCHITECTURE.md` | Any gateway, manifest, codegen, binding, discovery, store or CLI work. **Including its §10 datastore correction.** |
| 4 | `docs\build-plan\03_UX_DESIGN_SYSTEM.md` | Any portal work. Tokens, components, IA, write-path UX, accessibility. |
| 5 | `docs\build-plan\01_GOALS_AND_ROADMAP.md` | When you need to know *why* — goals, exit criteria, the checkpoint process. |

Repo-relative paths (from the MCPForge root — the lane always runs from within the repo):
`docs\build-plan\01_GOALS_AND_ROADMAP.md` · `…\02_TECHNICAL_ARCHITECTURE.md` · `…\03_UX_DESIGN_SYSTEM.md` · `…\04_AUTONOMY_MODEL_ROUTING_AND_TASKS.md`

**Do not re-derive decisions these documents already made. Do not re-open them because a different approach looks cleaner.** If you believe one is wrong, say so in your output and stop — do not implement the alternative. Every one of these decisions has a written reason and most have a knock-on consequence three documents away.

**Do one task.** The task block in `TASKS.md` names its `reads:` — go to those sections specifically rather than reading whole documents. When the task is done and its `done:` criterion passes, stop. Do not start the next task, do not tidy adjacent code, do not refactor something you noticed.

---

## 2. The eight non-negotiables

*Items 1–5 are write safety. Items 6–8 are access control and credentials, added by Phase 5 on 27 Aug 2026. All eight are checked by lint, by tests, by `forge validate` and by code review — and all eight are written here because a reviewer who knows them catches things the tools do not.*

These are the rules that, if broken, make the product's central security claim false while the portal continues to assert it. They are checked by lint, by tests, by `forge validate` and by code review — but they are written here because a reviewer who knows them catches things the tools do not.

1. **There is no service-account fallback anywhere in this codebase.** A missing target-identity mapping is a hard failure (`IDENTITY_UNRESOLVED`). Not a default responsibility, not a shared token, not a "temporary" env var. If you find yourself writing a fallback credential path, you have misread the architecture. Lint rule: `no-service-account-fallback`.
2. **`identity.carries: verified` may only ever be written by the capability probe**, into the probe report, never into a manifest and never by a human or an agent. A manifest asserting `verified` fails validation. The UI never renders "verified" without a probe reference.
3. **`database` bindings are read-only, by policy.** `write: true` + `binding.type: database` is rejected by `forge validate`. Writes go through a `plsql` wrapper package, never raw DML.
4. **Every write tool goes through the full path:** plan/dry-run → confirmation round-trip bound to a canonical argument hash → execute → immutable audit record carrying the created business key → a declared and tested reversal. A write tool that can be fired in one call is a bug. `forge validate` requires a complete `writeSafety` block with a non-`none` dry-run strategy and a `reversal.class`.
5. **Every error path carries a non-empty, agent-actionable `next`.** Never "try again". Name a tool id or a human action. A generated unit test per tool asserts this; the eval harness asserts zero dead ends across the suite.
6. **Every call needs BOTH a registered consumer and a resolved human identity.** Authorization is the **intersection** of what the consumer may do and what the human may do — never the union, never a substitute. An unregistered, suspended, expired or retired consumer is refused at session establishment with `CONSUMER_UNREGISTERED` and is served no `tools/list`. A registered consumer with no resolvable human identity is still `IDENTITY_UNRESOLVED`. There is no consumer-only path and no human-only path, and Dynamic Client Registration does not exist — registration is a reviewed git artefact with an approval record, like every other grant here.
7. **Being in scope is not permission to execute an elevated binding.** `plsql` and `function` bindings, write-classified `wrapped-vendor` tools, and any tool carrying a `policyException` are **elevated posture**: executing one requires an explicit, named, expiring, approval-recorded `bindingGrant`, not merely membership of a role that happens to include the tool. Catalogue membership is discovery; scope is visibility; **neither is permission.** If you find yourself letting scope membership alone authorize a `plsql` call, you have built the thing this rule exists to prevent. `forge.invoke` is not a way around it — it runs the identical chain.
8. **A credential is a `secretRef://`, and a stored credential must pass the four-part test.** No secret value ever appears in git, in a manifest, an overlay, a consumer record, an audit row, a log line, a portal screen or a CLI output — only a reference, and `SecretStore.get()` may only be called inside `adapters/**` and `core/gateway/identity/**` (lint rule: `no-secret-value-escape`). A binding may hold a stored credential **only when all four hold**: (a) the binding type structurally cannot carry per-user identity, **as reported by the probe, never as asserted by a human**; (b) a per-user identity is still resolved for the call and a missing mapping is still a hard failure; (c) a named compensating control carries that identity into the target and is echoed into the audit record; (d) the credential is scoped to one module and one environment. **If any of the four fails, it is a service-account fallback and item 1 forbids it.**

**Two more that behave like non-negotiables even though they are not security:**

- **The portal writes to git, not to a database.** "Save" means *proposed*, never *written*. There is no button labelled `Save` that opens a change proposal — the vocabulary is **Save draft · Propose · Discard**, fixed.
- **No raw colour anywhere** outside `tokens.primitives.css`. No hex, no `rgb()`, no `hsl()` in any `.tsx` or other `.css`. Lint rule: `no-raw-color`.

---

## 3. Settled architecture — the short version

**Stack.** TypeScript / Node 22 LTS, ESM, `strict`, for the whole core: gateway, registry, codegen, `forge` CLI, probe, portal backend. **React 19 / Next.js App Router** for the portal, with **shadcn/ui + Tailwind v4 vendored into the repo**. **Python 3.12 for exactly one thing** — the Oracle Adapter Worker that executes `database` and `plsql` bindings and the DB half of the probe. That worker **never speaks MCP, never decides policy, never resolves identity, never writes audit.** pnpm workspaces; `uv` for the Python worker.

**Manifest-first.** A YAML manifest in `manifests/` is the sole source of truth for a tool. Handlers, JSON schemas, contract tests, docs, discovery cards, role scopes and eval skeletons are **generated** into `generated/`, which **is committed** and CI-verified byte-identical (`forge codegen && git diff --exit-code generated/`). Target: ≥80% of tools have zero hand-written code.

**The one hand-owned file in the generated tree** is `generated/tools/<id>/binding.custom.ts`. Codegen creates it once and never touches it again. Drift between it and its manifest is caught by a `contract-hash` that **fails the build** — it is never merged and never clobbered.

**Discovery is strictly spec-baseline MCP (2026-07-28).** Four always-resident meta-tools — `forge.find`, `forge.describe`, `forge.activate`, `forge.invoke`, ~440 tokens total — plus role-scoped `tools/list` under a CI-enforced ≤1,300-token role budget. No Claude-specific assumption, no client-side progressive disclosure, no REST facade, no vector database. Wave 0 is lexical (BM25 + structured verb/entity boosts); embeddings are a Wave 1 *conditional*.

**Identity is pluggable.** `IdentityProvider` → `Principal`. Local user store for Wave 0, OIDC/LTM AD from Wave 1, **both contract-tested in Wave 0** against one suite. Group→role mapping lives in git. `Principal.subject` is the only identity value written to audit, mappings and idempotency keys.

**Consumers are registered, not assumed.** A `Consumer` is the software holding the session — an agent, a client, a platform, the portal itself. It is a git artefact in `consumers/`, compiled like a role, approved like a role, and it carries its own authorizations: which binding types, which sensitivity ceiling, whether writes are allowed at all, which roles and packages, its rate and write limits, and whether a human is in its loop. `visible(session)` is a **six-way** intersection: Deployed ∩ Granted ∩ Activated ∩ ProbeEnabled ∩ ¬KillSwitched ∩ ConsumerAuthorized. The kill switch has **five** granularities — tool · module server · binding type · **consumer** · deployment.

**Roles are grants, not runtimes.** A role is a git file of globs, compiled by codegen into an explicit tool-id list so a widening grant shows up as a **diff in the change proposal**. There is no process-composition layer, no composite tools, no orchestration — if a business process needs five tools in sequence, the agent does that, not MCPForge.

**Module servers are versioned artefacts, in-process by default** (Mode A), promoted to their own process (Mode B) only when they need a different runtime, auth boundary, sensitivity class, release cadence, or are a wrapped vendor server. Not 42 deployments.

**Slices are selections, not builds.** One byte-identical `mcpforge-core` image + a selection-only catalogue artefact + a values-only overlay. **No branch of MCPForge is ever created for a customer.** Overlays may contain config, mappings and branding — never code, never manifests. Enforced by the `overlay-purity` CI job.

**Secrets are the third pluggable seam**, after `IdentityProvider` and `ChangeHost`. `SecretStore` → `SecretRef`. `EncryptedFileStore` (sealed file, OS-keychain key) is the Wave 0 default with `OsKeychainStore` beside it, both contract-tested against one suite; `OciVaultStore` is the production target and is **not** a Wave 0 dependency. Rotation intervals are declared and enforced, and the confirm-token HMAC key rotates with a **dual-key overlap window** so a rotation does not invalidate every in-flight plan token.

### 3.1 Wave 0 decisions specific to right now

- **Git: local only, host-agnostic.** No GitHub / GitLab / Azure DevOps assumption. Reach git through the `ChangeHost` interface — `LocalGit` now, `HostedGit` later. UI vocabulary is "change / propose / review", never "GitHub pull request", and it shows *"local only — no remote configured"* when there is no remote.
- **Runtime: local-first.** Everything must build, test, run, probe and demo on one developer machine. Docker is fine. **No cloud account, no OCI service and no managed database may become a prerequisite.** OCI is the eventual production target, not a Wave 0 dependency.
- **Datastore: SQLite** at `./.mcpforge/runtime.db`, WAL mode, via **Drizzle ORM** with the SQLite and Postgres dialects generated from **one schema**. No application code imports `better-sqlite3` or `pg` directly — everything goes through `core/gateway/store/`. **Read Phase 2 §10 before touching store code.** Two consequences you must not misstate: on SQLite, audit immutability is **detectable (triggers + hash chain), not preventable**; and the gateway runs as **one instance** at Wave 0 — multi-replica is a Postgres-era property.
- **`rm -rf .mcpforge/` must leave a fully working, redeployable system.** Definitions are git; only events are in the store. This is a test (`W0-C6`), not a convention.
- **Wave 0 is write-heavy by design: 6 write tools, 5 read tools.** If scope must be cut, **cut a read tool, never a write tool.** If portal scope must be cut, **trim Insights and Home, never the write path.**

---

## 4. Repository layout

```
MCPForge/
  manifests/          SOURCE OF TRUTH — hand-authored YAML tool + server manifests
  roles/              process-scoped roles (p2p, r2r, o2c…)
  packages/           slice definitions (jde-fin, …) — selections, no code
  enums/              shared lookup lists referenced by enumRef
  evals/              benchmark intents — authored by module STEWARDS, not tool authors
  approvals/          approval records (governance evidence), committed
  generated/          CODEGEN OUTPUT — committed, CI-verified clean. Only binding.custom.ts is hand-owned.
  core/
    gateway/          MCP endpoint, policy chain, audit, store/
    registry/         index build + query, scoping
    codegen/          manifest -> artefacts
    cli/              the `forge` command
    probe/            probe orchestrator
    portal/           Next.js app (src/design/ holds the token files)
    shared/           manifest types, error taxonomy, token counter, status.ts
  adapters/
    oracle-worker/    PY — the only Python in the repo
    rest/  vendor/    TS executors
  overlays/           per-deployment config. VALUES ONLY. CI-enforced.
  seed/               one-time extraction from the concept console. Not manifests.
  tools/build/        the PowerShell build lane
  .forge-build/       lane state and logs. NOT committed.
```

**Never read the concept console (`..\mcpforge-console_1.html`) at runtime.** It is a demo artefact. `seed/` is a one-time extraction from it and `seed/` entries are **not manifests** — they are authoring input. The `calls` field from the seed is illustrative demo data and `forge validate` rejects any manifest containing it.

---

## 5. Conventions

**Tool ids** are `{app}.{module}.{entity}.{verb}`, lower snake, and the verb comes from a **closed 19-item list**: `search get list create update cancel submit approve release run_report run_process get_status get_receipt_status get_approval_status download simulate reconcile explain resolve`. (Widened from 17 to 19 by owner decision during W0-I2: `get_receipt_status` and `get_approval_status` are cited verbatim as tool ids in `01_GOALS_AND_ROADMAP.md` §10.3, in 02 and 03, and in `seed/tools.yaml`. The list remains **closed** — nothing joins it without the same explicit decision.) Ids are **immutable** — renaming is a retire-and-create pair, both recorded.

**Versioning.** `apiVersion: mcpforge/v1` on every manifest. Tool version is semver: patch = copy, minor = new optional input or result key, **major = anything that can break a caller** (removing/renaming an input, tightening a type, changing a verb, changing `write`), and a major bump needs a fresh approval record.

**Secret references** are `secretRef://<scope>/<subject>/<purpose>` — e.g. `secretRef://binding/ebs-p2p-ap/wrapper-schema`. A ref is the only form a credential takes anywhere a human or a log can see it. **Consumer ids** follow the same immutability rule as tool ids: renaming is a retire-and-register pair, both recorded, because audit rows and consumption edges reference the id.

**Agent-facing copy is UI and is budgeted by codegen.** `purpose` ≤14 words, verb-first. Parameter `desc` ≤12 words. `disambiguation` mandatory and mutual on any two tools sharing an `{app}.{module}.{entity}` prefix. `planTemplate` names the system, the object, the amounts and **the business consequence in plain words** — *"This creates an OPEN PAYABLE in JD Edwards."* In a chat client the plan string is the entire UI; it is the highest-stakes copy in the product.

**Token budgets, enforced at codegen, not at runtime:** card ≤60 · resident definition ≤200 typical / 400 hard · describe ≤600 · **role core set ≤1,300**.

**Code style.** ESM, `strict`, no `any` in `core/shared`. Named exports. Errors are the closed taxonomy, never bare `throw new Error` on a caller-visible path. `zod` for runtime boundaries, compiled Ajv for tool-argument validation (generated from the same JSON Schema — never a second hand-written validator). Prettier is the formatter and codegen output is prettier-formatted so diffs are stable. Tests are Vitest; portal E2E is Playwright.

**Commits.** One task, one branch `forge/<taskId>-<slug>`, one proposal. The message names the task id and the exit criterion it serves. Small and reviewable beats complete and unreadable — the whole point of committing `generated/` is that a reviewer can see the blast radius.

**Never mark a CI gate "allowed to fail."** The gates that exist are the goals made real: regen-diff, privilege-escalation, token budget, discovery benchmark, slice-diff, and the five accessibility gates.

---

## 6. `OPUS_GUARDED_PATHS`

Any change touching these runs on **Opus** regardless of the task's declared model, and any diff touching them gets a security review pass. They are the security spine.

```
core/gateway/policy/**
core/gateway/store/audit*
core/gateway/store/nonce*
core/gateway/store/idempotency*
core/gateway/identity/**
core/gateway/scope/**
core/codegen/rules/**            # the ~40 forge validate policy rules
core/registry/rank/**            # ranking, fusion, score floor
adapters/**/binding*             # every binding executor
core/probe/identity*
manifests/**/*.tool.yaml         # any manifest with write: true
core/portal/src/components/write-path/**
core/gateway/consumer/**
core/gateway/policy/binding-auth/**
core/gateway/secrets/**
core/gateway/store/consumer*
consumers/**
```

---

## 7. Useful commands

```bash
pnpm install                       # from a clean clone, no Docker required
forge validate                     # ~40 schema + policy rules
forge codegen                      # regenerate everything; then `git diff --exit-code generated/`
forge codegen --accept-contract <toolId>   # deliberate, human/agent act; refused when CI=true
pnpm test                          # unit + contract
pnpm test:policy                   # privilege-escalation suite — every attempt must FAIL CLOSED
forge bench --json                 # TTFC · VTC · DH · SA@1 · MTB, rank-1 mode
forge probe                        # capability probe; needs a real instance
forge audit verify                 # hash-chain integrity — load-bearing on SQLite
forge audit reverse <callId>       # construct the reversing call from result keys
forge package <id>                 # build a slice artefact (selection only)
forge slice-diff <a> <b> --json    # the P1 no-fork proof
forge kill <toolId> --reason "…"   # kill switch, no redeploy
forge ci                           # run the whole pipeline locally, host-agnostic
forge consumer new|list|show|suspend|rotate|retire   # the consumer registry
forge consumer issue-credential <id>                 # prints once; refused when CI=true or env is staging/prod
forge secrets status --json                          # age and next-due for every ref
forge secrets rotate <ref>                           # dual-key overlap on the HMAC and signing keys
forge secrets revoke <ref> --reason "…"               # invalidates AND kill-switches every dependent
```

---

## 8. When you are unsure

- **A decision looks wrong** → say so in your output, cite the document and section, and **stop**. Do not implement the alternative.
- **The spec is silent on a small implementation detail** (a library inside a module, an index, a CSS class) → decide it, note it in your output, move on. That is expected and fine.
- **The spec is silent on something with a blast radius** (a schema field, an interface, a security boundary, a file format) → stop and say what is missing. That is a `needs_human`, and it is a *good* outcome, not a failure.
- **A task needs something a human must produce** — a JDE orchestration, a steward's eval intents, an approval, a named owner → stop and name it. Do not stub it, do not fake it, and above all do not quietly degrade the design to route around it.
