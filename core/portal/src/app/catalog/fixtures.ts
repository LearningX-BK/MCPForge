// MCPForge — W0-J13: the default `CatalogSource`. See `types.ts`'s file
// header for why this exists instead of a live API client.
//
// Every tool below is a real, schema-shaped `ToolManifest` — not a
// hand-rolled row type — so every facet the Catalog renders really is "a
// real manifest or probe field" per the task's `done:` line. Coverage is
// deliberate: at least one tool per binding type, per archetype, at least
// one of each sensitivity, a mix of write/read, two apps, two process tags,
// and every probe status and change state used at least once, so the facet
// UI and the live count line are exercised against real variety rather than
// a single happy-path row.
import type { ToolManifest } from '@mcpforge/shared';
import type { CatalogData, CatalogSource, CatalogTool } from './types';

function tool(m: ToolManifest): ToolManifest {
  return m;
}

const voucherCreate = tool({
  apiVersion: 'mcpforge/v1',
  kind: 'Tool',
  id: 'jde.ap.voucher.create',
  version: '1.2.0',
  server: 'jde-ap',
  title: 'Create AP voucher',
  purpose: 'Create an AP voucher against a supplier, optionally matched to a PO.',
  aliases: ['record invoice', 'enter payable'],
  disambiguation:
    'Creates a NEW voucher. To find existing vouchers use `jde.ap.voucher.search`; to cancel one use `jde.ap.voucher.cancel`.',
  archetype: 'transactional',
  verb: 'create',
  entity: 'voucher',
  app: 'jde',
  module: 'ap',
  functionalArea: 'Accounts Payable',
  processTags: ['p2p'],
  sensitivity: 'financial',
  write: true,
  coreForRoles: ['p2p'],
  binding: {
    type: 'function',
    technology: 'JDE AIS Orchestration',
    ref: 'N0411Z1_CreateVoucher',
    // eslint-disable-next-line mcpforge/no-service-account-fallback -- spec-fixed field name; detection, never substitution (02 §2.2)
    identity: { carries: 'unverified', onServiceAccount: 'block', echoOn: 'write' },
    execution: { timeoutMs: 15000, maxConcurrency: 8, responseBytesMax: 65536 },
  },
  input: [
    { name: 'supplier_id', type: 'string', required: true, desc: 'Supplier address book number.' },
    { name: 'amount', type: 'number', required: true, desc: 'Gross amount in company currency.' },
    { name: 'company', type: 'string', required: true, desc: 'JDE company code.' },
    { name: 'po_number', type: 'string', required: false, desc: 'PO to match this voucher to.' },
  ],
  output: {
    summaryTemplate: 'Voucher {document_number} created for {supplier_id}, {amount} {currency}.',
    resultKeys: [
      { name: 'document_number', path: '$.docNumber' },
      { name: 'document_type', path: '$.docType' },
      { name: 'document_company', path: '$.company' },
    ],
  },
  writeSafety: {
    dryRun: { strategy: 'validate-pair' },
    confirm: {
      required: true,
      tokenTtlSeconds: 300,
      planTemplate:
        'Create an AP voucher for supplier {supplier_id} for {amount} {currency}, company {company}{po_clause}. This creates an OPEN PAYABLE in JD Edwards.',
    },
    idempotency: { scopeHours: 24 },
    guardrails: [
      { kind: 'maxNumeric', field: 'amount', value: 50000, message: 'Voucher amount exceeds the MCPForge ceiling for this tool.' },
    ],
    humanApprovalRequired: false,
    reversal: {
      class: 'compensating-tool',
      tool: 'jde.ap.voucher.cancel',
      argMap: { document_number: '$.result.document_number' },
      windowHours: 720,
      preconditions: 'Voucher must be unpaid and not yet posted to a closed period.',
    },
  },
  governance: { reviewPath: 'standard', owner: 'JDE CNC', steward: 'Priya Rao' },
  eval: { intentsFile: 'evals/jde.ap.voucher.create.yaml', minIntents: 8 },
});

const voucherSearch = tool({
  apiVersion: 'mcpforge/v1',
  kind: 'Tool',
  id: 'jde.ap.voucher.search',
  version: '1.0.0',
  server: 'jde-ap',
  title: 'Search AP vouchers',
  purpose: 'Find vouchers by supplier, date or amount.',
  disambiguation:
    'Finds EXISTING vouchers. To create a new one use `jde.ap.voucher.create`.',
  archetype: 'transactional',
  verb: 'search',
  entity: 'voucher',
  app: 'jde',
  module: 'ap',
  functionalArea: 'Accounts Payable',
  processTags: ['p2p'],
  sensitivity: 'financial',
  write: false,
  coreForRoles: ['p2p'],
  binding: {
    type: 'rest',
    technology: 'JDE AIS REST',
    ref: 'V0411_SearchVouchers',
    // eslint-disable-next-line mcpforge/no-service-account-fallback -- spec-fixed field name; detection, never substitution (02 §2.2)
    identity: { carries: 'unverified', onServiceAccount: 'block', echoOn: 'never' },
    execution: { timeoutMs: 8000, maxConcurrency: 16, responseBytesMax: 262144 },
  },
  input: [
    { name: 'supplier_id', type: 'string', required: false, desc: 'Supplier address book number.' },
    { name: 'date_from', type: 'string', required: false, desc: 'Earliest GL date, ISO 8601.', format: 'date' },
  ],
  output: {
    summaryTemplate: '{count} vouchers found.',
    resultKeys: [{ name: 'count', path: '$.count' }],
  },
  governance: { reviewPath: 'expedited', owner: 'JDE CNC', steward: 'Priya Rao' },
  eval: { intentsFile: 'evals/jde.ap.voucher.search.yaml', minIntents: 6 },
});

const voucherCancel = tool({
  apiVersion: 'mcpforge/v1',
  kind: 'Tool',
  id: 'jde.ap.voucher.cancel',
  version: '1.0.0',
  server: 'jde-ap',
  title: 'Cancel AP voucher',
  purpose: 'Cancel an unpaid voucher before it posts to a closed period.',
  disambiguation: 'Reverses a voucher created by `jde.ap.voucher.create`.',
  archetype: 'transactional',
  verb: 'cancel',
  entity: 'voucher',
  app: 'jde',
  module: 'ap',
  functionalArea: 'Accounts Payable',
  processTags: ['p2p'],
  sensitivity: 'financial',
  write: true,
  binding: {
    type: 'function',
    technology: 'JDE AIS Orchestration',
    ref: 'N0411Z1_CancelVoucher',
    // eslint-disable-next-line mcpforge/no-service-account-fallback -- spec-fixed field name; detection, never substitution (02 §2.2)
    identity: { carries: 'unverified', onServiceAccount: 'block', echoOn: 'write' },
    execution: { timeoutMs: 15000, maxConcurrency: 8, responseBytesMax: 65536 },
  },
  input: [{ name: 'document_number', type: 'string', required: true, desc: 'The voucher document number.' }],
  output: {
    summaryTemplate: 'Voucher {document_number} cancelled.',
    resultKeys: [{ name: 'document_number', path: '$.docNumber' }],
  },
  writeSafety: {
    dryRun: { strategy: 'precondition-read' },
    confirm: {
      required: true,
      tokenTtlSeconds: 300,
      planTemplate: 'Cancel voucher {document_number}. This REMOVES the open payable in JD Edwards.',
    },
    idempotency: { scopeHours: 24 },
    humanApprovalRequired: true,
    reversal: { class: 'transactional', windowHours: 0, preconditions: 'Cannot be undone once posted.' },
  },
  governance: { reviewPath: 'standard', owner: 'JDE CNC', steward: 'Priya Rao' },
  eval: { intentsFile: 'evals/jde.ap.voucher.cancel.yaml', minIntents: 4 },
});

const poReceiptStatus = tool({
  apiVersion: 'mcpforge/v1',
  kind: 'Tool',
  id: 'jde.scm.purchase_order.get_receipt_status',
  version: '1.0.0',
  server: 'jde-scm',
  title: 'PO receipt status',
  purpose: 'Report how much of a purchase order has been receipted.',
  archetype: 'analytical',
  verb: 'get_receipt_status',
  entity: 'purchase_order',
  app: 'jde',
  module: 'scm',
  functionalArea: 'Supply Chain',
  processTags: ['p2p'],
  sensitivity: 'internal',
  write: false,
  binding: {
    type: 'database',
    technology: 'Oracle DB — read view',
    ref: 'F4311_receipt_pct',
    // eslint-disable-next-line mcpforge/no-service-account-fallback -- spec-fixed field name; detection, never substitution (02 §2.2)
    identity: { carries: 'no', onServiceAccount: 'readonly-lowsens', echoOn: 'never' },
    execution: { timeoutMs: 6000, maxConcurrency: 16, responseBytesMax: 65536 },
  },
  input: [{ name: 'po_number', type: 'string', required: true, desc: 'The purchase order number.' }],
  output: {
    summaryTemplate: 'PO {po_number} is {percent_receipted}% receipted.',
    resultKeys: [{ name: 'percent_receipted', path: '$.pct' }],
  },
  governance: { reviewPath: 'expedited', owner: 'JDE CNC', steward: 'Meera Rao' },
  eval: { intentsFile: 'evals/jde.scm.purchase_order.get_receipt_status.yaml', minIntents: 5 },
});

const glReconcile = tool({
  apiVersion: 'mcpforge/v1',
  kind: 'Tool',
  id: 'jde.gl.account.reconcile',
  version: '1.0.0',
  server: 'jde-gl',
  title: 'Reconcile GL account',
  purpose: 'Compare GL account balances across two periods and list variances.',
  archetype: 'analytical',
  verb: 'reconcile',
  entity: 'account',
  app: 'jde',
  module: 'gl',
  functionalArea: 'General Ledger',
  processTags: ['r2r'],
  sensitivity: 'confidential',
  write: false,
  binding: {
    type: 'plsql',
    technology: 'Oracle PL/SQL wrapper package',
    ref: 'PKG_GL_RECON.reconcile_account',
    // eslint-disable-next-line mcpforge/no-service-account-fallback -- spec-fixed field name; detection, never substitution (02 §2.2)
    identity: { carries: 'no', onServiceAccount: 'readonly-lowsens', echoOn: 'always' },
    execution: { timeoutMs: 20000, maxConcurrency: 4, responseBytesMax: 524288 },
    credentialClass: 'module-scoped-stored',
    credentialRef: 'secretRef://binding/jde-gl/wrapper-schema',
  },
  input: [
    { name: 'account_id', type: 'string', required: true, desc: 'GL account number.' },
    { name: 'period_a', type: 'string', required: true, desc: 'First fiscal period, YYYYMM.' },
    { name: 'period_b', type: 'string', required: true, desc: 'Second fiscal period, YYYYMM.' },
  ],
  output: {
    summaryTemplate: '{variance_count} variances found between {period_a} and {period_b}.',
    resultKeys: [{ name: 'variance_count', path: '$.variances.length' }],
  },
  governance: { reviewPath: 'standard', owner: 'Finance CNC', steward: 'Arjun Mehta' },
  eval: { intentsFile: 'evals/jde.gl.account.reconcile.yaml', minIntents: 6 },
});

const oicInvoiceSubmit = tool({
  apiVersion: 'mcpforge/v1',
  kind: 'Tool',
  id: 'oic.ar.invoice.submit',
  version: '1.0.0',
  server: 'oic-ar',
  title: 'Submit AR invoice (OIC)',
  purpose: 'Submit a customer invoice through the OIC AR integration.',
  archetype: 'wrapped',
  verb: 'submit',
  entity: 'invoice',
  app: 'oic',
  module: 'ar',
  functionalArea: 'Accounts Receivable',
  processTags: ['o2c'],
  sensitivity: 'financial',
  write: true,
  binding: {
    type: 'wrapped-vendor',
    technology: 'Oracle Integration Cloud — vendor flow',
    ref: 'OIC_AR_SubmitInvoice_v3',
    // eslint-disable-next-line mcpforge/no-service-account-fallback -- spec-fixed field name; detection, never substitution (02 §2.2)
    identity: { carries: 'no', onServiceAccount: 'block', echoOn: 'always' },
    execution: { timeoutMs: 30000, maxConcurrency: 4, responseBytesMax: 65536 },
    credentialClass: 'module-scoped-stored',
    credentialRef: 'secretRef://binding/oic-ar/service-connection',
  },
  input: [{ name: 'customer_id', type: 'string', required: true, desc: 'Customer account number.' }],
  output: {
    summaryTemplate: 'Invoice {invoice_number} submitted for {customer_id}.',
    resultKeys: [{ name: 'invoice_number', path: '$.invoiceNumber' }],
  },
  writeSafety: {
    dryRun: { strategy: 'shadow-write' },
    confirm: {
      required: true,
      tokenTtlSeconds: 300,
      planTemplate: 'Submit an AR invoice for {customer_id}. This issues a RECEIVABLE and an outbound EDI transmission.',
    },
    idempotency: { scopeHours: 24 },
    humanApprovalRequired: true,
    reversal: { class: 'irreversible', preconditions: 'EDI transmission, once sent, cannot be recalled.' },
  },
  governance: { reviewPath: 'standard', owner: 'Integration CNC', steward: 'Sofia Lund' },
  eval: { intentsFile: 'evals/oic.ar.invoice.submit.yaml', minIntents: 4 },
});

const hcmEmployeeGet = tool({
  apiVersion: 'mcpforge/v1',
  kind: 'Tool',
  id: 'jde.hcm.employee.get',
  version: '1.0.0',
  server: 'jde-hcm',
  title: 'Get employee record',
  purpose: 'Retrieve one employee record by employee number.',
  archetype: 'platform',
  verb: 'get',
  entity: 'employee',
  app: 'jde',
  module: 'hcm',
  functionalArea: 'Human Capital Management',
  processTags: [],
  sensitivity: 'personal',
  write: false,
  binding: {
    type: 'rest',
    technology: 'JDE AIS REST',
    ref: 'V060116A_GetEmployee',
    // eslint-disable-next-line mcpforge/no-service-account-fallback -- spec-fixed field name; detection, never substitution (02 §2.2)
    identity: { carries: 'unverified', onServiceAccount: 'block', echoOn: 'never' },
    execution: { timeoutMs: 8000, maxConcurrency: 16, responseBytesMax: 65536 },
  },
  input: [{ name: 'employee_id', type: 'string', required: true, desc: 'Employee number.' }],
  output: { summaryTemplate: 'Employee {employee_id} returned.', resultKeys: [{ name: 'employee_id', path: '$.id' }] },
  governance: { reviewPath: 'expedited', owner: 'HCM CNC', steward: 'Nina Oduya' },
  eval: { intentsFile: 'evals/jde.hcm.employee.get.yaml', minIntents: 5 },
});

const arInvoiceList = tool({
  apiVersion: 'mcpforge/v1',
  kind: 'Tool',
  id: 'jde.ar.invoice.list',
  version: '1.0.0',
  server: 'jde-ar',
  title: 'List AR invoices',
  purpose: 'List open AR invoices for a customer.',
  archetype: 'transactional',
  verb: 'list',
  entity: 'invoice',
  app: 'jde',
  module: 'ar',
  functionalArea: 'Accounts Receivable',
  processTags: ['o2c'],
  sensitivity: 'financial',
  write: false,
  binding: {
    type: 'rest',
    technology: 'JDE AIS REST',
    ref: 'V03B2002_ListInvoices',
    // eslint-disable-next-line mcpforge/no-service-account-fallback -- spec-fixed field name; detection, never substitution (02 §2.2)
    identity: { carries: 'unverified', onServiceAccount: 'block', echoOn: 'never' },
    execution: { timeoutMs: 8000, maxConcurrency: 16, responseBytesMax: 262144 },
  },
  input: [{ name: 'customer_id', type: 'string', required: true, desc: 'Customer account number.' }],
  output: { summaryTemplate: '{count} open invoices for {customer_id}.', resultKeys: [{ name: 'count', path: '$.count' }] },
  governance: { reviewPath: 'expedited', owner: 'JDE CNC', steward: 'Sofia Lund' },
  eval: { intentsFile: 'evals/jde.ar.invoice.list.yaml', minIntents: 5 },
});

const manifests = [
  voucherCreate,
  voucherSearch,
  voucherCancel,
  poReceiptStatus,
  glReconcile,
  oicInvoiceSubmit,
  hcmEmployeeGet,
  arInvoiceList,
];

function row(
  manifest: ToolManifest,
  extra: Partial<Omit<CatalogTool, 'manifest'>>,
): CatalogTool {
  return {
    manifest,
    probeStatus: extra.probeStatus ?? 'resolved',
    changeState: extra.changeState ?? 'deployed',
    packages: extra.packages ?? ['jde-fin'],
    manifestSha: extra.manifestSha ?? `${manifest.id.replace(/\./g, '-')}-sha1`,
    probeIdentity:
      extra.probeIdentity !== undefined
        ? extra.probeIdentity
        : {
            carries: manifest.binding.identity.carries === 'no' ? 'no' : 'unverified',
            probeRef: '',
          },
    consumption:
      extra.consumption ?? {
        last30dCalls: 0,
        consumers: [],
      },
    lastBenchmark: extra.lastBenchmark,
  };
}

const DEFAULT_TOOLS: readonly CatalogTool[] = [
  row(voucherCreate, {
    probeStatus: 'resolved',
    changeState: 'deployed',
    probeIdentity: { carries: 'verified', probeRef: 'probe-report-2026-09-08T06:00Z#jde-ap', probedAt: '2026-09-08T06:00:00Z' },
    consumption: {
      last30dCalls: 212,
      lastCallAt: '2026-09-09T08:12:00Z',
      consumers: [{ id: 'consumer-ap-agent', platform: 'Claude Desktop', calls30d: 212 }],
    },
    lastBenchmark: { saAt1: 0.94, runAt: '2026-09-07T00:00:00Z' },
  }),
  row(voucherSearch, {
    probeStatus: 'resolved',
    changeState: 'deployed',
    probeIdentity: { carries: 'verified', probeRef: 'probe-report-2026-09-08T06:00Z#jde-ap', probedAt: '2026-09-08T06:00:00Z' },
    consumption: {
      last30dCalls: 540,
      lastCallAt: '2026-09-09T09:01:00Z',
      consumers: [{ id: 'consumer-ap-agent', platform: 'Claude Desktop', calls30d: 540 }],
    },
    lastBenchmark: { saAt1: 0.98, runAt: '2026-09-07T00:00:00Z' },
  }),
  row(voucherCancel, {
    probeStatus: 'resolved',
    changeState: 'deployed',
    probeIdentity: { carries: 'verified', probeRef: 'probe-report-2026-09-08T06:00Z#jde-ap', probedAt: '2026-09-08T06:00:00Z' },
    consumption: { last30dCalls: 3, lastCallAt: '2026-09-05T14:00:00Z', consumers: [] },
  }),
  row(poReceiptStatus, {
    probeStatus: 'disabled_identity_unverified',
    changeState: 'deployed',
    probeIdentity: { carries: 'unverified', probeRef: 'probe-report-2026-09-08T06:00Z#jde-scm', probedAt: '2026-09-08T06:00:00Z' },
    consumption: { last30dCalls: 0, consumers: [] },
  }),
  row(glReconcile, {
    probeStatus: 'degraded_readonly',
    changeState: 'deployed',
    packages: ['jde-fin'],
    probeIdentity: { carries: 'no', probeRef: 'probe-report-2026-09-08T06:00Z#jde-gl', probedAt: '2026-09-08T06:00:00Z' },
    consumption: { last30dCalls: 41, lastCallAt: '2026-09-08T11:00:00Z', consumers: [] },
    lastBenchmark: { saAt1: 0.87, runAt: '2026-09-07T00:00:00Z' },
  }),
  row(oicInvoiceSubmit, {
    probeStatus: 'resolved',
    changeState: 'in_review',
    packages: ['oic-integ'],
    probeIdentity: { carries: 'no', probeRef: 'probe-report-2026-09-08T06:00Z#oic-ar', probedAt: '2026-09-08T06:00:00Z' },
    consumption: { last30dCalls: 0, consumers: [] },
  }),
  row(hcmEmployeeGet, {
    probeStatus: 'disabled_no_grant',
    changeState: 'deployed',
    packages: ['jde-hcm'],
    probeIdentity: null,
    consumption: { last30dCalls: 0, consumers: [] },
  }),
  row(arInvoiceList, {
    probeStatus: 'resolved',
    changeState: 'draft',
    packages: ['jde-fin'],
    probeIdentity: { carries: 'verified', probeRef: 'probe-report-2026-09-08T06:00Z#jde-ar', probedAt: '2026-09-08T06:00:00Z' },
    consumption: { last30dCalls: 88, lastCallAt: '2026-09-09T07:40:00Z', consumers: [] },
  }),
];

const DEFAULT_DATA: CatalogData = {
  tools: DEFAULT_TOOLS,
  roles: [
    { id: 'p2p', label: 'Procure-to-Pay', toolIds: ['jde.ap.voucher.create', 'jde.ap.voucher.search', 'jde.ap.voucher.cancel', 'jde.scm.purchase_order.get_receipt_status'] },
    { id: 'r2r', label: 'Record-to-Report', toolIds: ['jde.gl.account.reconcile'] },
    { id: 'o2c', label: 'Order-to-Cash', toolIds: ['oic.ar.invoice.submit', 'jde.ar.invoice.list'] },
  ],
  deployment: { deployedPackageId: 'jde-fin', deploymentLabel: 'JD Edwards Financials' },
};

/** The Catalog's default `CatalogSource` — see `types.ts`'s file header. */
export const fixtureCatalogSource: CatalogSource = () => DEFAULT_DATA;

export { manifests as FIXTURE_MANIFESTS };
