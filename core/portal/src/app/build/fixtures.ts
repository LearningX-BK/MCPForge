// MCPForge — W0-J14: the default draft source (see `types.ts`'s header for
// why this seam exists — same "no live `ChangeHost.listProposals()` wiring
// yet" judgment call `catalog/fixtures.ts` documents for the Catalog).
//
// The two seeded drafts are NOT invented YAML — they are verbatim copies of
// two of the real manifests already committed at `manifests/jde/fin/ap/
// voucher.create.tool.yaml` and `voucher.get.tool.yaml` (02 §2.2's own
// worked example is `voucher.create`), chosen because together they
// demonstrate both `done:` states the binding-type gate must show: a write
// tool on an elevated (`function`) binding where expedited review is
// structurally blocked, and a read tool on the same elevated binding type
// where it is equally blocked — `plsql`/`function` block expedited
// regardless of `write`. A genuinely unelevated (`rest`/`database`/
// `wrapped-vendor`) example does not exist in `manifests/**` yet (every Wave
// 0 manifest committed so far binds through JDE AIS Orchestration —
// `grep type: manifests/**/*.tool.yaml` confirms it), so the NEW-DRAFT
// starter template below defaults to `rest` instead of fabricating a
// fictitious existing tool, which is how a developer sees the unblocked
// state in the guided form (choose/keep `rest`, `database` or
// `wrapped-vendor`) without the fixture asserting a `rest` tool exists.
import type { BuildDraft } from './types';

// TEST SOURCE ONLY since W0-P3c: `/build` reads drafts from the ChangeHost
// (`./drafts.ts`) and `/build/new` opens `./new-draft.ts`. These two drafts
// remain as component-test input; no page may import this file
// (tools/ci/src/page-fixture-imports.ts).

const VOUCHER_CREATE_YAML = `apiVersion: mcpforge/v1
kind: Tool
id: jde.ap.voucher.create # {app}.{module}.{entity}.{verb} — structurally enforced
version: 1.0.0 # semver; bump rules in 02 §2.6
server: jde-fin-ap
title: Create a voucher

# --- discovery surface (see 02 §5.3 for the token budget these feed) --------
purpose: Create an AP voucher against a supplier, optionally matched to a PO.
aliases: [supplier invoice, enter a bill, AP invoice entry, book a payable]
disambiguation: >
  Creates a NEW voucher. To find existing vouchers use jde.ap.voucher.search;
  to read one use jde.ap.voucher.get; to reverse one use jde.ap.voucher.cancel.
archetype: transactional # transactional | analytical | platform | wrapped
verb: create # from the closed verb list
entity: voucher
app: jde
module: ap
functionalArea: Accounts Payable
processTags: [P2P]
sensitivity: financial # public | internal | confidential | financial | personal
write: true
coreForRoles: [p2p] # counts against that role's resident token budget

# --- binding -----------------------------------------------------------------
binding:
  type: function # rest | database | plsql | function | wrapped-vendor
  technology: JDE AIS Orchestration
  ref: AP_VOUCHER_CREATE # allowlisted name; never taken from a parameter
  refVersion: "1.4"
  identity:
    carries: unverified # ONLY the probe may write 'verified'
    probe: MCPFORGE_PROBE_WHOAMI
    onServiceAccount: block # block | readonly-lowsens
    echoOn: write # never | write | sampled | always
  execution:
    timeoutMs: 30000
    maxConcurrency: 4
    responseBytesMax: 262144
bindingCustom: true

# --- inputs ------------------------------------------------------------------
input:
  - { name: supplier_number, type: string,  required: true,  desc: JDE address book number of the supplier., example: "4242" }
  - { name: po_number,       type: string,  required: false, desc: Purchase order number to match this voucher against. }
  - { name: amount,          type: number,  required: true,  desc: Gross amount in company currency., minimum: 0.01 }
  - { name: currency,        type: string,  required: true,  desc: ISO currency code., enumRef: iso_currency }
  - { name: company,         type: string,  required: true,  desc: JDE company code. }
  - { name: gl_date,         type: string,  required: false, desc: "GL date, YYYY-MM-DD. Defaults to today.", format: date }

# --- outputs -----------------------------------------------------------------
output:
  summaryTemplate: "Voucher {document_number} created for {supplier_number}, {amount} {currency}."
  resultKeys: # the business keys. These ARE the reversal handle.
    - { name: document_number,  path: "$.voucher.docNumber" }
    - { name: document_type,    path: "$.voucher.docType" }
    - { name: document_company, path: "$.voucher.docCo" }

# --- write safety (required whenever write: true) ----------------------------
writeSafety:
  dryRun:
    strategy: validate-pair # native | validate-pair | precondition-read | shadow-write | transactional
    ref: AP_VOUCHER_CREATE_VALIDATE
  confirm:
    required: true
    tokenTtlSeconds: 300
    planTemplate: >
      Create an AP voucher for supplier {supplier_number} ({supplier_name}) for
      {amount} {currency}, company {company}, GL date {gl_date}, matched to PO
      {po_number}. This creates an OPEN PAYABLE in JD Edwards.
  humanApprovalRequired: false # true forces an out-of-band portal approval before a token is minted
  reversal:
    class: compensating-tool # native-reverse | compensating-tool | transactional | irreversible
    tool: jde.ap.voucher.cancel
    argMap: { document_number: "$.result.document_number", document_type: "$.result.document_type", document_company: "$.result.document_company" }
    windowHours: 720
    preconditions: Voucher must be unpaid and not yet posted to a closed period.
  idempotency: { scopeHours: 24 }
  guardrails:
    - { kind: maxNumeric, field: amount, value: 250000 }
    - { kind: sodConflict, with: jde.scm.purchase_order.approve, scope: sameEntityChain }

# --- governance ---------------------------------------------------------------
governance:
  reviewPath: standard # expedited is structurally unavailable for plsql/function and for irreversible writes
  owner: JDE Finance CoE
  steward: <named person, filled at intake>

# --- evaluation ---------------------------------------------------------------
eval:
  intentsFile: evals/jde-fin-ap/intents.yaml
  minIntents: 10
`;

const VOUCHER_GET_YAML = `apiVersion: mcpforge/v1
kind: Tool
id: jde.ap.voucher.get
version: 1.0.0
server: jde-fin-ap
title: Get a voucher

purpose: Read one AP voucher by its document key.
aliases: [look up a voucher, view a bill, voucher detail]
disambiguation: >
  Reads ONE existing voucher by document key. To find candidates use
  jde.ap.voucher.search; to create one use jde.ap.voucher.create.
archetype: transactional
verb: get
entity: voucher
app: jde
module: ap
functionalArea: Accounts Payable
processTags: [P2P]
sensitivity: financial
write: false
coreForRoles: [p2p]

binding:
  type: function
  technology: JDE AIS Orchestration
  ref: AP_VOUCHER_GET
  refVersion: "1.4"
  identity:
    carries: unverified
    probe: MCPFORGE_PROBE_WHOAMI
    onServiceAccount: readonly-lowsens
    echoOn: never
  execution:
    timeoutMs: 15000
    maxConcurrency: 8
    responseBytesMax: 131072
bindingCustom: true

input:
  - { name: document_number,  type: string, required: true, desc: JDE voucher document number. }
  - { name: document_type,    type: string, required: true, desc: JDE document type code. }
  - { name: document_company, type: string, required: true, desc: JDE document company. }

output:
  summaryTemplate: "Voucher {document_number} — {status} — {amount} {currency}."
  resultKeys:
    - { name: document_number, path: "$.voucher.docNumber" }
    - { name: status,          path: "$.voucher.status" }

governance:
  reviewPath: standard
  owner: JDE Finance CoE
  steward: <named person, filled at intake>

eval:
  intentsFile: evals/jde-fin-ap/intents.yaml
  minIntents: 10
`;

export function loadBuildDrafts(): readonly BuildDraft[] {
  return [
    {
      id: 'draft-voucher-create',
      title: 'jde.ap.voucher.create — raise the AP write ceiling',
      branch: 'forge/draft-voucher-create',
      state: 'draft',
      toolId: 'jde.ap.voucher.create',
      yaml: VOUCHER_CREATE_YAML,
    },
    {
      id: 'draft-voucher-get',
      title: 'jde.ap.voucher.get — add a status alias',
      branch: 'forge/draft-voucher-get',
      state: 'in_review',
      toolId: 'jde.ap.voucher.get',
      yaml: VOUCHER_GET_YAML,
    },
  ];
}

export function findBuildDraft(id: string): BuildDraft | undefined {
  return loadBuildDrafts().find((d) => d.id === id);
}
