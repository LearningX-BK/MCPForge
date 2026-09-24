import { describe, expect, it } from 'vitest';
import { VERBS } from '@mcpforge/shared/manifest';
import {
  MANIFEST_KINDS,
  checkApiVersion,
  commonSchema,
  schemaFor,
  validateManifest,
  type ManifestValidationResult,
} from './index.js';

/** Convenience: the issue messages of a failed result, joined. */
function messages(r: ManifestValidationResult): string {
  return r.ok ? '' : r.issues.map((i) => `${i.path}: ${i.message}`).join('\n');
}

function paths(r: ManifestValidationResult): string[] {
  return r.ok ? [] : r.issues.map((i) => i.path);
}

/**
 * The 02 §2.2 worked example, `jde.ap.voucher.create`, transcribed field for
 * field from the architecture document. NOTHING here is massaged to fit the
 * schema — the schema must fit the example. `steward` is the one place the
 * document writes a placeholder (`<named person, filled at intake>`); a real
 * name stands in for it, which is what "filled at intake" means.
 */
const VOUCHER_CREATE = {
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
      // eslint-disable-next-line mcpforge/no-service-account-fallback -- spec-fixed field name (02 §2.2); DETECTION of a service account, never substitution. See ON_SERVICE_ACCOUNT in @mcpforge/shared's manifest/tool.ts.
      onServiceAccount: 'block',
      echoOn: 'write',
    },
    execution: { timeoutMs: 30000, maxConcurrency: 4, responseBytesMax: 262144 },
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
    steward: 'A. Named Person',
  },

  eval: { intentsFile: 'evals/jde-fin-ap/intents.yaml', minIntents: 10 },
} as const;

/** The 02 §4.3 worked example, `roles/p2p.yaml`. */
const P2P_ROLE = {
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
} as const;

/** The 02 §6.1 worked example, `packages/jde-fin.yaml`. */
const JDE_FIN_PACKAGE = {
  apiVersion: 'mcpforge/v1',
  kind: 'Package',
  id: 'jde-fin',
  label: 'JD Edwards Financials',
  blurb:
    'The reference slice. GL and AP, plus Procurement, because Procure-to-Pay reaches across into it.',
  servers: ['jde-fin-gl', 'jde-fin-ap', 'jde-scm-po'],
  roles: ['p2p'],
  portal: 'optional',
} as const;

/** The 02 §11.2 worked example, `consumers/claude-desktop-coe.consumer.yaml`. */
const CLAUDE_DESKTOP_COE = {
  apiVersion: 'mcpforge/v1',
  kind: 'Consumer',
  id: 'claude-desktop-coe',
  label: 'Claude Desktop (LTM CoE)',
  class: 'interactive-client',
  owner: 'LTM Oracle AI Practice',
  steward: 'A. Named Person',
  status: 'active',
  expiresAt: '2027-08-27',
  credential: {
    method: 'private-key-jwt',
    ref: 'secretRef://consumer/claude-desktop-coe/client',
    // W0-N2 / 05 §A.4 — the corrected credential block. 02 §11.2's inline
    // example predates the Addendum, which states the refinement explicitly
    // (§A.5): for `private-key-jwt` the record must carry a
    // `credential.publicKeys[]` array and validation must require at least
    // one entry. `ref` names the consumer's PRIVATE key, which the gateway
    // resolves never; verification is against these PUBLIC keys.
    publicKeys: [
      {
        kid: '2026-08-a',
        kty: 'OKP',
        crv: 'Ed25519',
        x: 'O3QTUQQYGH5QTYDE1OwtAT2EvrDums2PzEiiW7I4l50',
        addedAt: '2026-08-27',
      },
    ],
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
} as const;

/** Prose-derived, NEEDS_HUMAN — see server.schema.json's description. */
const JDE_FIN_AP_SERVER = {
  apiVersion: 'mcpforge/v1',
  kind: 'Server',
  id: 'jde-fin-ap',
  label: 'JD Edwards Financials — Accounts Payable',
  app: 'jde',
  module: 'ap',
  version: '1.0.0',
  mode: 'A',
  owner: 'JDE Finance CoE',
  steward: 'A. Named Person',
} as const;

/** Structured clone with one nested path removed or replaced. */
function mutate<T>(doc: T, fn: (draft: Record<string, unknown>) => void): unknown {
  const copy = structuredClone(doc) as Record<string, unknown>;
  fn(copy);
  return copy;
}

// -----------------------------------------------------------------------------

describe('schema documents', () => {
  it('every kind has a Draft 2020-12 document', () => {
    expect(MANIFEST_KINDS).toEqual(['Tool', 'Server', 'Role', 'Package', 'Consumer']);
    for (const kind of MANIFEST_KINDS) {
      const s = schemaFor(kind);
      expect(s['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(s['kind' in s ? 'kind' : '$id']).toBeDefined();
    }
  });
});

describe('the 02 §2.2 worked example — jde.ap.voucher.create', () => {
  it('validates UNCHANGED, field for field', () => {
    const result = validateManifest(VOUCHER_CREATE);
    expect(messages(result)).toBe('');
    expect(result.ok).toBe(true);
  });

  it('accepts the Phase 5 binding.credentialClass addition', () => {
    for (const cls of ['per-user-exchanged', 'module-scoped-stored', 'none']) {
      const doc = mutate(VOUCHER_CREATE, (d) => {
        (d['binding'] as Record<string, unknown>)['credentialClass'] = cls;
      });
      expect(messages(validateManifest(doc))).toBe('');
    }
  });

  it('rejects an unknown credentialClass', () => {
    const doc = mutate(VOUCHER_CREATE, (d) => {
      // eslint-disable-next-line mcpforge/no-service-account-fallback -- a NEGATIVE fixture: this is the value the schema must refuse.
      (d['binding'] as Record<string, unknown>)['credentialClass'] = 'shared-service-account';
    });
    const r = validateManifest(doc);
    expect(r.ok).toBe(false);
    expect(paths(r)).toContain('/binding/credentialClass');
  });

  it('rejects identity.carries: verified in a hand-authored manifest (CLAUDE.md #2)', () => {
    const doc = mutate(VOUCHER_CREATE, (d) => {
      ((d['binding'] as Record<string, unknown>)['identity'] as Record<string, unknown>)[
        'carries'
      ] = 'verified';
    });
    expect(validateManifest(doc).ok).toBe(false);
  });

  it('rejects a `calls` field anywhere (R11 — demo data must not leak in)', () => {
    const doc = mutate(VOUCHER_CREATE, (d) => {
      d['calls'] = 1284;
    });
    expect(validateManifest(doc).ok).toBe(false);
  });

  it('requires writeSafety when write: true', () => {
    const doc = mutate(VOUCHER_CREATE, (d) => {
      delete d['writeSafety'];
    });
    const r = validateManifest(doc);
    expect(r.ok).toBe(false);
    expect(messages(r)).toMatch(/writeSafety/);
  });

  it('rejects a dryRun strategy of none on a write tool', () => {
    const doc = mutate(VOUCHER_CREATE, (d) => {
      ((d['writeSafety'] as Record<string, unknown>)['dryRun'] as Record<string, unknown>)[
        'strategy'
      ] = 'none';
    });
    expect(validateManifest(doc).ok).toBe(false);
  });

  it('forces humanApprovalRequired: true when reversal.class is irreversible', () => {
    const doc = mutate(VOUCHER_CREATE, (d) => {
      (d['writeSafety'] as Record<string, unknown>)['reversal'] = { class: 'irreversible' };
    });
    expect(validateManifest(doc).ok).toBe(false);
  });
});

describe('the closed 19-verb id pattern is STRUCTURAL, not a lookup', () => {
  it('accepts all nineteen verbs, enumerated explicitly', () => {
    const nineteen = [
      'search',
      'get',
      'list',
      'create',
      'update',
      'cancel',
      'submit',
      'approve',
      'release',
      'run_report',
      'run_process',
      'get_status',
      'get_receipt_status',
      'get_approval_status',
      'download',
      'simulate',
      'reconcile',
      'explain',
      'resolve',
    ];
    expect(nineteen).toHaveLength(19);
    // The shared type model and this list must be the same nineteen.
    expect([...VERBS].sort()).toEqual([...nineteen].sort());

    for (const verb of nineteen) {
      const doc = mutate(VOUCHER_CREATE, (d) => {
        d['id'] = `jde.ap.voucher.${verb}`;
        d['verb'] = verb;
      });
      expect(messages(validateManifest(doc))).toBe('');
    }
  });

  it('rejects a twentieth invented verb', () => {
    for (const invented of ['post', 'delete', 'void', 'upsert', 'purge']) {
      const doc = mutate(VOUCHER_CREATE, (d) => {
        d['id'] = `jde.ap.voucher.${invented}`;
        d['verb'] = invented;
      });
      const r = validateManifest(doc);
      expect(r.ok, `expected ${invented} to be rejected`).toBe(false);
      expect(paths(r)).toContain('/id');
    }
  });

  it('rejects a malformed id shape even when the verb is legal', () => {
    for (const bad of ['jde.ap.create', 'jde.ap.voucher.sub.create', 'JDE.AP.Voucher.create', '']) {
      const doc = mutate(VOUCHER_CREATE, (d) => {
        d['id'] = bad;
      });
      expect(validateManifest(doc).ok, `expected ${JSON.stringify(bad)} rejected`).toBe(false);
    }
  });

  it('the pattern is inlined in the schema, so there is no lookup table to drift from', () => {
    const defs = commonSchema()['$defs'] as Record<string, { pattern?: string }>;
    const pattern = defs['toolId']?.pattern;
    expect(pattern).toBeDefined();
    for (const verb of VERBS) expect(pattern).toContain(verb);
    // ...and the Tool schema reaches it by $ref, not by copying a list.
    const idRef = (schemaFor('Tool')['properties'] as Record<string, Record<string, string>>)['id'];
    expect(idRef?.['$ref']).toBe('common.schema.json#/$defs/toolId');
  });
});

describe('apiVersion — required, and an unknown one rejected BY NAME (02 §2.6)', () => {
  it('is required on every kind', () => {
    for (const doc of [
      VOUCHER_CREATE,
      JDE_FIN_AP_SERVER,
      P2P_ROLE,
      JDE_FIN_PACKAGE,
      CLAUDE_DESKTOP_COE,
    ]) {
      const without = mutate(doc, (d) => {
        delete d['apiVersion'];
      });
      const r = validateManifest(without);
      expect(r.ok).toBe(false);
      expect(paths(r)).toEqual(['/apiVersion']);
      expect(messages(r)).toMatch(/required on every manifest/);
    }
  });

  it('rejects an unknown apiVersion by name, with a stated migration', () => {
    for (const bad of ['mcpforge/v2', 'mcpforge/v0', 'v1', 'mcpforge/v1beta']) {
      const doc = mutate(VOUCHER_CREATE, (d) => {
        d['apiVersion'] = bad;
      });
      const r = validateManifest(doc);
      expect(r.ok).toBe(false);
      const text = messages(r);
      expect(text).toContain(bad); // BY NAME
      expect(text).toMatch(/no migration path is defined/);
      expect(text).toMatch(/mcpforge\/v1/);
    }
  });

  it('is not best-effort parsed: an unknown version short-circuits before shape checks', () => {
    // A document that is BOTH the wrong apiVersion and structurally broken must
    // report the apiVersion and nothing else — no partial parse of a shape this
    // build does not understand.
    const doc = mutate(VOUCHER_CREATE, (d) => {
      d['apiVersion'] = 'mcpforge/v2';
      delete d['binding'];
      d['id'] = 'not-an-id';
    });
    const r = validateManifest(doc);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.issues).toHaveLength(1);
    expect(paths(r)).toEqual(['/apiVersion']);
  });

  it('checkApiVersion is directly usable and returns null for the known version', () => {
    expect(checkApiVersion({ apiVersion: 'mcpforge/v1' })).toBeNull();
    expect(checkApiVersion({ apiVersion: 'mcpforge/v9' })?.message).toContain('mcpforge/v9');
  });
});

describe('kind dispatch', () => {
  it('rejects an unknown kind by name', () => {
    const doc = mutate(VOUCHER_CREATE, (d) => {
      d['kind'] = 'Overlay';
    });
    const r = validateManifest(doc);
    expect(r.ok).toBe(false);
    expect(messages(r)).toContain('Overlay');
  });

  it('rejects a non-object document', () => {
    expect(validateManifest('a string').ok).toBe(false);
    expect(validateManifest([]).ok).toBe(false);
    expect(validateManifest(null).ok).toBe(false);
  });
});

describe('kind: Role — the 02 §4.3 worked example, plus Phase 5 bindingGrants', () => {
  it('validates the worked example unchanged', () => {
    expect(messages(validateManifest(P2P_ROLE))).toBe('');
  });

  it('accepts a complete bindingGrant, including standingAuthorization', () => {
    const doc = mutate(P2P_ROLE, (d) => {
      d['bindingGrants'] = [
        {
          bindingType: 'plsql',
          names: ['MCPFORGE_WRAP.AP_VOUCHER'],
          approvalRef: 'approvals/2026-08-27-p2p-plsql.yaml',
          approver: 'A. Named Approver',
          expiresAt: '2027-02-23',
          standingAuthorization: 'approvals/2026-08-27-p2p-standing.yaml',
        },
      ];
    });
    expect(messages(validateManifest(doc))).toBe('');
  });

  it('rejects a bindingGrant that does not expire (CLAUDE.md #7 — grants EXPIRE)', () => {
    const doc = mutate(P2P_ROLE, (d) => {
      d['bindingGrants'] = [
        {
          bindingType: 'function',
          approvalRef: 'approvals/x.yaml',
          approver: 'A. Named Approver',
        },
      ];
    });
    const r = validateManifest(doc);
    expect(r.ok).toBe(false);
    expect(messages(r)).toMatch(/expiresAt/);
  });

  it('rejects a bindingGrant with no approvalRef or approver', () => {
    const doc = mutate(P2P_ROLE, (d) => {
      d['bindingGrants'] = [{ bindingType: 'plsql', expiresAt: '2027-02-23' }];
    });
    expect(validateManifest(doc).ok).toBe(false);
  });

  it('rejects a budgetTokens above the 1300 role core-set ceiling', () => {
    const doc = mutate(P2P_ROLE, (d) => {
      d['budgetTokens'] = 4000;
    });
    expect(validateManifest(doc).ok).toBe(false);
  });

  it('rejects a coreTools entry that is not a legal tool id', () => {
    const doc = mutate(P2P_ROLE, (d) => {
      d['coreTools'] = ['jde.ap.voucher.post'];
    });
    expect(validateManifest(doc).ok).toBe(false);
  });
});

describe('kind: Package — a selection, never a build', () => {
  it('validates the 02 §6.1 worked example unchanged', () => {
    expect(messages(validateManifest(JDE_FIN_PACKAGE))).toBe('');
  });

  it('rejects anything that smells like code or a transformation', () => {
    for (const extra of ['manifests', 'overrides', 'patch', 'build', 'transform']) {
      const doc = mutate(JDE_FIN_PACKAGE, (d) => {
        d[extra] = ['something'];
      });
      expect(validateManifest(doc).ok, `expected ${extra} rejected`).toBe(false);
    }
  });

  it('rejects an unknown portal mode', () => {
    const doc = mutate(JDE_FIN_PACKAGE, (d) => {
      d['portal'] = 'headless';
    });
    expect(validateManifest(doc).ok).toBe(false);
  });
});

describe('kind: Consumer — the 02 §11.2 worked example', () => {
  it('validates the worked example unchanged', () => {
    expect(messages(validateManifest(CLAUDE_DESKTOP_COE))).toBe('');
  });

  it('rejects a credential.ref that is not a secretRef:// URI (CLAUDE.md #8)', () => {
    for (const bad of [
      'sk-live-9f3a2b7c',
      'vault://consumer/claude-desktop-coe/client',
      'secretRef://consumer',
      '',
    ]) {
      const doc = mutate(CLAUDE_DESKTOP_COE, (d) => {
        (d['credential'] as Record<string, unknown>)['ref'] = bad;
      });
      const r = validateManifest(doc);
      expect(r.ok, `expected ${JSON.stringify(bad)} rejected`).toBe(false);
      expect(paths(r)).toContain('/credential/ref');
    }
  });

  // --- W0-N2 / 05 §A.5 — the private-key-jwt public-key rule ---------------

  it('rejects a private-key-jwt registration carrying no credential.publicKeys[]', () => {
    const doc = mutate(CLAUDE_DESKTOP_COE, (d) => {
      const credential = d['credential'] as Record<string, unknown>;
      delete credential['publicKeys'];
    });
    const r = validateManifest(doc);
    expect(r.ok).toBe(false);
    expect(messages(r)).toMatch(/publicKeys/);
  });

  it('rejects an empty credential.publicKeys[] — "at least one entry" (05 §A.5)', () => {
    const doc = mutate(CLAUDE_DESKTOP_COE, (d) => {
      (d['credential'] as Record<string, unknown>)['publicKeys'] = [];
    });
    expect(validateManifest(doc).ok).toBe(false);
  });

  it('rejects an inline PRIVATE key pasted into publicKeys[] (05 §A.5, §4.3.2 rule 1)', () => {
    const doc = mutate(CLAUDE_DESKTOP_COE, (d) => {
      (d['credential'] as Record<string, unknown>)['publicKeys'] = [
        {
          kid: '2026-08-a',
          kty: 'OKP',
          crv: 'Ed25519',
          x: 'O3QTUQQYGH5QTYDE1OwtAT2EvrDums2PzEiiW7I4l50',
          // The OKP private component. A record is a git artefact; this may
          // never be committable.
          d: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          addedAt: '2026-08-27',
        },
      ];
    });
    expect(validateManifest(doc).ok).toBe(false);
  });

  it('does not require publicKeys[] for a client-secret registration', () => {
    const doc = mutate(CLAUDE_DESKTOP_COE, (d) => {
      const credential = d['credential'] as Record<string, unknown>;
      credential['method'] = 'client-secret';
      delete credential['publicKeys'];
    });
    expect(messages(validateManifest(doc))).toBe('');
  });

  it('requires humanInTheLoop to be stated, never merely absent', () => {
    const doc = mutate(CLAUDE_DESKTOP_COE, (d) => {
      d['attestation'] = {};
    });
    const r = validateManifest(doc);
    expect(r.ok).toBe(false);
    expect(messages(r)).toMatch(/humanInTheLoop/);
  });

  it('requires an expiresAt — registrations EXPIRE', () => {
    const doc = mutate(CLAUDE_DESKTOP_COE, (d) => {
      delete d['expiresAt'];
    });
    expect(validateManifest(doc).ok).toBe(false);
  });

  it('rejects an unknown binding type in authorizations', () => {
    const doc = mutate(CLAUDE_DESKTOP_COE, (d) => {
      (d['authorizations'] as Record<string, unknown>)['bindingTypes'] = ['rest', 'soap'];
    });
    expect(validateManifest(doc).ok).toBe(false);
  });

  it('accepts a bindingGrant on the consumer as well as the role', () => {
    const doc = mutate(CLAUDE_DESKTOP_COE, (d) => {
      d['bindingGrants'] = [
        {
          bindingType: 'wrapped-vendor',
          approvalRef: 'approvals/2026-08-27-cdc-wrapped.yaml',
          approver: 'A. Named Approver',
          expiresAt: '2027-02-23',
        },
      ];
    });
    expect(messages(validateManifest(doc))).toBe('');
  });
});

describe('kind: Server — prose-derived, NEEDS_HUMAN', () => {
  it('validates a Mode A server built from 02 §4.1 prose', () => {
    expect(messages(validateManifest(JDE_FIN_AP_SERVER))).toBe('');
  });

  it('requires a promotionReason for Mode B', () => {
    const doc = mutate(JDE_FIN_AP_SERVER, (d) => {
      d['mode'] = 'B';
    });
    expect(validateManifest(doc).ok).toBe(false);
  });

  it('is deliberately permissive about unforeseen fields until a worked example exists', () => {
    const doc = mutate(JDE_FIN_AP_SERVER, (d) => {
      d['releaseTrain'] = 'quarterly';
    });
    expect(messages(validateManifest(doc))).toBe('');
    // The schema says so in its own words, so the gap is discoverable from the artefact.
    expect(String(schemaFor('Server')['description'])).toContain('NEEDS_HUMAN');
  });
});
