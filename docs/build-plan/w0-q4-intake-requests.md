# W0-Q4 — Business Intake as a tracked request: design note

**Status: DRAFT for owner review. No code until this is approved.** W0-Q5 builds exactly what the approved version says.
Drafted 6 Oct 2026 on a Sonnet session although the task is routed to Opus (it fixes a file format). Treat the recommendations as a first pass and say so if the routing matters to you.

Reads: 02 §2.5, §5.4 · 03 §5.2, §5.3, §6.1 · 01 §2 and G4 · CLAUDE.md §2, §3.1, §8.

## 0. Two things found while writing this

1. **The task text cites the wrong goal.** It says the dedupe gate is "G1 @ M1". In `01_GOALS_AND_ROADMAP.md` G1 is *Manifest is the source of truth*. Duplicate detection at intake is **G4 M1** (§2, line 92: *"blocks a submission scoring above the similarity threshold from reaching review without a merge-or-justify decision"*). This note uses G4 M1.
2. **There are two different "six questions".** The task lists *what should it do · which app and module · read or write · what the user supplies · what a good answer looks like · who may run it*. 03 §5.3 lists *owner · steward · sensitivity · process tag · expected volume · write or read*, and the existing `RequestIntakeAnswers` type follows 03. They overlap only on read/write. §2 below resolves this by treating them as two halves of one record: a **business half** (the requester) and a **governance half** (the triager).

## 1. (a) Where a request lives

**Recommendation: a git artefact, `requests/<requestId>.request.yaml`**, written through `ChangeHost` like every other portal write. `requests/` is a new top-level directory beside `manifests/`, `roles/`, `consumers/`.

- `requestId` = `req-<YYYYMMDD>-<slug-of-ask>`, immutable (same rule as tool and consumer ids; a withdrawn request is never reused).
- `forge validate` gains a `Request` kind (`apiVersion: mcpforge/v1`). A request is **not** a manifest: it grants nothing, binds nothing, is never read by codegen or the gateway, and never appears in `generated/`.
- **Status is derived, not stored**, except the two terminal states that have no other artefact (`declined`, `withdrawn`), which are stored with a reason. Everything else comes from artefacts that already exist (§3). This avoids storing a state a second time that can then disagree with the change it describes.

File shape (illustrative; the schema is a W0-Q5 deliverable):

```yaml
apiVersion: mcpforge/v1
kind: Request
id: req-20261006-search-ap-vouchers
requestedBy: <Principal.subject>          # never defaulted (non-negotiable 1)
requestedAt: 2026-10-06T10:00:00Z
ask: "search AP vouchers for a supplier by amount"
business:                                  # requester's half
  does: ...
  app: jde
  module: ap
  access: read                             # read | write
  inputs: [supplier_number, amount_from]
  goodAnswer: "a list of vouchers with number, date, amount, status"
  whoMayRun: "AP clerks and AP supervisors"
verdictAtSubmit:                           # snapshot, see §5
  tier: near_miss
  indexDigest: sha256:...
  matches: [{ toolId: jde.ap.voucher.search, score: 11.3 }]
  decision: { kind: justify, text: "..." } # merge-or-justify, only when above threshold
governance:                                # triager's half; absent until triage
  owner: JDE Finance CoE
  steward: ...
  sensitivity: financial
  processTag: P2P
  expectedVolume: "~200/day"
  intendedToolId: jde.ap.voucher.search_by_amount
  server: jde-fin-ap
closed: { state: declined, by: <subject>, at: ..., reason: "..." }   # only declined/withdrawn
```

**Alternatives rejected.** *The runtime store* (`.mcpforge/runtime.db`): breaks the portal-writes-to-git rule and `rm -rf .mcpforge/` would erase business requests (W0-C6: only events live in the store). *A manifest field*: `x-request` on tools would be a schema change with a blast radius, and a request exists before any tool does.

**Owner decision needed (D1): does recording a request need review?** A request grants nothing, so an approval record seems disproportionate, but the portal never writes `main` directly either. Recommendation: submit = `ChangeHost.saveDraft` + propose with **no approval record required**, and the triager's merge is the act that makes it `triaged`-eligible. Until merged, the requester sees it as `submitted` (derived from the open change proposal). If you would rather requests commit straight to the default branch, that needs a `ChangeHost` operation that does not exist today and is a separate task.

## 2. (b) The questions, and one schema with `forge new tool`

`forge new tool` takes `NewToolAnswers` (W0-Q6). Intake feeds it; it does not get a parallel schema.

| Question | Half | Request field | Becomes in the manifest |
|---|---|---|---|
| What should it do | business | `business.does` | a *hint* for `purpose`, never copied verbatim: `purpose` is human copy under a 14-word budget |
| Which app and module | business | `business.app/module` | `id` prefix, `app`, `module` |
| Read or write | business | `business.access` | `write` (and with `write`, the whole `writeSafety` skeleton) |
| What the user supplies | business | `business.inputs` | draft `input[]` names; types and descriptions stay human |
| What a good answer looks like | business | `business.goodAnswer` | hint for `output.summaryTemplate` and a **seed for eval intents** (see §6: stewards own the evals) |
| Who may run it | business | `business.whoMayRun` | **nothing automatic.** It is advice for the role editor. A role grant is a separate git change with its own approval (grants are never inferred) |
| Owner · steward | governance | `governance.owner/steward` | `governance.owner`, `governance.steward` |
| Sensitivity | governance | `governance.sensitivity` | `sensitivity` |
| Process tag | governance | `governance.processTag` | `processTags` |
| Expected volume | governance | `governance.expectedVolume` | none; request-only. May later inform a `rateLimit` guardrail suggestion |
| (assigned at triage) | governance | `intendedToolId`, `server` | `id`, `server` |

**Consequence for W0-Q6:** the scaffolder's `NewToolAnswers` needs `processTags` and `inputs` (names). Neither exists today. W0-Q5 adds them to the one scaffolder, not to a second one. The scaffolder keeps emitting `REPLACE…` placeholders for the human-only fields.

## 3. (c) Forward links and derived status

The only link that is **stored** is the one that cannot be derived: `intendedToolId` (set at triage). Everything downstream joins on it.

| Derived state | True when (all from existing artefacts) |
|---|---|
| `submitted` | an open change proposal adds the request file, or the file is on the default branch with no `governance` block |
| `triaged` | `governance` block present with `intendedToolId` and `steward` |
| `drafted` | a change proposal whose branch is named `forge/<requestId>-…` or whose diff adds `manifests/**/<intendedToolId>…`, state `draft` |
| `in_review` | that proposal's `ChangeState` is `proposed`/`in_review` (03 §6.1 vocabulary, not a new one) |
| `merged` | the manifest exists on the default branch **and** an approval record under `approvals/` names `intendedToolId` |
| `enabled` | `generated/index` lists the tool **and** the latest probe report does not say `disabled_*` for it (03 §5.3: merged is not delivered) |
| `declined` / `withdrawn` | stored, terminal |

When `merged` but not `enabled`, the detail page names the blocker and the owning team from the probe report (03 §5.3's "waiting on your own application team"). The current `RequestState` (`submitted…enabled`) already matches; `declined`/`withdrawn` are added.

`approvals/` records and `ChangeProposal` already carry the tool id and branch, so **no back-link is written into them**. If a drafted tool's id is changed, the request's `intendedToolId` is edited through the change flow (ids are immutable once merged).

## 4. (d) Who may move a request

Defers to W0-P4 for identity. Proposed permissions (names to be mapped onto P4's vocabulary by W0-Q5; **if P4 has no suitable permission, that is a `needs_human`, not something to invent**):

| Action | Who | Never |
|---|---|---|
| Submit | any signed-in human, via a registered consumer (the portal). Both halves of non-negotiable 6 apply | a consumer with no resolved human (`IDENTITY_UNRESOLVED`) |
| Withdraw | the original `requestedBy` only | anyone else |
| Triage (add `governance`, assign `intendedToolId`) | a holder of an intake-triage permission (proposed: the module's `steward` plus admins) | the requester triaging their own request when they are the named steward: same rule as W0-P22 (approvals are not self-approved) |
| Decline | the triager, with a required reason | silent closure |
| Draft | anyone allowed to use Build; the request's state only follows the artefacts | the request cannot skip review: moving a request never merges a manifest |

Every transition is a change proposal, so it is attributed (`Principal.subject`) in git. Nothing here writes audit rows: audit is for tool calls.

## 5. (e) What the Wave 1 dedupe gate (G4 M1) will need

G4 M1 blocks a submission above the similarity threshold until there is a **merge-or-justify decision**. To avoid reshaping the record later, Wave 0 stores now:

- `verdictAtSubmit.tier`, the ranked `matches` with their `RankedResult.score` verbatim, and an **`indexDigest`** (hash of `generated/index/catalogue-index.json`). Scores are only comparable against the index they came from; the digest lets a later gate say "this verdict is stale, re-rank".
- `decision`: `{ kind: merge, into: <toolId> } | { kind: justify, text }`, an optional field today. At Wave 1 it becomes **required** when `tier` is above the threshold; Wave 0 only displays it.
- The threshold itself is **not** stored in the request (it is a config value; storing it per request would freeze a value that should change in one place). Wave 0's tier boundaries remain `rank-adapter.ts`'s.

A `merge` decision resolves the request as `declined` with `reason` naming the existing tool, so merge-rate (G4 M3: *duplicate-merge rate*) is countable from `requests/` alone.

## 6. Stewards own the evals

`business.goodAnswer` seeds draft intents but is never written into `evals/`. CLAUDE.md §4: `evals/` is authored by module stewards, not tool authors, and certainly not by the requester. The request carries the seed; the steward writes the intents.

## 7. What W0-Q5 builds, in order

1. `Request` schema + `forge validate` rule (shape only; no policy rules because a request grants nothing).
2. `requests/` read model: derive the §3 state from manifests, proposals, approvals, index and probe report.
3. Submit from `/requests` through `ChangeHost` (Save draft · Propose vocabulary is for drafts; for a request the verb is **Submit**, which the UI treats as *proposed*, never *written*).
4. `/requests/[requestId]` lifecycle page; `requests/fixtures.ts` no longer imported by any `page.tsx`.
5. Playwright: ask → submit → request detail. (Like Q3's, the signed-in leg needs a gateway and user.)

## 8. Decisions I need from you

| # | Question | Recommendation |
|---|---|---|
| D1 | Does recording a request go through a change proposal with no approval record, or commit straight to the default branch? | Change proposal, no approval record |
| D2 | One record with business and governance halves (this note), or two files? | One record |
| D3 | Is `declined`/`withdrawn` stored (§1), accepting that it is the only stored state? | Yes |
| D4 | Triage permission: reuse steward + admin, or add a dedicated role? | Reuse; revisit if W0-P4 offers nothing suitable |
| D5 | Confirm the task's "G1 @ M1" is meant as G4 M1 | G4 M1 |

## 9. Not covered, deliberately

Notifying the requester (needs a channel nothing provides), SLA timers, bulk import (that is W0-Q10's Harvest), and any change to the ranker.
