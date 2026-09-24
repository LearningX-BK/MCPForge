import { describe, expect, it } from 'vitest';
import {
  API_VERSION,
  BINDING_TYPES,
  CREDENTIAL_CLASSES,
  TOOL_ID_PATTERN,
  VERBS,
  isConsumer,
  isTool,
  isWriteTool,
  type ConsumerManifest,
  type Manifest,
  type PackageManifest,
  type RoleManifest,
  type ToolManifest,
} from './index.js';

/**
 * The 02 §2.2 worked example, `jde.ap.voucher.create`, transcribed field for
 * field. It is typed as `ToolManifest` with no cast — if the type model drops
 * or renames a field the architecture shows, this file stops compiling.
 */
const VOUCHER_CREATE: ToolManifest = {
  apiVersion: 'mcpforge/v1',
  kind: 'Tool',
  id: 'jde.ap.voucher.create',
  version: '1.0.0',
  server: 'jde-fin-ap',
  title: 'Create a voucher',

  purpose: 'Create an AP voucher against a supplier, optionally matched to a PO.',
  aliases: ['supplier invoice', 'enter a bill', 'AP invoice entry', 'book a payable'],
  disambiguation:
    'Creates a NEW voucher. To find existing vouchers use jde.ap.voucher.search; to read one use jde.ap.voucher.get; to reverse one use jde.ap.voucher.cancel.',
  archetype: 'transactional',
  verb: 'create',
  entity: 'voucher',
  app: 'jde',
  module: 'ap',
  functionalArea: 'Accounts Payable',
  processTags: ['P2P'],
  sensitivity: 'financial',
  write: true,
  coreForRoles: ['p2p'],

  binding: {
    type: 'function',
    technology: 'JDE AIS Orchestration',
    ref: 'AP_VOUCHER_CREATE',
    refVersion: '1.4',
    identity: {
      carries: 'unverified',
      probe: 'MCPFORGE_PROBE_WHOAMI',
      // eslint-disable-next-line mcpforge/no-service-account-fallback -- spec-fixed field name (02 §2.2); see ON_SERVICE_ACCOUNT in ./tool.ts
      onServiceAccount: 'block',
      echoOn: 'write',
    },
    execution: { timeoutMs: 30000, maxConcurrency: 4, responseBytesMax: 262144 },
    credentialClass: 'per-user-exchanged',
  },

  input: [
    {
      name: 'supplier_number',
      type: 'string',
      required: true,
      desc: 'JDE address book number of the supplier.',
      example: '4242',
    },
    {
      name: 'po_number',
      type: 'string',
      required: false,
      desc: 'Purchase order to match against.',
    },
    {
      name: 'amount',
      type: 'number',
      required: true,
      desc: 'Gross amount in company currency.',
      minimum: 0.01,
    },
    {
      name: 'currency',
      type: 'string',
      required: true,
      desc: 'ISO currency code.',
      enumRef: 'iso_currency',
    },
    { name: 'company', type: 'string', required: true, desc: 'JDE company code.' },
    {
      name: 'gl_date',
      type: 'string',
      required: false,
      desc: 'GL date, YYYY-MM-DD. Defaults to today.',
      format: 'date',
    },
  ],

  output: {
    summaryTemplate:
      'Voucher {document_number} created for {supplier_number}, {amount} {currency}.',
    resultKeys: [
      { name: 'document_number', path: '$.voucher.docNumber' },
      { name: 'document_type', path: '$.voucher.docType' },
      { name: 'document_company', path: '$.voucher.docCo' },
    ],
  },

  writeSafety: {
    dryRun: { strategy: 'validate-pair', ref: 'AP_VOUCHER_CREATE_VALIDATE' },
    confirm: {
      required: true,
      tokenTtlSeconds: 300,
      planTemplate:
        'Create an AP voucher for supplier {supplier_number} ({supplier_name}) for {amount} {currency}, company {company}, GL date {gl_date}, matched to PO {po_number}. This creates an OPEN PAYABLE in JD Edwards.',
    },
    humanApprovalRequired: false,
    reversal: {
      class: 'compensating-tool',
      tool: 'jde.ap.voucher.cancel',
      argMap: {
        document_number: '$.result.document_number',
        document_type: '$.result.document_type',
        document_company: '$.result.document_company',
      },
      windowHours: 720,
      preconditions: 'Voucher must be unpaid and not yet posted to a closed period.',
    },
    idempotency: { scopeHours: 24 },
    guardrails: [
      {
        kind: 'maxNumeric',
        field: 'amount',
        value: 250000,
        message: 'Voucher amount exceeds the MCPForge ceiling for this tool.',
      },
      { kind: 'sodConflict', with: 'jde.scm.purchase_order.approve', scope: 'sameEntityChain' },
    ],
  },

  governance: {
    reviewPath: 'standard',
    owner: 'JDE Finance CoE',
    steward: '<named person, filled at intake>',
  },

  eval: { intentsFile: 'evals/jde-fin-ap/intents.yaml', minIntents: 10 },
};

/** 02 §4.3, with the Phase 5 `bindingGrants` of §11.4 added. */
const P2P: RoleManifest = {
  apiVersion: 'mcpforge/v1',
  kind: 'Role',
  id: 'p2p',
  label: 'Procure-to-Pay',
  description:
    'Raise and approve purchase orders, voucher against them, and post the resulting journals.',
  includes: [
    'jde.scm.purchase_order.*',
    'jde.ap.voucher.*',
    'jde.fin.journal.*',
    'jde.fin.gl_journal.search',
    'jde.fin.batch.get_status',
  ],
  excludes: [],
  sensitivityCeiling: 'financial',
  writeAllowed: true,
  coreTools: [
    'jde.scm.purchase_order.create',
    'jde.scm.purchase_order.approve',
    'jde.ap.voucher.create',
    'jde.fin.journal.create',
    'jde.fin.journal.submit',
    'jde.ap.voucher.search',
  ],
  budgetTokens: 1300,
  segregationOfDuties: [
    {
      conflict: ['jde.scm.purchase_order.create', 'jde.scm.purchase_order.approve'],
      disposition: 'warn-and-require-exception',
    },
  ],
  mutuallyExclusiveWith: [],
  bindingGrants: [
    {
      bindingType: 'function',
      names: ['AP_VOUCHER'],
      approvalRef: 'approvals/2026-08-27-p2p-function-grant.yaml',
      approver: '<named approver>',
      expiresAt: '2027-02-23',
      standingAuthorization: 'approvals/2026-08-27-p2p-function-standing.yaml',
    },
  ],
};

/** 02 §11.2, field for field. */
const CLAUDE_DESKTOP_COE: ConsumerManifest = {
  apiVersion: 'mcpforge/v1',
  kind: 'Consumer',
  id: 'claude-desktop-coe',
  label: 'Claude Desktop (LTM CoE)',
  class: 'interactive-client',
  owner: 'LTM Oracle AI Practice',
  steward: '<named person>',
  status: 'active',
  expiresAt: '2027-08-27',
  credential: {
    method: 'private-key-jwt',
    ref: 'secretRef://consumer/claude-desktop-coe/client',
    boundIssuers: ['ltm-ad', 'local'],
    rotation: { intervalDays: 90, lastRotatedAt: '2026-08-27' },
  },
  authorizations: {
    bindingTypes: ['rest', 'wrapped-vendor'],
    maxSensitivity: 'internal',
    writeAllowed: false,
    roles: ['p2p'],
    packages: ['jde-fin'],
  },
  limits: {
    callsPerMinute: 60,
    writesPerDay: 20,
    concurrentSessions: 4,
    operatingWindow: 'Mon-Fri 07:00-20:00 Europe/London',
  },
  attestation: { networkOrigins: ['10.20.0.0/16'], humanInTheLoop: true },
};

/** 02 §6.1 — the entire definition. */
const JDE_FIN: PackageManifest = {
  apiVersion: 'mcpforge/v1',
  kind: 'Package',
  id: 'jde-fin',
  label: 'JD Edwards Financials',
  blurb:
    'The reference slice. GL and AP, plus Procurement, because Procure-to-Pay reaches across into it.',
  servers: ['jde-fin-gl', 'jde-fin-ap', 'jde-scm-po'],
  roles: ['p2p'],
  portal: 'optional',
};

describe('the manifest type model — 02 §2.2', () => {
  it('models the worked example unchanged, field for field', () => {
    expect(VOUCHER_CREATE.apiVersion).toBe(API_VERSION);
    expect(VOUCHER_CREATE.id).toBe('jde.ap.voucher.create');
    expect(VOUCHER_CREATE.input).toHaveLength(6);
    expect(VOUCHER_CREATE.output.resultKeys.map((k) => k.name)).toEqual([
      'document_number',
      'document_type',
      'document_company',
    ]);
  });

  it('recognises a write tool by its complete writeSafety block', () => {
    expect(isWriteTool(VOUCHER_CREATE)).toBe(true);
    expect(VOUCHER_CREATE.writeSafety?.dryRun.strategy).not.toBe('none');
    expect(VOUCHER_CREATE.writeSafety?.reversal.class).toBeDefined();
  });

  it('names the business consequence in the plan template', () => {
    expect(VOUCHER_CREATE.writeSafety?.confirm.planTemplate).toContain(
      'This creates an OPEN PAYABLE in JD Edwards.',
    );
  });
});

describe('the closed verb list and the structural id pattern', () => {
  it('is exactly the 19 verbs of CLAUDE.md §5', () => {
    expect(VERBS).toHaveLength(19);
    expect(new Set(VERBS).size).toBe(19);
    // Widened from 17 to 19 by owner decision (W0-I2).
    expect(VERBS).toContain('get_receipt_status');
    expect(VERBS).toContain('get_approval_status');
  });

  it('matches an id whose verb is in the list', () => {
    for (const verb of VERBS) {
      expect(TOOL_ID_PATTERN.test(`jde.ap.voucher.${verb}`)).toBe(true);
    }
  });

  it('rejects an id whose verb is not, and any shape that is not four dotted segments', () => {
    expect(TOOL_ID_PATTERN.test('jde.ap.voucher.delete')).toBe(false);
    expect(TOOL_ID_PATTERN.test('jde.ap.voucher.Create')).toBe(false);
    expect(TOOL_ID_PATTERN.test('jde.ap.create')).toBe(false);
    expect(TOOL_ID_PATTERN.test('jde.ap.voucher.sub.create')).toBe(false);
  });
});

describe('the five binding types and the Phase 5 credentialClass', () => {
  it('carries the five handshakes of 02 §3.7', () => {
    expect([...BINDING_TYPES]).toEqual(['rest', 'database', 'plsql', 'function', 'wrapped-vendor']);
  });

  it('carries the three credential classes of 02 §11.5.1', () => {
    expect([...CREDENTIAL_CLASSES]).toEqual(['per-user-exchanged', 'module-scoped-stored', 'none']);
  });
});

describe('Role, Consumer and Package — 02 §4.3, §11.2, §11.4, §6.1', () => {
  it('carries bindingGrants on the role, with an approval, an approver and an expiry', () => {
    const grant = P2P.bindingGrants?.[0];
    expect(grant?.bindingType).toBe('function');
    expect(grant?.approvalRef).toBeTruthy();
    expect(grant?.approver).toBeTruthy();
    // Grants EXPIRE — renewal is a re-approval, not a rollover (02 §11.4).
    expect(grant?.expiresAt).toBeTruthy();
  });

  it('holds the role core set at the CI-enforced 1,300-token ceiling', () => {
    expect(P2P.budgetTokens).toBe(1300);
  });

  it('carries the consumer credential as a reference, never a value (02 §11.5)', () => {
    expect(CLAUDE_DESKTOP_COE.credential.ref.startsWith('secretRef://')).toBe(true);
  });

  it('makes the consumer registration expire', () => {
    expect(CLAUDE_DESKTOP_COE.expiresAt).toBe('2027-08-27');
    expect(CLAUDE_DESKTOP_COE.status).toBe('active');
  });

  it('keeps a package a selection: server ids and role ids only', () => {
    expect(Object.keys(JDE_FIN).sort()).toEqual(
      ['apiVersion', 'blurb', 'id', 'kind', 'label', 'portal', 'roles', 'servers'].sort(),
    );
  });
});

describe('the kind discriminator', () => {
  const all: readonly Manifest[] = [VOUCHER_CREATE, P2P, CLAUDE_DESKTOP_COE, JDE_FIN];

  it('narrows a manifest union by kind', () => {
    expect(all.filter(isTool)).toHaveLength(1);
    expect(all.filter(isConsumer)).toHaveLength(1);
    expect(all.filter(isTool)[0]?.purpose).toBe(VOUCHER_CREATE.purpose);
  });
});
