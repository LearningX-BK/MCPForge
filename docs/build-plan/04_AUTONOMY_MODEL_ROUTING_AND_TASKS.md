# MCPForge — Real Application: Autonomy, Model Routing, Skills and the Build Lane

**Phase 4 of 4 — the final planning phase · Planning stream: REAL PRODUCTION APPLICATION (not the concept console)**
Written 27 Aug 2026 · Companion to `01_GOALS_AND_ROADMAP.md`, `02_TECHNICAL_ARCHITECTURE.md`, `03_UX_DESIGN_SYSTEM.md`

---

## 0. How to read this document

**Audience, in order:** the human who is about to run Claude Code against this repository; the PowerShell driver that human runs; and every Claude Code session that driver starts.

**What this document is.** Phase 1 set *what must be true and in what order*. Phase 2 set *how it is built*. Phase 3 set *what the human sees*. This document sets **how the building actually happens**: which model runs which kind of task, which Claude Code skills are loaded for which kind of work, the PowerShell orchestration that drives the whole thing task by task and stops at wave boundaries, and — in its companion file `MCPForge\TASKS.md` — the Wave 0 backlog itself.

**Where the artefacts are:**

| Artefact | Path | What it is |
|---|---|---|
| Phase 1 | `C:\GenAIGenerated\LTM\MCP\MCPForge\docs\build-plan\01_GOALS_AND_ROADMAP.md` | Goals, waves, exit criteria, checkpoint process, risks |
| Phase 2 | `C:\GenAIGenerated\LTM\MCP\MCPForge\docs\build-plan\02_TECHNICAL_ARCHITECTURE.md` | Stack, pipeline, bindings, gateway, discovery, slices. **Carries a §10 datastore correction from this phase.** |
| Phase 3 | `C:\GenAIGenerated\LTM\MCP\MCPForge\docs\build-plan\03_UX_DESIGN_SYSTEM.md` | Tokens, components, IA, write-path UX, accessibility |
| **Phase 4 (this)** | `C:\GenAIGenerated\LTM\MCP\MCPForge\docs\build-plan\04_AUTONOMY_MODEL_ROUTING_AND_TASKS.md` | Routing rule, skills map, orchestration, Wave 1+ summary |
| **Project instructions** | `C:\GenAIGenerated\LTM\MCP\MCPForge\CLAUDE.md` | What every Claude Code session in the repo reads first |
| **The backlog** | `C:\GenAIGenerated\LTM\MCP\MCPForge\TASKS.md` | Wave 0, fully broken down, machine-parseable |

### 0.1 The three decisions applied here as given, not re-derived

1. **Git host: host-agnostic for Wave 0.** Local git only. The change model works against a bare local repository first; hosted-platform integration is deferred. Applied to Phase 2 as `§10.1 item 1` — a `ChangeHost` interface with `LocalGit` first.
2. **Runtime target: local-first for Wave 0, OCI as the eventual production target.** Wave 0 must build, test, run, probe and demo on one developer machine with no cloud account. Docker is allowed and expected; nothing OCI-specific is a Wave 0 prerequisite.
3. **Runtime datastore: SQLite for Wave 0 / local dev, behind Drizzle ORM with both dialects generated from one schema.** Applied to Phase 2 as its new **§10**, including the eight-item list of what Phase 2 assumed that SQLite cannot do. **Read that section before writing any store code** — item 1 (audit immutability is *detectable*, not *preventable*, on SQLite) and item 6 (no multi-replica gateway at Wave 0) change what may honestly be claimed.
4. **Component library: shadcn/ui, as Phase 3 recommended.** No LTM house component library exists to align with instead. Phase 3 §3 and §14 item 1 stand unchanged. *(The question remains worth one sentence to the user before `W0-J4` runs — see §5.)*

---

## 1. Model routing — which build tasks run on Opus, which on Sonnet 5

The user's instruction: *"will use sonnet 5, but if you think some step require opus, advise accordingly."* So the default is **Sonnet 5**, and this section is the rule for when to escalate. A list of named tasks would go stale the first time the backlog changes, so what follows is a **decision rule that generalises**, with the named tasks as worked examples of it.

### 1.1 The rule

> **Default to Sonnet 5. Escalate a task to Opus if it fails *either* of the first two tests. Confirm Sonnet with the third.**
>
> **Test 1 — the Blast-Radius test.** *Does this task produce an artefact that later tasks will copy, extend, conform to, or be constrained by — such that changing it later means changing N other things?*
> Schemas, contracts, taxonomies, interfaces, state machines, file-format decisions, naming conventions, generated-code shapes. If the answer is yes, the cost of getting it subtly wrong is paid N times over, and the cheapest place to spend judgment is here. **→ Opus.**
>
> **Test 2 — the Adversary test.** *Is there an input, a race, or an operator mistake whose consequence is a wrong write, a privilege leak, a bypassed control, or a false safety claim?*
> Anything in the write-safety machinery, anything that decides identity or scope, anything that constructs a sandbox boundary, anything that computes a hash a security decision depends on, anything whose failure mode is silent. **→ Opus.**
>
> **Test 3 — the Specification-Completeness test.** *Is this task already fully determined by a written spec, such that a correct implementation is checkable by a test the task itself can run?*
> If yes, and neither of the first two tests fired, the work is transcription with taste, not judgment. **→ Sonnet 5.**

**Read the tests in order and stop at the first hit.** A task can be extremely well specified (Test 3) *and* still be security-critical (Test 2) — the write-safety machinery is specified in near-implementation detail in Phase 2 §3.1, and it still runs on Opus, because a spec you implement slightly wrong in a security control is worse than one you implement slightly wrong in a table.

### 1.2 Why this rule and not "hard things get Opus"

"Hard" is the wrong axis. Some of the hardest-looking work in this build — the 19-component write-path family, the nine portal routes, the token file with its measured contrast values — is **fully specified** by Phase 3 and is exactly what Sonnet 5 is good at: high-volume, high-fidelity execution against a written contract, with a test that says whether it worked. Meanwhile some of the shortest tasks in the backlog — a ~40-line canonical-JSON hashing function, a five-clause `visible(session)` intersection — are where a subtle error costs the most and shows up latest.

The two things that actually justify the more expensive model are therefore **irreversibility** and **adversarial consequence**, not size or difficulty. That is what the rule encodes.

### 1.3 The rule applied — worked examples from this build

| Task shape in this build | Test that fires | Model | Why |
|---|---|---|---|
| Manifest JSON Schema `mcpforge/v1` (`W0-B1`) | 1 | **Opus** | Every one of 150 tools, three codegen consumers and the portal conform to it. Changing a field name later is a 150-file migration. |
| The ~40 `forge validate` policy rules (`W0-B3`) | 1 + 2 | **Opus** | These rules are the structural form of the security model — "`verified` may not appear in a hand-authored manifest", "`write:true` + `database` is rejected", "`plsql`/`function` cannot select expedited review". A missed rule is a permanently open hole. |
| Contract-hash / three-file split (`W0-B5`) | 1 | **Opus** | It decides what codegen may and may not overwrite, forever. Getting the hash inputs wrong either clobbers hand-written code or lets it drift silently. |
| Two-phase confirm + token binding (`W0-F1`, `W0-F2`) | 2 | **Opus** | This is the control that stops an agent planning £100 and executing £100,000. The canonical-argument hash is where that lives, including number normalisation and key ordering. |
| Guardrail engine incl. SoD (`W0-F4`) | 2 | **Opus** | Evaluated at plan *and* execute; a guardrail that is only checked at plan is a guardrail that does not exist. |
| Reversal registry + `forge audit reverse` (`W0-F5`) | 1 + 2 | **Opus** | The `argMap` from result keys to a reversing call is a small piece of code that undoes financial transactions. |
| PL/SQL wrapper-schema generator (**Wave 2**, `W2-*`) | 2 | **Opus, without exception** | `commitsInternally` classification, `AUTHID DEFINER` grant sets, savepoint eligibility. Phase 2 §3.4 calls this "the single most damaging mistake available in this architecture." |
| `function`-binding executor + identity echo (`W0-H1`, `W0-H3`) | 2 | **Opus** | R1/R2, the whole Wave 0 identity claim, live in these two files. |
| Scope resolution + policy chain (`W0-E2`, `W0-E3`) | 2 | **Opus** | Ordered, fail-closed, and re-checked at call time. An ordering mistake is an authorization bypass. |
| Drizzle dual-dialect schema + repository interface (`W0-C1`) | 1 | **Opus** | It is the migration path. Everything else in the store sits on it. |
| Audit immutability + hash chain (`W0-C2`) | 2 | **Opus** | See Phase 2 §10.4 item 1: on SQLite this is the *only* integrity mechanism. |
| `forge.find` ranking, fusion and score floor (`W0-G2`, `W0-G3`) | 1 + 2 | **Opus** | Phase 3 §10.2: a human who gets a bad result retries; *an agent that gets a plausible wrong tool creates a voucher.* |
| Metric computation + CI regression gate (`W0-G7`) | 1 | **Opus** | Everyone quotes these numbers afterwards. Define them once, correctly, with a pinned tokenizer. |
| The six write tools' `writeSafety` blocks (`W0-I2`–`W0-I4`) | 2 | **Opus** | Choosing a dry-run strategy, a reversal class, an `argMap` and a guardrail ceiling per tool is a security design act, not data entry. |
| Role compilation + SoD detection (`W0-B7`) | 1 + 2 | **Opus** | The compiled scope diff is the governance mechanism; silent role widening is what it exists to prevent. |
| Change model / `ChangeHost` abstraction (`W0-J20`) | 1 | **Opus** | Wave 0 is local-git-only and a hosted platform arrives later. The seam has to be in the right place now. |
| Roles editor with live compiled-scope diff (`W0-J17`) | 1 | **Opus** | Phase 2 §8.1 item 4: a role editor that hides which tools a glob picks up is the exact failure this architecture prevents. |
| Generated handler / schema / test emission (`W0-B4`, `W0-B6`) | 3 | Sonnet 5 | Deterministic transformation from a schema that already exists, verified by `git diff --exit-code`. |
| Every additional tool manifest after the pattern exists | 3 | Sonnet 5 | This is the ~80%-no-hand-written-code target (Phase 2 §2.1) turned into a routing decision. |
| Token files, `globals.css`, `status.ts`, chip family (`W0-J1`–`W0-J5`) | 3 | Sonnet 5 | Phase 3 §4.6 measured the values and §13 wrote the files. The contrast test is the checker. |
| shadcn init + primitive set, app shell, DataTable, palette, and **all nine routes** | 3 | Sonnet 5 | Phase 3 §5.3 specifies each page's data sources, contents and empty states. |
| **The write-path component family** (`W0-J9`) | 3, with a caveat | **Sonnet 5, Opus-reviewed** | Phase 3 §7 specifies all 19 components, the 12-state machine and every refusal state. It is volume, not judgment — *but* it renders security-critical text, so its diff goes through an Opus review pass (§1.5). |
| Contract and unit tests against an existing contract | 3 | Sonnet 5 | The contract is the spec; the test is the checker. |
| Docs, `forge` CLI plumbing, CI wiring, Docker compose, seed extraction | 3 | Sonnet 5 | |

> **EXTENDED by §7.2 — Phase 5, 27 Aug 2026.** Six new task shapes are routed there under the same three tests: the consumer record model, consumer authentication, the binding-authorization stage, `standingAuthorization`, the `SecretStore` seam and the anomaly-event schema.

**Rough Wave 0 split that falls out of this: about 30% Opus, about 70% Sonnet 5** — and the Opus share is concentrated in the first third of the backlog (schema, store, identity, gateway policy, write safety), which is also where a mistake would be most expensive. After the write-safety machinery lands, the backlog becomes overwhelmingly Sonnet work.

> **SUPERSEDED by §7.3 — Phase 5, 27 Aug 2026.** With Phase 5's 15 new tasks the Wave 0 split is **43 Opus / 60 Sonnet / 8 human across 111 tasks** — about 42% of automated tasks on Opus. The shape of the argument is unchanged; the Opus share rises because the additions are concentrated in front-door and grant machinery, which is where Tests 1 and 2 both fire.

### 1.4 Two operational escalation triggers the driver applies automatically

The rule above is applied when the backlog is *written*. These two are applied while it *runs*, and they are the reason the routing does not have to be perfect up front:

1. **Two-strike escalation.** A Sonnet task that fails its definition-of-done twice on the same criterion is re-run **once** on Opus, with the two failure logs attached to the prompt. If it fails a third time it is marked `needs_human` and the run moves on. This catches routing mistakes cheaply and it produces the intervention-log entry that checkpoint agenda item 6 wants.
2. **Guarded-path escalation.** Any task whose changes would touch a path listed in `OPUS_GUARDED_PATHS` in `CLAUDE.md` runs on Opus **regardless of its declared model**. The list is the security spine: the policy chain, the write-safety machinery, the identity layer, the binding executors, the validator's policy rules, and the store's audit and nonce code. This makes the rule enforceable by a file glob rather than by remembering.

### 1.5 The review asymmetry — cheaper than routing everything up

**Sonnet writes; Opus reviews the things that matter.** Three review gates, all cheap relative to a second full authoring pass:

- **Per-task review** (`engineering:code-review`, §2) runs on every task's diff before it is proposed, on the task's own model.
- **Security-diff review on Opus** for any diff touching an `OPUS_GUARDED_PATHS` file, even when a Sonnet task produced it incidentally.
- **Wave-boundary architecture review on Opus** (`engineering:architecture`), which is checkpoint agenda item 3 — "did anything in this wave force a violation of the ten settled decisions" — and produces the wave's ADR.

This is the same shape that already worked on the concept console (recorded in `mcpforge_status.md`: *"Architecture and judgement calls made in the main session; build execution delegated to a Sonnet subagent working from the build spec"*). It is being kept because it worked, not invented.

### 1.6 Two anti-patterns to avoid

- **Do not route by file type.** "TypeScript goes to Sonnet, YAML goes to Opus" is meaningless here — `binding.custom.ts` and `voucher.create.tool.yaml` are both, at times, the most security-sensitive file in the repository.
- **Do not route the whole portal to one model.** Eighteen of the twenty portal tasks are Sonnet work; two (`W0-J17` roles editor, `W0-J20` change model) are Opus work because they are governance mechanisms wearing a UI costume. Batch-routing the portal would either overspend on eighteen tasks or underspend on the two that matter.

---

## 2. Skills and plugins — what to enable locally, and for what

Two plugin bundles were found in this session's marketplace search and both are worth enabling for this build. The mapping below is **per recurring task type in this specific build**, not a generic endorsement.

### 2.1 The `engineering` plugin

| Skill | Load it for | Concretely, in this build |
|---|---|---|
| **`engineering:architecture`** | **Wave-boundary ADRs and the checkpoint's invariant re-test.** The highest-value skill in the set for this programme. | Checkpoint agenda item 3 (Phase 1 §6) asks whether the wave forced a violation of the ten settled decisions. Run this at every wave boundary on Opus, producing `WAVE_<N>_CHECKPOINT.md`'s architecture section and any ADR that supersedes a settled decision. Also for the three Wave 0 architecture calls that are genuinely open: the Mode A → Mode B promotion decision (Phase 2 §4.1), the `ChangeHost` seam, and the eventual SQLite → Postgres migration record. |
| **`engineering:code-review`** | **A gate before every task's change proposal** — this is the single highest-frequency use. | Wire it into the driver as the step between "tests pass" and "propose change" (§3.5 step 6). Give it the four non-negotiables from `CLAUDE.md` explicitly: no service-account fallback anywhere; `identity.carries: verified` never hand-written; no raw hex outside `tokens.primitives.css`; no `Save` button that opens a change proposal. Those are exactly the four things a reviewer catches and a test does not.
> **SUPERSEDED by §7.4 — Phase 5, 27 Aug 2026: there are now eight, and this row already undercounted.** `CLAUDE.md` §2 listed five before Phase 5 and lists eight after. Pass all eight. **Note to the execution agent: this is a pre-existing inconsistency in the plan (04 says four, CLAUDE.md said five). Fixed to eight rather than propagated — flagged here as found and corrected.** |
| **`engineering:testing-strategy`** | **The eval/benchmark harness and the privilege-escalation suite.** | Two places specifically: `W0-G6`/`W0-G7` (the `forge bench` harness and the five metrics — rank-1 vs agent mode, the negative and near-miss composition, what constitutes a regression) and `W0-E8`/`W0-F7` (the privilege-escalation suite and the four exit-criterion-7 demonstrations, which are tests that must *fail closed* rather than pass). |
| **`engineering:debug`** | Probe failures, contract-hash drift, and any two-strike task before it escalates to Opus. | The probe's failure surface is deliberately rich (Phase 2 §4.5's closed status enum with per-check detail); this skill is for turning a `disabled_identity_unverified` into a diagnosis rather than a retry. |
| **`engineering:deploy-checklist`** | Before every probe run against a non-local environment, and before the Wave 0 demo. | Phase 2 §7.1's four environments have genuinely different rules — destructive `commitsInternally` classification happens in `probe` and **never** in `prod`. That is a checklist, and it should be one. |
| **`engineering:documentation`** | `/docs/architecture`, the `forge` CLI reference, the PR template, and keeping `CLAUDE.md` current as the backlog reveals conventions. | Low frequency, real value. Note that per-tool docs are *generated* (Phase 2 §2.3) and must not be hand-written. |
| **`engineering:system-design`** | Wave 1 planning at the W0 checkpoint, when the discovery mechanism becomes load-bearing. | Not a Wave 0 skill. Named so it is not forgotten at the boundary. |
| **`engineering:tech-debt`** | Checkpoint agenda item 7 (the open-items ledger) and the G9 retirement pass. | From Wave 2 onward. At Wave 0 there is no debt yet, only decisions. |
| **`engineering:incident-response`** | Only once something is live against a real instance. | Relevant from the first `staging` write. The kill switch (Phase 2 §4.7) is the runbook's first step and this skill is where that runbook gets written. |

### 2.2 The `design` plugin

The user's framing is right and worth restating: these are **an extension of Opus having authored the design system directly, not a replacement for it.** Phase 3 is the design system. These skills apply it, check it and extend it — they do not get to re-decide it.

| Skill | Load it for | Concretely, in this build |
|---|---|---|
| **`design:accessibility-review`** | **Phase 3 §12.7's five CI gates, and the per-wave manual pass.** The highest-value design skill here. | Run it against the write path first — Phase 3 §12.2 names the exact gaps that get missed: the plan → confirm → approve → execute → reverse sequence end to end, the approver's decision panel, roving tabindex in facet rows, single-tab-stop data grids, and the graph views' equivalent table views. Also on every chip component, because §12.5 flags chip labelling as *"the criterion most at risk in this product."* |
| **`design:design-system`** | **The token-file scaffolding tasks `W0-J1`–`W0-J5`**, and any later component that needs a new token. | Phase 3 §13 already specifies the three-tier files, the theme mechanism, the generated `tokens.ts` with its `git diff --exit-code` gate, and the three lint rules. Use the skill to *implement and verify* that, and to police the Tier-1/Tier-2/Tier-3 rule when a new component wants a colour. Not to redesign the palette — §4.6's contrast measurements are load-bearing and were done. |
| **`design:ux-copy`** | **The agent-facing copy standards in Phase 3 §10.3 — which are codegen gates, not style suggestions.** Under-obvious and genuinely high value. | `purpose` ≤14 words, parameter `desc` ≤12, mandatory `disambiguation` on sibling pairs, mandatory non-empty `next` on every error path, and above all the **`planTemplate`** — Phase 3 §10.1 item 8 calls the plan string *"the highest-stakes copy in the product"* because in a chat client it **is** the entire UI. Load this for `W0-I2`–`W0-I4` (the six write tools' plan templates and guardrail messages) and for the probe's `agentMessage` / `remediation` strings. |
| **`design:design-handoff`** | Turning Phase 3 §5.3's page specs into component tasks, once, at the start of the portal track. | Phase 3 §13.7 already gives a literal 10-step scaffolding order, so this is a smaller job than usual — use it to expand each route spec into its component list before `W0-J10` onward, not to re-plan the order. |
| **`design:design-critique`** | The Catalog and the Plan Review card, once each, after they first render. | These are the two surfaces where density and legibility actually compete (Phase 3 §1 principle 1). Worth one deliberate critique pass each; not worth one per route. |
| **`design:research-synthesis`, `design:user-research`** | Not Wave 0. | Relevant when there are real users of a real portal — from Wave 1's checkpoint, feeding G9 (demand-driven catalogue) and the persona assumptions in Phase 3 §2. |

### 2.3 `/ui-ux-pro-max` — check your own CLI, and layer it, do not swap it

**`/ui-ux-pro-max` was not found in this session's marketplace search.** That is not evidence it does not exist for you: this Cowork session and your local Claude Code CLI are **different environments with different installed plugins**, and a skill can be custom-built, locally installed, or from a marketplace this session cannot see.

**Do this before the portal track starts:** in your local Claude Code CLI, run `/plugin` (or `/help` and the plugin/skill listing it points to) and check whether `ui-ux-pro-max` is actually installed there.

- **If it exists:** use it, and **layer it on top of Phase 3, not in place of it.** Phase 3 is not generic UI advice — it carries measured contrast ratios that drove specific token values (`#B23A2C` not `#F2665B` for light-mode coral text; ink-on-coral not white-on-coral for dark primary buttons; the `-300` status steps), a brand palette with lint-blocked retired hexes, an IA decided against three named personas, and a write-path interaction design that exists because Wave 0 is write-heavy. A general-purpose UI skill that suggests a different palette, a different component library or a different page structure is **not** better-informed than Phase 3 on any of those points, and should be overruled on all of them. Where it is genuinely additive — micro-interaction quality, empty-state craft, form ergonomics, visual polish within the token system — take its advice freely.
- **If it does not exist:** the `design` plugin's `design-system`, `design-critique` and `accessibility-review` skills cover the same ground for this build, and Phase 3 supplies the specifics they would otherwise have to invent.

### 2.4 The shortest possible answer

If only three skills are enabled: **`engineering:code-review`** (every task), **`engineering:architecture`** (every wave boundary), **`design:accessibility-review`** (the write path and every chip). Those three cover the highest-frequency gate, the highest-consequence decision point, and the CI gates most likely to be quietly skipped.

---

## 3. The autonomous build lane — PowerShell driving Claude Code

The user asked for this to be **"as autonomous as possible."** The design below is autonomous *within* a wave and **deliberately not autonomous across a wave boundary**, because Phase 1 §6 made the wave checkpoint a mandatory, human, written-artefact step and the user asked for exactly that ("revisit strategy after a stage"). An orchestrator that quietly started Wave 1 would defeat the single most important governance mechanism in the roadmap.

### 3.1 Design principles for the driver

1. **The backlog is the program.** `TASKS.md` is the source of truth for what to build, in what order, on which model, and with what acceptance criterion. The driver parses it; it does not contain the plan.
2. **State is a file, not a memory.** Every run is resumable from `.forge-build\state.json`. Killing the terminal loses nothing but the in-flight task.
3. **Failures surface; they never loop.** Bounded attempts, then `needs_human`, then move on. There is no retry-forever path anywhere in the driver. A run that ends with eight failed tasks is a *report*, not a hang.
4. **One task, one change proposal.** Small commits are what make an autonomous lane reviewable. Related tasks may be grouped, but only by explicit declaration in the backlog (`group:` on the task line).
5. **The definition of done is executable.** Every task carries a machine-checkable acceptance criterion. "Looks right" is not a criterion and is not accepted by the parser.
6. **The driver never crosses a wave boundary, and never crosses a human decision gate.** It stops, writes what the human needs to decide, and exits with a distinguishing exit code.

### 3.2 Files the lane owns

```
C:\GenAIGenerated\LTM\MCP\MCPForge\
  TASKS.md                          # the backlog (source of truth, hand- and machine-editable)
  CLAUDE.md                         # project instructions, read by every session
  tools\build\
    Invoke-ForgeBuild.ps1           # the driver. This is the thing you run.
    Get-ForgeTasks.ps1              # TASKS.md -> task objects
    Invoke-ForgeTask.ps1            # one task: prompt, claude, DoD, review, propose
    Test-ForgeDoD.ps1               # runs a task's acceptance command(s)
    New-ForgeProposal.ps1           # branch + commit + change record (ChangeHost = LocalGit at W0)
    Write-ForgeCheckpoint.ps1       # wave-boundary artefact generator
    forge-build.config.psd1         # model names, CLI flags, paths, limits
  .forge-build\                     # NOT committed (.gitignore'd)
    state.json                      # per-task status, attempts, model used, commit sha, timings
    interventions.csv               # checkpoint agenda item 6 feed
    HALTED                          # sentinel: reason + exit code, written on any stop
    NEEDS-DECISION-<taskId>.md       # what a human must decide, one file per gate
    logs\<taskId>\<attempt>\
      prompt.txt  stdout.jsonl  diff.patch  dod.txt  review.md
```

### 3.3 The backlog format the parser reads

Each task in `TASKS.md` is a single checkbox line plus an indented metadata block. This is deliberately readable by a human scanning the file *and* parseable by a ten-line regex:

```markdown
- [ ] **W0-F1** — Two-phase confirm state machine and HMAC-bound confirm token
  - model: opus
  - deps: W0-C3, W0-E3
  - wave: 0
  - reads: 02_TECHNICAL_ARCHITECTURE.md#3.1.1, #3.1.2
  - touches: core/gateway/policy/confirm/**
  - done: `pnpm -C core/gateway test confirm` passes, and `pnpm test:policy -- --grep "argument mismatch"` proves a plan token is refused when any argument changes between plan and execute.
```

Rules the parser enforces, and it **fails the whole run at parse time** rather than at task time if any is broken: a task id matching `^W\d+-[A-Z]+\d+$`; `model` in `{opus, sonnet}`; every id in `deps` exists; `wave` is an integer; `done` is non-empty and contains at least one backticked command. Human-gate tasks use `model: human` and carry `gate:` instead of `done:`.

### 3.4 `Invoke-ForgeBuild.ps1` — the loop

```powershell
param(
  [int]    $Wave           = 0,
  [int]    $MaxTasks       = 0,       # 0 = run the whole wave
  [switch] $DryRun,                   # print the plan, invoke nothing
  [switch] $StopOnFirstFailure,
  [int]    $AcknowledgeWave = -1,     # explicit human ack to cross INTO this wave
  [string] $Only                      # run one task id, e.g. W0-F1
)

$ErrorActionPreference = 'Stop'
$cfg   = Import-PowerShellDataFile "$PSScriptRoot\forge-build.config.psd1"
$state = Get-ForgeState $cfg.StatePath          # creates on first run
$tasks = & "$PSScriptRoot\Get-ForgeTasks.ps1" -Path $cfg.TasksPath   # parse-time validation

Assert-CleanWorktree                            # refuse to start on a dirty tree
Assert-WaveAcknowledged -State $state -Wave $Wave -Ack $AcknowledgeWave

while ($true) {
  $task = Select-NextTask -Tasks $tasks -State $state -Wave $Wave
  # Select-NextTask returns the first task that is: not done, in $Wave,
  # all deps 'done', and not 'needs_human' / 'blocked'.

  if (-not $task) {
      if (Test-WaveComplete -Tasks $tasks -State $state -Wave $Wave) {
          Write-ForgeCheckpoint -Wave $Wave -State $state -Tasks $tasks
          Halt -Code 10 -Reason "WAVE_BOUNDARY: wave $Wave complete. Checkpoint written."
      }
      Halt -Code 12 -Reason "NO_RUNNABLE_TASK: remaining work is blocked or needs a human."
  }

  if ($task.Model -eq 'human') {
      Write-NeedsDecision $task
      Halt -Code 11 -Reason "HUMAN_GATE: $($task.Id) requires a decision before the lane continues."
  }

  $result = & "$PSScriptRoot\Invoke-ForgeTask.ps1" -Task $task -Config $cfg -State $state

  Set-TaskState $state $task.Id $result
  Save-ForgeState $state $cfg.StatePath          # after EVERY task — resumability

  if ($result.Status -eq 'needs_human') {
      Add-Intervention $task $result             # feeds checkpoint agenda item 6
      if ($StopOnFirstFailure) { Halt -Code 13 -Reason "TASK_FAILED: $($task.Id)" }
      continue                                    # surface it, keep going
  }

  if ($MaxTasks -gt 0 -and (Count-Completed $state $Wave) -ge $MaxTasks) {
      Halt -Code 0 -Reason "MAXTASKS reached."
  }
}
```

### 3.5 `Invoke-ForgeTask.ps1` — what one task actually does

Eight steps. Steps 4–6 are the definition-of-done gate; nothing is proposed until all three pass.

1. **Compose the prompt.** A fixed preamble (read `CLAUDE.md`; you are implementing exactly one task; do not start the next one) plus the task's own block plus the `reads:` pointers resolved to absolute paths into `build-plan\`, plus, on a retry, the previous attempt's failure output. Written to `logs\<id>\<n>\prompt.txt` so every run is auditable.
2. **Pick the model.** `$task.Model`, then overridden to `opus` if (a) this is the escalation attempt, or (b) any `touches:` glob intersects `OPUS_GUARDED_PATHS`.
3. **Invoke Claude Code**, headless, from the repo root:
   ```powershell
   $args = @(
     '-p', $promptText,
     '--model', $cfg.Models[$model],
     '--output-format','stream-json','--verbose',
     '--permission-mode','acceptEdits',
     '--add-dir', $cfg.BuildPlanDir
   )
   $p = Start-Process claude -ArgumentList $args -NoNewWindow -PassThru `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr
   if (-not $p.WaitForExit($cfg.TaskTimeoutSeconds * 1000)) { $p.Kill(); return Fail 'TIMEOUT' }
   ```
   *(Verify these flags once against `claude --help` on your machine before the first real run and pin whatever is correct into `forge-build.config.psd1`. The flag surface is the one part of this design most likely to have moved.)*
4. **Run the repo-wide gates:** `pnpm lint && pnpm typecheck && forge validate && forge codegen && git diff --exit-code generated/`. These are Phase 2 §7.2 stages 1–3 and they apply to *every* task, not only codegen tasks — the regen-diff gate is how a manifest edit's blast radius stays honest.
5. **Run the task's own `done:` command(s)**, captured to `dod.txt`. Non-zero exit = failure, with the output fed back into the retry prompt.
6. **Run `engineering:code-review`** on the staged diff, with the **eight** `CLAUDE.md` non-negotiables passed in explicitly — *SUPERSEDED by §7.4, Phase 5, 27 Aug 2026: was "four," corrected to eight.* A `blocking` finding is treated as a DoD failure and fed back like one.
7. **Propose.** `New-ForgeProposal.ps1` creates `forge/<taskId>-<slug>`, commits with a message naming the task id and the exit criterion it serves, and — because Wave 0 is local-git-only — writes a review record rather than calling a hosted API. When a remote is configured later, the same script pushes and opens a PR; nothing above it changes.
8. **Record.** Status, model used, attempt count, wall time, token cost if the CLI reports it, commit sha, and the DoD output path, into `state.json`.

**Attempt policy, in full:** attempt 1 on the declared model → attempt 2 on the declared model with attempt 1's failure attached → attempt 3 on Opus with both failures attached → `needs_human`. Three attempts, hard stop, no exceptions. A `needs_human` task writes `NEEDS-DECISION-<id>.md` containing the task block, all three failure outputs, and the last diff — so the human is reading a bug report, not archaeology.

### 3.6 How it pauses at a wave boundary — the part that matters most

Three mechanisms, and all three must be satisfied before the lane can build a single Wave 1 task:

1. **`Select-NextTask` is wave-scoped.** It never returns a task whose `wave:` differs from the run's `-Wave`. Wave 1 tasks are simply invisible to a Wave 0 run. This is the structural half — crossing the boundary is not something the driver can do by accident, because it cannot see across it.
2. **On wave completion the driver writes the checkpoint artefact and halts with exit code 10.** `Write-ForgeCheckpoint.ps1` generates `build-plan\WAVE_0_CHECKPOINT.md` pre-filled with everything the driver already knows, so the human is editing a draft rather than facing a blank page:
   - **Agenda item 1** — each of Phase 1 §7's thirteen Wave 0 exit criteria, listed verbatim, each with the task ids that were supposed to satisfy it and their final state, and an empty `verdict:` field per criterion for the human.
   - **Agenda item 2** — the latest `forge bench --json` output: TTFC (core-hit and core-miss separately), VTC, DH, SA@1, MTB, plus contract-test pass rate and probe resolution rate.
   - **Agenda item 6** — the intervention log, straight from `interventions.csv`: every task that needed a human, its cause category, and the unassisted-completion percentage, which is Wave 0 exit criterion 13.
   - **Agenda item 8** — wall time and, where the CLI reported it, token cost per task and per track.
   - **Items 3, 4, 5, 7** — headed sections with their questions, left for the human. These are judgment, and the driver says so rather than guessing.
   - At the very top: `verdict: <PROCEED | RESEQUENCE | STOP-AND-FIX>` — **unfilled**.
3. **Crossing in requires two independent human acts.** `Assert-WaveAcknowledged` refuses to start a Wave *N* run unless **both** (a) `build-plan\WAVE_<N-1>_CHECKPOINT.md` exists with a filled, recognised `verdict:` line, and (b) the operator passed `-AcknowledgeWave <N>` on the command line. Two acts, because either one alone is too easy to do reflexively. If the verdict is `STOP-AND-FIX`, the driver refuses regardless of the flag and prints the remediation wave's absence as the reason.

**In-wave human gates work the same way at smaller scale.** A `model: human` task halts with exit code 11 and a `NEEDS-DECISION-<id>.md`. Wave 0 has seven of these (§4 of `TASKS.md`) — the JDE instance confirmation, the validate-pair orchestration owner, the server-density call, the house-component-library question, the score-floor calibration sign-off, the eleven per-tool governance approvals, and the steward-authored eval intents. **These are not failures.** They are the named decision points Phase 2 §8.2 asked Phase 4 to make explicit, and hitting one means the plan is working.

### 3.7 Exit codes — so the operator can tell a stop from a stall

| Code | Meaning | What the human does |
|---|---|---|
| `0` | Run finished as asked (`-MaxTasks`, `-Only`, or nothing left in scope) | Nothing, or run again |
| `10` | **Wave boundary.** Wave complete, checkpoint drafted | Run the checkpoint, fill the verdict, then `-Wave 1 -AcknowledgeWave 1` |
| `11` | **Human gate.** A `model: human` task is next | Read `NEEDS-DECISION-<id>.md`, decide, tick the box, re-run |
| `12` | **No runnable task.** Everything left is blocked or `needs_human` | Read the failure digest; unblock something |
| `13` | Task failed and `-StopOnFirstFailure` was set | Read `NEEDS-DECISION-<id>.md` |
| `20` | **Parse error in `TASKS.md`** — a bad dep, a missing `done:`, an unknown model | Fix the backlog. Nothing ran. |
| `21` | Dirty worktree at start, or a gate command is missing | Clean up, then re-run |

Every halt also writes `.forge-build\HALTED` with the code, the reason and the timestamp, so a second terminal (or a scheduled task) can tell at a glance whether the lane is working or waiting.

### 3.8 Typical operator session

```powershell
cd C:\GenAIGenerated\LTM\MCP\MCPForge

# See the plan without invoking anything. Do this first, every time the backlog changes.
.\tools\build\Invoke-ForgeBuild.ps1 -Wave 0 -DryRun

# Build the first few tasks and inspect the result before letting it run long.
.\tools\build\Invoke-ForgeBuild.ps1 -Wave 0 -MaxTasks 5

# Then let it run the wave.
.\tools\build\Invoke-ForgeBuild.ps1 -Wave 0

# ... it halts on exit code 11 at W0-HG2 (the validate-pair owner).
# Read .forge-build\NEEDS-DECISION-W0-HG2.md, name the steward, tick the box, continue:
.\tools\build\Invoke-ForgeBuild.ps1 -Wave 0

# ... it halts on exit code 10. Wave 0 is built.
# Run the checkpoint against build-plan\WAVE_0_CHECKPOINT.md, fill in the verdict, then:
.\tools\build\Invoke-ForgeBuild.ps1 -Wave 1 -AcknowledgeWave 1
```

### 3.9 What this design deliberately does not do

- **No parallel task execution at Wave 0.** Two Claude Code sessions editing one worktree is a merge problem nobody needs while the foundations are being laid. Parallelism becomes worth revisiting at Wave 2, when the work is many similar tool manifests in disjoint directories — and the right shape then is one git worktree per track, not one repo shared by two sessions.
- **No unattended overnight running before the first checkpoint.** Run it while you can watch it until you have seen a full wave's failure modes. After that, the exit codes and `HALTED` make unattended running reasonable within a wave.
- **No auto-merge.** Every task produces a proposal. Merging is a human act at Wave 0, which is also what makes Phase 1 exit criterion 8 ("every tool has an approval record") true rather than notional.
- **No self-modification of `TASKS.md` by the lane.** A Claude Code session may *propose* backlog changes in its output, and the driver logs them, but the file is edited by a human. A backlog that rewrites itself is a plan that cannot be trusted at the checkpoint.

---

## 4. The task backlog

**Wave 0 is fully broken down in `C:\GenAIGenerated\LTM\MCP\MCPForge\TASKS.md`** — 96 tasks across 13 tracks, each with an id, a one-line description, a recommended model, its dependencies and a concrete acceptance criterion, formatted so both a human and the PowerShell lane can read it as a checklist.

> **EXTENDED by §7.3 — Phase 5, 27 Aug 2026 (not one of 05's itemized markers; corrected here so the task count agrees everywhere it appears).** 111 tasks across 14 tracks, following track N's addition.

**Waves 1–5 are summarised below and deliberately not broken down.** Phase 1 §6 makes wave-boundary re-planning a mandatory step, and item 5 of its checkpoint agenda is an *explicit re-vote* on whether the planned next wave is still the right next wave. Writing a 400-task Wave 1–5 backlog now would produce a plan that is wrong in ways nobody can yet see and that would quietly resist being changed at the checkpoint. **Each wave's backlog is written at that wave's own checkpoint, from this section plus what Wave *N-1* actually taught.**

### 4.1 The shape of Wave 0 — what the 96 tasks add up to

| Track | Tasks | Model mix | What it delivers |
|---|---|---|---|
| **A** Foundations | 7 | mostly sonnet | Repo, workspaces, CI-runnable-locally, lint rules, shared types, `forge` CLI skeleton, seed extraction |
| **B** Manifest + codegen | 9 | opus-heavy | The `mcpforge/v1` schema, ~40 validate rules, deterministic codegen, the three-file split, role compilation, the regen-diff gate |
| **C** State layer (SQLite) | 6 | opus-heavy | Drizzle dual-dialect schema, audit + hash chain + immutability triggers, idempotency/nonce, `forge audit verify`, Postgres parity test, the "delete the store and everything still works" test |
| **D** Identity | 4 | opus + sonnet | `IdentityProvider`, local user store, OIDC provider, dual-provider contract test, group→role mapping |
| **E** Gateway | 8 | opus-heavy | MCP endpoint, scope resolution, the ordered fail-closed policy chain, error taxonomy, kill switch, caps, OTel, the only-door refusal test |
| **F** Write safety | 7 | **all opus** | Two-phase confirm, canonical arg hash, idempotency replay, guardrails + SoD, reversal registry, approval gate, the four exit-criterion-7 demos |
| **G** Discovery | 7 | mixed | Index build, BM25 + boosts + fusion, score floor and `no_tool`, the four meta-tools, token budget gates, `forge bench`, the five metrics + regression gate |
| **H** Bindings + probe | 6 | opus-heavy | `function` executor, validate-pair dry run, identity echo, probe orchestrator, `whoami` check + auto-disable, offline mock harness |
| **I** The 11 tools | 6 | mixed | 3 server manifests + the P2P role + the package; 5 read tools; 6 write tools in three paired tasks |
| **J** Portal | 21 | sonnet-heavy | Phase 3 §13.7's ten steps, with the write-path family pulled forward, then the nine routes and the five a11y gates |
| **K** Packaging | 5 | sonnet | `forge package`, headless mode, overlay purity, local Docker stack, `forge slice-diff` at file-hash level |
| **HG** Human gates | 7 | human | The named decision points |
| **M** Carried backlog | 3 | sonnet | Deck reconciliation (R10), memory correction (R3), the stale console file |

> **EXTENDED by §7.3 — Phase 5, 27 Aug 2026.** A fourteenth track, **N — Consumer governance, access control and credentials** (14 tasks), and an eighth human gate (`W0-HG8`) join the backlog. `TASKS.md` carries the full breakdown.

**Sequencing note that matters more than any other:** the **F track (write safety) is scheduled before the I track (tool volume)**, exactly as Phase 1 §10.5 item 7 instructed, and the **write-path portal family (`W0-J9`) is pulled forward** ahead of DataTable, the command palette and every route, exactly as Phase 3 §14's closing note argued. The consequence is that the least visually impressive part of the portal is built first and the Catalog — the page anyone would demo — comes later. That is correct and it will feel wrong around week three. Do not reorder it.

### 4.2 Waves 1–5 — summarised, to be broken down at each checkpoint

Content, tool counts and the claim each wave proves are Phase 1 §4.2 and are not restated. What follows is only what Phase 4 adds: **the shape of the work**, the new architectural machinery each wave needs, and where the model routing shifts.

#### Wave 1 — provisioning-only breadth (11 → 53 tools, `saas-fin` + `analytics` + OIC)

- **The big new build:** the `rest` binding executor with **OAuth 2.1 token exchange (RFC 8693)** per Phase 2 §3.2 — **Opus**, Test 2, no argument. This is the first binding type where identity genuinely carries end to end, and the token cache keyed on `(subject, resource, scopeSet)` is a security artefact. Alongside it: the `database` binding executor and the **Python Oracle Adapter Worker**'s first real use (Opus for the signed-binding-descriptor contract and the read-only cage; Sonnet for the FastAPI plumbing), and the `wrapped-vendor` client with its **surface-drift diff** at probe time (Opus — an unclassified vendor write tool must never silently become available).
- **The hard gate:** all five G5 metrics at ~53 tools. If SA@1 lands below 90% on the lexical channel, the **embedding channel** switches on (Phase 2 §5.4.3) — an in-process ONNX task, Opus for the retrieval-fusion change, Sonnet for the vector precompute in codegen. **Do not build it speculatively in Wave 0.**
- **The proofs D1 waits on:** P1 (`forge slice-diff` promoted from file hashes to signed image digests — needs the container-registry answer), P2 (a slice in a second environment), P4 (headless, already exercised from Wave 0 as a CI matrix entry).
- **The identity swap:** `OidcProvider` against LTM AD goes live. Because both providers were contract-tested in Wave 0 (`W0-D3`), this is a configuration task, not a rewrite — Sonnet, with `forge identity remap` as the one Opus piece.
- **The likely datastore moment:** if Wave 1 introduces more than one gateway instance or a shared CoE instance, this is where **SQLite → Postgres** happens. Phase 2 §10.4 items 1, 6 and 7 are the trigger list. Opus, and it is an ADR.
- **Routing shift:** roughly 25% Opus. The foundations exist; most of Wave 1 is applying them to new binding types.

#### D1 — the commercial decision gate (not a build wave)

No tasks. Convenes immediately after the Wave 1 checkpoint, needs P1–P5, and is decided by the user and whoever owns commercial strategy. **Wave 2 must be startable regardless of its outcome or its delay** (Phase 1 §5), so no Wave 2 task may declare a dependency on it. Its outputs become constraints recorded as a decision record in `build-plan\`.

#### Wave 2 — EBS lands (53 → 80 tools, `ebs-p2p` + JDE remainder + PS Query)

- **The hardest security surface in the estate**, and the wave with the highest Opus share of any after Wave 0. The `plsql` binding: the `MCPFORGE_WRAP` wrapper-schema generator, the `AUTHID DEFINER` grant model, `FND_GLOBAL.APPS_INITIALIZE` / `MO_GLOBAL.set_policy_context` from the git-managed identity mapping, and — the one that Phase 2 §3.4 calls the most damaging mistake available — the `PROBE_COMMIT_BEHAVIOUR` classification that decides whether savepoint dry-run is even legal. **All Opus. Do not economise here.**
- **New CI gate:** the assertion that the MCPForge database user holds `EXECUTE` on the wrapper and **no grant at all** on any `APPS`-owned object. That assertion *is* Wave 2 exit criterion 2.
- **New ongoing job:** the wrapper `CALL_LOG` ↔ gateway audit **reconciliation**, which is the practical test of "the gateway is the only door" for the PL/SQL surface.
- **Cheap volume alongside it:** PS Query read-only tools need no development and are pure Sonnet manifest work — deliberately scheduled next to the hardest work in the programme so the wave is not uniformly expensive.
- **Resequencing trigger:** if the EBS enablement track (opened in Wave 0 as paperwork) is not visibly progressing at the Wave 1 checkpoint, PeopleSoft is promoted and EBS slips to Wave 3. That call belongs to the checkpoint, not to the backlog.

#### Wave 3 — cross-application process slice (80 → 101 tools, `svc-field` + PeopleSoft remainder)

- Proves a package bounded by **process, not product** — two applications, one deployment. Mostly application of existing machinery; the new work is Siebel business-service identity verified **per method, not per application** (Opus, it is the `function`-binding rule at the right granularity) and the ASF/OpenAPI harvest path (Sonnet).
- **Governance becomes unbypassable** (M2): no production path puts a tool live without an approval record, demonstrated by an attempt that fails the deployment. Security-anomaly monitoring goes live. Kill switch proven at all four granularities.
- Autonomy target ≥85%: adding a tool to an already-enabled application should be a routine Sonnet task by this point. **If it is not, that is the finding**, and checkpoint agenda item 6 is where it gets diagnosed.

#### Wave 4 — the deepest legacy surface (101 → 129 tools, EBS remainder + Hyperion/Essbase + EPM Cloud)

- MaxL / CalcScript / LCM wrapping — Phase 2 §1.3 item 4 already flagged that this is where the **Python worker's `subprocess`/`pexpect` story** earns its place, so it is not a discovery. The execution identity of the wrapper host is the estate's weakest identity story and must be explicitly documented and constrained per tool: **Opus, and it is the wave's headline risk.**
- Essbase 21c REST paths must be distinguished from wrapped paths in the manifests, and only REST paths may be marked identity-carrying.
- All five binding types must by now have a documented, implemented, tested handshake template. This wave closes the last one.
- First **G9 retirement pass**: every tool live since Wave 1 with zero calls gets a retire-or-justify decision. Sonnet work, human decision.

#### Wave 5 — completion and hardening (129 → 150 tools, 42 servers)

- Fusion remainder, Commerce, Sales Cloud, CPQ — almost entirely Sonnet manifest work by this point, which is what G8's M3 target ("adding a whole module server is a routine autonomous task") actually means in practice.
- **Server-density remediation** (R4) finally executes here, but the *decision* is needed far earlier — before GL, AR and Inventory are built.
- The published numbers: SA@1 ≥95%, scaling invariant at 150 tools, tokens-per-successful-action versus naive (target ≤25%; Phase 2 §5.7's arithmetic suggests 5–6%, and the headroom should be reported honestly rather than banked), gateway p95 added latency <150 ms, zero permanently dark tools, and the percentage of the catalogue with a real consumer — **reported honestly whatever it is** (G9/R12).

### 4.3 The single highest-risk item in Wave 0

`W0-H2` — **the validate-pair dry-run dispatch**. Not because the code is hard, but because it is the one Wave 0 task whose success depends on something the build lane cannot produce: **six `*_VALIDATE` sibling JDE orchestrations, authored by a named human steward, in week one.** Phase 2 §10.5 item 2 introduced this dependency and Phase 2 §9's closing note calls it *"the most likely quiet failure in this plan."*

If those pairs do not exist, `dryRun.strategy` degrades to `precondition-read` for the affected tools, `humanApprovalRequired` is forced to `true` for anything `financial`, and Wave 0 ships a materially worse product while still technically passing most of exit criterion 7. **That is exactly the kind of quiet degradation the checkpoint is meant to catch and the backlog is meant to prevent** — which is why it is a `model: human` gate (`W0-HG2`) that **halts the lane**, positioned before the write tools rather than discovered during them.

---

## 5. What the user should settle before running Claude Code against this

Ordered by what blocks soonest. The first four are the ones worth answering this week.

1. **Name the owner of the six `*_VALIDATE` JDE orchestrations** (`W0-HG2`). See §4.3. This is the one that quietly ruins Wave 0.
2. **Confirm the JDE instance** — AIS Server deployed and reachable, Orchestrator Studio on the Tools release in use (R13, `W0-HG1`). If it is not confirmed within week one, Phase 1 §4.1's pre-declared contingency fires: swap Wave 0 and Wave 1, build `saas-fin` as the reference, and **carry the `function`-binding identity question and the cross-module role into Wave 1 without dropping them.** That is a decision to *execute*, not to reopen.
3. **Confirm there is no LTM house React component library** (ARIA / MORPHED / DEXA or elsewhere) before `W0-J4` runs. This session's instruction is that none exists and shadcn/ui stands — one sentence of confirmation makes it settled rather than assumed, and it is the cheapest possible check against building the portal twice.
4. **Verify the Claude Code CLI flag surface** in §3.5 step 3, and check whether `/ui-ux-pro-max` is actually installed in your local CLI (§2.3). Both are five-minute checks that prevent a first run failing for a boring reason.
5. **Server density (R4)** — top up GL and AR, merge Inventory into Procurement, per Phase 2 §4.7's recommendation. Needed **before those servers are built** (Waves 2 and 5), not at Wave 5, but worth deciding now while it is in view.
6. **Sanity-check the datastore correction** — Phase 2 §10, particularly §10.4 item 1 (audit immutability is detectable, not preventable, on SQLite) and item 6 (no multi-replica gateway at Wave 0). Both are acceptable Wave 0 limitations; both would be dishonest to leave unstated in a demo.
7. **Confirm the stale console file's disposition** — `mcpforge-console og.html` (Rev 2) is two revisions behind the canonical `mcpforge-console_1.html` (Rev 4). Archive or delete (`W0-M3`), and correct the Rev 4 build spec's header text, which still claims the no-suffix file is canonical (`W0-M2`, the R3 memory correction).
8. **Carried, not forgotten: the deck** (R10, `W0-M1`). `MCPForge_Concept_3.pptx` reflects none of Rev 3 or Rev 4, and it now also contradicts the architecture on two points the architecture can finally answer: **SoD in process roles** (Phase 2 §4.3 makes it a mechanism, not an acknowledgement) and **latency** (Phase 2 §4.8 gives a per-stage budget). Not a build blocker; a live communications risk.

**Not blocking, deliberately:** D1's four commercial sub-questions. No build wave depends on them and none may be made to.

---

## 6. Where planning ends

This is the last planning phase. The four documents in `build-plan\` are the plan; `MCPForge\CLAUDE.md` is what every build session reads first; `MCPForge\TASKS.md` is what the lane executes. From here the work is building, and the next document that gets written is `build-plan\WAVE_0_CHECKPOINT.md`.

One thing worth saying plainly at the end of four phases of planning: **the plan's own honesty mechanisms are the most valuable thing in it.** The probe that refuses to assume identity carries. The regen-diff gate that makes a manifest change's blast radius visible. The compiled role scope that makes silent widening impossible. The hash chain that makes audit tampering detectable even on a file anyone can open. The benchmark's negative cases that score a plausible wrong answer as a failure. The checkpoint that defaults to STOP-AND-FIX when its own agenda cannot be completed. Every one of them exists to make a specific comfortable lie impossible to tell. **If Wave 0 has to be trimmed, trim tools and trim screens — never trim one of those.**

---

---

## 7. Correction applied by Phase 5, per user direction, 27 Aug 2026 — routing and skills for the consumer/access-control/credential work

### 7.1 What changed and where

`05_GOVERNANCE_ACCESS_CONTROL_AND_CREDENTIALS.md` is the design for consumer registration, binding-type authorization, usage governance and credentials. `01` §11 and `02` §11 carry the goal and architecture corrections; `03` §16 carries the UX; `TASKS.md` Track N carries the backlog.

### 7.2 The routing rule applied to the new work

| Task shape | Test that fires | Model | Why |
|---|---|---|---|
| `kind: Consumer` record model + `forge consumer` CLI (`W0-N1`) | 1 | **Opus** | The registration flow is the front door; a bad shape here is a governance hole that widens silently. |
| Consumer authentication + DCR structurally disabled (`W0-N2`) | 2 | **Opus** | Getting step `[2a]`'s ordering or the DCR refusal wrong reopens the exact ingress hole this correction closes. |
| Binding-authorization stage `6e′` + elevated-posture rules (`W0-N3`) | 2 | **Opus** | Inserting a stage into an ordered fail-closed chain — an ordering mistake is an authorization bypass. |
| `standingAuthorization` record, expiry, enforcement (`W0-N4`) | 2 | **Opus** | The hinge that keeps the elevated posture implementable; get the expiry-vs-removal boundary wrong and the gate is either broken or decoration. |
| `SecretStore` + `SecretRef` + two implementations (`W0-N5`) | 1 | **Opus** | The third pluggable seam; a wrong contract here is a rewrite across every adapter later. |
| `forge secrets`: status, dual-key rotation, one-act revocation (`W0-N6`) | 2 | **Opus** | The confirm-token HMAC dual-key overlap is exactly the kind of subtlety a missed test does not catch — get it wrong and rotation becomes a self-inflicted outage. |
| `consumer_usage` rollups + quota enforcement (`W0-N7`) | 3 | Sonnet 5 | A rollup of data already being written, against an existing tighten-never-loosen pattern. |
| `anomaly_event` schema + detector interface (`W0-N8`) | 1 | **Opus** | The Wave 3 monitoring product conforms to this schema — a schema mistake here is a Wave 3 rewrite. |
| The three Wave 0 detectors (`W0-N9`) | 3 | Sonnet 5 | Declarative detectors against a fixed interface, checked by fixtures. |
| Consumer-scoped audit wiring + consumption-edge feed (`W0-N10`) | 3 | Sonnet 5 | Wiring an existing column set to an existing satellite. |
| `forge dev` local bootstrap self-registration (`W0-N11`) | 2 | **Opus** | Small task, expensive failure mode: silent self-registration in production is Test 2 exactly. |
| Portal: Governance → Consumers (`W0-N12`) | 1 | **Opus** | Same reason `W0-J17` (roles editor) is Opus: an editor that hides what a consumer may actually reach is the identical failure. |
| Portal: Activity → Consumers (`W0-N13`) | 3 | Sonnet 5 | A filtered view over an existing table pattern. |
| Exit-criterion-14 demonstrations as tests (`W0-N14`) | 3 | Sonnet 5 | The tests assert behaviour already specified elsewhere; they are checkers, not designers. |

### 7.3 The revised Wave 0 split

**111 tasks, 43 Opus / 60 Sonnet / 8 human**, with the new track N (14 tasks) and the eighth human gate (`W0-HG8`). The Opus share rises because Phase 5's additions sit almost entirely on the security spine, which is the correct place for it to rise and the wrong place to economise.

### 7.4 Skills

- **`engineering:code-review`** now carries **eight** non-negotiables, three of them new. The two new access-control rules are exactly the kind a test does not catch: a stage inserted in the wrong position in an ordered chain still passes every unit test, and a `SecretStore.get()` called one layer too high still returns the right value.
- **`engineering:architecture`** gains a Wave 0 ADR: *the consumer as a second principal, and why authorization is the intersection rather than the union.* This is checkpoint agenda item 3 material and it is the decision most likely to be misread later.
- **`design:ux-copy`** gains the four new refusal strings (03 §16.6) — and specifically the `CONSUMER_NOT_AUTHORIZED` / `TOOL_NOT_IN_SCOPE` distinction, which is a copy problem with a support cost, exactly the class §2.2 already flags for the `planTemplate`.

### 7.5 One sequencing instruction that is not negotiable

**`W0-C2` must carry the consumer and credential-ref columns before it is marked done.** A later migration puts a schema discontinuity in the audit hash chain, and the hash chain is the only integrity mechanism Wave 0 has on SQLite (02 §10.4 item 1). Track N's tasks depend on `W0-C2` as amended, not on a follow-up.

*Correction applied by Phase 5, per user direction, 27 Aug 2026.*

---

*MCPForge · BlueVerse ValueMesh · LTM Oracle AI Practice. Phase 4 of 4 — autonomy, model routing, skills and the build lane. Companion to `01_GOALS_AND_ROADMAP.md`, `02_TECHNICAL_ARCHITECTURE.md` and `03_UX_DESIGN_SYSTEM.md`; supersedes nothing in them except Phase 2 §1.5 / §1.6 / §9 item 4, where Phase 2's own new §10 says so. The concept-console build spec remains authoritative for the demo artefact only.*
