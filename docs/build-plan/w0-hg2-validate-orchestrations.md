# W0-HG2 — JDE orchestration content to author (steward: Bikash Pattnaik)

**Status:** Gate `W0-HG2` recorded as resolved on the build lane's side per explicit user decision on 2026-09-07 — steward named, six pairs treated as "to be authored, build proceeds against them now." **Not yet verified against a live JDE instance** (see `W0-HG1` note below). This spec is what needs to exist in JDE; the build lane will mark every artefact that depends on it for **post-build validation** once AIS/Orchestrator Studio access is available.

**Companion gate `W0-HG1`:** JDE AIS Server and Orchestrator Studio are confirmed to exist but are **not currently reachable from this build environment**. Per your explicit instruction, the build proceeds on the assumption they will be connected later — this is *not* the pre-declared contingency in `01_GOALS_AND_ROADMAP.md` (swap Wave 0/Wave 1 to `saas-fin`); it is a deliberate "build now, connect and validate later" call that you made as the human gate-holder. Recorded as such in `TASKS.md` and build memory, not silently treated as a real connectivity confirmation.

---

## What "validate-pair" means (per `02_TECHNICAL_ARCHITECTURE.md` §3.5, verbatim)

> Every write orchestration must be authored as a pair: `X_EXECUTE` and `X_VALIDATE`. The validate form runs the same form-service validations with the final submit step branched out, and returns the same error structure.

Concretely, each `_VALIDATE` orchestration:
- Accepts **exactly the same input parameters** as its `_EXECUTE` sibling.
- Runs **every business/form-service validation** the EXECUTE form would run (required fields, referential checks against master data, status/period checks, cross-entity checks) — everything short of the actual commit/submit step.
- **Never** performs the mutating action (no row insert/update, no status change, no workflow trigger).
- Returns the **identical error/return structure** the EXECUTE form uses on failure (same status/return-code shape, same message fields) so the gateway's dry-run path and its real-execute path can share one error mapper.
- On success (i.e., "this would have succeeded"), returns enough of a preview to populate the tool's `plan`/`effects` — it does not need to return final business keys (those don't exist until EXECUTE actually creates them), but should echo back the validated/normalized field values.

Every orchestration (EXECUTE and VALIDATE) must also satisfy the `function`-binding identity requirement (`02` §3.5, §11.4.1): it must be callable such that `MCPFORGE_PROBE_WHOAMI` (already required, separate from this task) can assert **which identity actually executed it** — i.e., it must run under the calling user's own JDE session/identity, not a shared service account.

---

## The six pairs

### 1. GL journal create — `jde.fin.journal.create`
- **EXECUTE:** `GL_JE_CREATE`
- **VALIDATE:** `GL_JE_CREATE_VALIDATE`
- **Inputs** (indicative — steward may adjust names/types to match the actual JDE form service, but the *set* below is what the tool manifest (`W0-I3`) will declare): `company` (string, required), `document_type` (string, required), `gl_date` (date, required), `account_number` (string, required — business unit.object.subsidiary), `amount` (number, required), `currency` (string, required, ISO code), `explanation` (string, optional), `batch_number` (string, output only — assigned by JDE, not an input).
- **Validations the VALIDATE form must run:** company exists and is open for posting in the target period; account number exists and is postable (not a summary/inactive account); GL date falls in an open period for the company; currency is valid and, if foreign, an exchange rate exists for the date; amount is non-zero and within any configured limits.
- **Return on failure:** same error/status structure as `GL_JE_CREATE` uses today (whatever JDE's own return-status/message-array shape is for this form service) — do not invent a new shape for the validate path.
- **Return on success:** echoes back company/account/amount/currency/gl_date as validated (no batch/document number yet — those are assigned at real create).

### 2. GL journal submit — `jde.fin.journal.submit`
- **EXECUTE:** `GL_JE_SUBMIT`
- **VALIDATE:** `GL_JE_SUBMIT_VALIDATE`
- **Inputs:** `batch_number` (string, required — from the prior `journal.create` call's result), `document_number` (string, required), `document_type` (string, required), `document_company` (string, required).
- **Validations:** batch exists and is in a submittable status (not already posted, not in error); the batch is in balance (debits = credits); the period is still open; no workflow hold is active on the batch.
- **Return on failure:** same structure as `GL_JE_SUBMIT`.
- **Return on success:** echoes batch/document identifiers as validated; does not change batch status. **It must also return `batch_total` (number — the net total of the batch about to be posted, in `currency`) and `currency` (string, ISO code).** These follow the same `amount`/`currency` pairing the create pairs above echo back; the name is `batch_total` rather than `amount` because it is the batch-level sum across all lines in the batch, not a single entry's amount.

  > **Amendment, 2026-09-08 (owner decision during `W0-I3`).** `batch_total` and `currency` were **not** in this pair's original return contract. They were added because `jde.fin.journal.submit`'s `planTemplate` must name the amount — CLAUDE.md §5 requires a plan template to name "the system, the object, the amounts and the business consequence in plain words", and `journal.submit`'s inputs are four identifiers with no amount among them, so the only place an amount can come from is the VALIDATE response. They are therefore **a real, load-bearing part of the orchestration contract, not decorative**: the authored `GL_JE_SUBMIT_VALIDATE` must return them, or the highest-stakes copy in the product asks a human to approve posting a journal without telling them how much it posts. The gateway consumes them through the existing `dryRun.planValues` channel (`core/gateway/policy/confirm/plan.ts`), which is the same mechanism `jde.ap.voucher.create`'s `{supplier_name}` already uses — no new manifest field and no new mechanism was introduced. Covered by the post-build validation checklist below.

- **Note for `W0-I3`:** this is the two-step write shape (create → submit) the Wave 0 plan calls out as "entirely unproven under the original one-write-tool scope" — the VALIDATE form must be genuinely re-runnable without side effects, since the gateway may call it more than once during a single confirm round-trip.

### 3. AP voucher create — `jde.ap.voucher.create`
- **EXECUTE:** `AP_VOUCHER_CREATE`
- **VALIDATE:** `AP_VOUCHER_CREATE_VALIDATE`
- *(This pair is already named verbatim in `02_TECHNICAL_ARCHITECTURE.md` §2.2's worked manifest example — reproduced here for completeness, not re-decided.)*
- **Inputs:** `supplier_number` (string, required), `po_number` (string, optional — match against), `amount` (number, required, ≥0.01), `currency` (string, required, ISO), `company` (string, required), `gl_date` (date, optional, defaults to today).
- **Validations:** supplier exists and is active/not on hold; if `po_number` given, PO exists, is open, and has sufficient unmatched/unreceived amount to match against; company exists and period is open for the gl_date; amount is within any configured voucher ceiling; currency valid with an exchange rate if foreign.
- **Return on failure:** same structure as `AP_VOUCHER_CREATE`.
- **Return on success:** echoes validated supplier/amount/currency/company/gl_date/po_number; no `document_number`/`document_type`/`document_company` yet (those are the real create's `resultKeys`, assigned only by EXECUTE).

### 4. AP voucher cancel — `jde.ap.voucher.cancel`
- **EXECUTE:** `AP_VOUCHER_CANCEL`
- **VALIDATE:** `AP_VOUCHER_CANCEL_VALIDATE`
- **Inputs:** `document_number` (string, required), `document_type` (string, required), `document_company` (string, required) — this is the `reversal.argMap` target for `voucher.create`, so its inputs must exactly match those three result keys.
- **Validations:** voucher exists; voucher is unpaid and not yet posted to a closed period (the precondition `W0-I4`'s manifest already declares in `writeSafety.reversal.preconditions`); no payment is in flight against it.
- **Return on failure:** same structure as `AP_VOUCHER_CANCEL`.
- **Return on success:** echoes the three identifiers as validated for cancellation.
- **Note for `W0-I4`/`W0-F7(a)`:** this pair is what makes the *live reversal* exit-criterion demonstration real rather than declared — the cancel EXECUTE form must actually be exercised end-to-end once JDE is reachable, not just validated.

### 5. PO create — `jde.scm.purchase_order.create`
- **EXECUTE:** `PO_CREATE`
- **VALIDATE:** `PO_CREATE_VALIDATE`
- **Inputs:** `supplier_number` (string, required), `company` (string, required), `business_unit` (string, required), `lines` (array, required — each with item/description, quantity, unit_cost, required_date), `currency` (string, required).
- **Validations:** supplier exists and is an approved procurement source; business unit exists and is open; each line's item/cost center is valid; total PO amount within any configured approval-routing threshold; currency valid.
- **Return on failure:** same structure as `PO_CREATE`.
- **Return on success:** echoes validated header/lines; no PO number yet.

### 6. PO approve — `jde.scm.purchase_order.approve`
- **EXECUTE:** `PO_APPROVE`
- **VALIDATE:** `PO_APPROVE_VALIDATE`
- **Inputs:** `po_number` (string, required), `company` (string, required).
- **Validations:** PO exists and is in a pending-approval status; the calling identity is a valid approver for this PO's routing step (this is the JDE-side half of the SoD check — the gateway-side half is the `sodConflict` guardrail `W0-I5` builds, refusing a caller who also created the same PO; JDE's own approval-routing rules are a second, independent check and should not be weakened to accommodate the gateway).
- **Return on failure:** same structure as `PO_APPROVE`.
- **Return on success:** echoes po_number/company as validated for approval; does not change PO status.
- **Note for `W0-I5`:** this pair, plus `PO_CREATE`, is what the create+approve-on-same-entity SoD demonstration exercises. Both the design-time (`sod.implicit-create-approve` warning) and call-time (`sodConflict` guardrail refusal) checks need this pair to exist to be exercised for real rather than only unit-tested against the mock.

---

## What is genuinely steward judgment, not fabricated here

The **exact JDE form service each orchestration wraps**, the **precise field names/data dictionary items** (DTAI aliases), and the **actual validation rule set** (e.g., which specific AP/GL/PO business functions enforce period-close, supplier-hold, or approval-routing checks in this specific JDE instance/version) are not something this build lane can know or invent — that is exactly the "low-code steward work" `02` §3.5 assigns to you. The input/output shapes above are the **contract the gateway-side tool manifests (`W0-I3`/`W0-I4`/`W0-I5`) will be built against**; if the real JDE forms need different field names, the manifests get updated to match once you author the orchestrations — not the other way around.

## Post-build validation checklist (once JDE is reachable)

- [ ] Each of the 6 `_EXECUTE` orchestrations exists, is versioned, and matches its manifest's declared `binding.ref`/`refVersion`.
- [ ] Each of the 6 `_VALIDATE` siblings exists, runs the same validations, performs no mutation, and returns the same error structure as its EXECUTE sibling.
- [ ] `GL_JE_SUBMIT_VALIDATE` returns `batch_total` and `currency` on success (the 2026-09-08 amendment in pair 2). Without them `jde.fin.journal.submit`'s plan string renders a literal `{batch_total} {currency}` and the confirmation is shown to a human with no amount in it.
- [ ] `MCPFORGE_PROBE_WHOAMI` correctly reports the calling identity for all 6 EXECUTE calls (not a shared service account) — this is `W0-H3`'s `echoOn: write` check, already built and waiting to be exercised live.
- [ ] `forge probe` run against the live instance reports all 6 tools' `function` bindings as resolved, not degraded to `precondition-read`.
- [ ] `W0-F7(a)`'s live-reversal test (`voucher.create` → `voucher.cancel`) is re-run against the live instance, not just the mock.
