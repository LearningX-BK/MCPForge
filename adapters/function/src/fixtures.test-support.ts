// MCPForge — test fixtures for the `function` executor. Not part of the public
// surface (`src/index.ts` does not export it); it exists so the four test files
// share one manifest rather than four near-copies that drift.

import type { ToolManifest } from '@mcpforge/shared/manifest';

/**
 * A `function`-binding write tool shaped like 02 §2.2's worked example. The
 * caps are small on purpose so a test can breach them in milliseconds.
 */
export const voucherCreateManifest: ToolManifest = {
  apiVersion: 'mcpforge/v1',
  kind: 'Tool',
  id: 'jde.ap.voucher.create',
  version: '1.0.0',
  server: 'jde-ap',
  title: 'Create AP voucher',
  purpose: 'Create an AP voucher matched to a purchase order',
  archetype: 'transactional',
  verb: 'create',
  entity: 'voucher',
  app: 'jde',
  module: 'ap',
  functionalArea: 'Accounts Payable',
  sensitivity: 'financial',
  write: true,
  binding: {
    type: 'function',
    technology: 'JDE AIS Orchestration',
    ref: 'MCPFORGE_AP_VOUCHER_CREATE_EXECUTE',
    refVersion: '3',
    identity: {
      carries: 'unverified',
      probe: 'MCPFORGE_PROBE_WHOAMI',
      // eslint-disable-next-line mcpforge/no-service-account-fallback -- spec-fixed manifest field name (02 §2.2); `block` is the DETECTION disposition, never a substitution. Same exemption core/shared/src/manifest/tool.ts takes for the same three lines.
      onServiceAccount: 'block',
      echoOn: 'write',
    },
    execution: {
      timeoutMs: 200,
      maxConcurrency: 4,
      responseBytesMax: 4096,
    },
    credentialClass: 'per-user-exchanged',
  },
  input: [
    { name: 'supplier', type: 'string', required: true, desc: 'Supplier address book number' },
    { name: 'amount', type: 'number', required: true, desc: 'Gross voucher amount' },
    { name: 'company', type: 'string', required: false, desc: 'JDE company code' },
  ],
  output: {
    summaryTemplate: 'Created voucher {documentNumber} for {supplier}.',
    resultKeys: [{ name: 'documentNumber', path: '$.voucher.docNumber' }],
  },
  writeSafety: {
    dryRun: { strategy: 'validate-pair', ref: 'MCPFORGE_AP_VOUCHER_CREATE_VALIDATE' },
    confirm: {
      required: true,
      tokenTtlSeconds: 300,
      planTemplate: 'Create an AP voucher. This creates an OPEN PAYABLE in JD Edwards.',
    },
    reversal: { class: 'compensating-tool', tool: 'jde.ap.voucher.cancel', windowHours: 720 },
    idempotency: { scopeHours: 24 },
    guardrails: [],
    humanApprovalRequired: false,
  },
  governance: {
    reviewPath: 'standard',
    owner: 'Finance Systems',
    steward: 'A. Steward',
  },
  eval: { intentsFile: 'evals/jde-ap.yaml', minIntents: 5 },
} as ToolManifest;

/** The generated schema for the manifest above, as W0-B6's template emits it. */
export const voucherCreateSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['supplier', 'amount'],
  properties: {
    supplier: { type: 'string', description: 'Supplier address book number' },
    amount: { type: 'number', description: 'Gross voucher amount' },
    company: { type: 'string', description: 'JDE company code' },
    confirm: {
      type: ['string', 'null'],
      description:
        'Omit or null to PLAN (no change is made). Pass the confirmToken returned by the plan to EXECUTE.',
    },
  },
} as const;

/**
 * The same schema with `additionalProperties` OPEN. It exists for exactly one
 * test: proving the mapping — not the schema — is what drops unmapped extras.
 * A generated schema is closed (W0-B6 emits `additionalProperties: false`), so
 * without this variant the mapping's drop behaviour would never be exercised
 * and a future regression in it would go unnoticed behind Ajv.
 */
export const voucherCreateSchemaOpen = {
  ...voucherCreateSchema,
  additionalProperties: true,
} as const;
