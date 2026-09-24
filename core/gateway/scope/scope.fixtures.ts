// MCPForge — fixtures shared by the two W0-E2 scope test suites.
//
// Hand-built rather than generated, deliberately: `manifests/`, `roles/`,
// `packages/` and `consumers/` are empty at this point in the build, so there
// are no real compiled artefacts to read. These fixtures are shaped EXACTLY
// like W0-B8's output (`generated/roles/<id>.scope.json`'s `toolIds`,
// `generated/packages/<id>.selection.json`'s `toolIds`,
// `generated/consumers/<id>.authorization.json`'s `effectiveStatus` +
// `authorizations`) so that swapping in the real files is a loader change and
// not a test rewrite. ./scope.artefacts.test.ts proves the parsers accept that
// shape.

import type { Principal } from '../identity/index.js';
import { staticProbeStatuses, inMemoryRuntimeFlags } from './sources.js';
import type {
  ConsumerAuthorizationView,
  ConsumerSessionProvenance,
  ProbeStatus,
  RuntimeFlag,
  ScopeCatalogueEntry,
  ScopeContext,
  SessionActivation,
  ToolId,
} from './types.js';

export const TOOLS = {
  poCreate: 'jde.scm.purchase_order.create',
  voucherCreate: 'jde.ap.voucher.create',
  voucherSearch: 'jde.ap.voucher.search',
  voucherGet: 'jde.ap.voucher.get',
  voucherCancel: 'jde.ap.voucher.cancel',
  voucherUpdate: 'jde.ap.voucher.update',
  voucherSubmit: 'jde.ap.voucher.submit',
  voucherDownload: 'jde.ap.voucher.download',
  voucherExplain: 'jde.ap.voucher.explain',
  journalCreate: 'jde.fin.journal.create',
  salesOrderCreate: 'jde.o2c.sales_order.create',
} as const;

export const CATALOGUE: readonly ScopeCatalogueEntry[] = [
  {
    toolId: TOOLS.poCreate,
    serverId: 'jde-scm',
    bindingType: 'rest',
    sensitivity: 'internal',
    write: true,
  },
  {
    toolId: TOOLS.voucherCreate,
    serverId: 'jde-ap',
    bindingType: 'function',
    sensitivity: 'financial',
    write: true,
  },
  {
    toolId: TOOLS.voucherSearch,
    serverId: 'jde-ap',
    bindingType: 'rest',
    sensitivity: 'internal',
    write: false,
  },
  {
    toolId: TOOLS.voucherGet,
    serverId: 'jde-ap',
    bindingType: 'rest',
    sensitivity: 'internal',
    write: false,
  },
  {
    toolId: TOOLS.voucherCancel,
    serverId: 'jde-ap',
    bindingType: 'rest',
    sensitivity: 'internal',
    write: true,
  },
  {
    toolId: TOOLS.voucherUpdate,
    serverId: 'jde-ap',
    bindingType: 'rest',
    sensitivity: 'internal',
    write: true,
  },
  {
    toolId: TOOLS.voucherSubmit,
    serverId: 'jde-ap',
    bindingType: 'rest',
    sensitivity: 'internal',
    write: true,
  },
  // Exists only to exercise the consumer's binding-type axis.
  {
    toolId: TOOLS.voucherDownload,
    serverId: 'jde-ap',
    bindingType: 'database',
    sensitivity: 'internal',
    write: false,
  },
  // Exists only to exercise the consumer's sensitivity axis.
  {
    toolId: TOOLS.voucherExplain,
    serverId: 'jde-ap',
    bindingType: 'rest',
    sensitivity: 'personal',
    write: false,
  },
  {
    toolId: TOOLS.journalCreate,
    serverId: 'jde-fin',
    bindingType: 'function',
    sensitivity: 'financial',
    write: true,
  },
  {
    toolId: TOOLS.salesOrderCreate,
    serverId: 'jde-o2c',
    bindingType: 'rest',
    sensitivity: 'internal',
    write: true,
  },
];

export const ALL_TOOL_IDS: readonly ToolId[] = CATALOGUE.map((e) => e.toolId);

/** Compiled role scopes, shaped like `generated/roles/<id>.scope.json`. */
export const ROLE_SCOPES: ReadonlyMap<string, ReadonlySet<ToolId>> = new Map([
  [
    'p2p',
    new Set<ToolId>([
      TOOLS.poCreate,
      TOOLS.voucherCreate,
      TOOLS.voucherSearch,
      TOOLS.voucherGet,
      TOOLS.voucherCancel,
      TOOLS.voucherUpdate,
      TOOLS.voucherSubmit,
      TOOLS.voucherDownload,
      TOOLS.voucherExplain,
    ]),
  ],
  ['r2r', new Set<ToolId>([TOOLS.journalCreate])],
  ['o2c', new Set<ToolId>([TOOLS.salesOrderCreate])],
]);

/**
 * Compiled package selections. `jde-hr` is deliberately NOT selected into the
 * deployment, so `jde.ap.voucher.get` is the one tool that only `Deployed`
 * refuses.
 */
export const PACKAGE_SELECTIONS: ReadonlyMap<string, ReadonlySet<ToolId>> = new Map([
  ['jde-fin', new Set<ToolId>(ALL_TOOL_IDS.filter((id) => id !== TOOLS.voucherGet))],
  ['jde-hr', new Set<ToolId>([TOOLS.voucherGet])],
]);

export const DEPLOYED_PACKAGE_IDS = ['jde-fin'] as const;

export function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    subject: 'u-0001',
    displayName: 'Test Buyer',
    groups: ['LTM-P2P'],
    idp: 'local',
    authTime: new Date('2026-09-03T08:00:00Z'),
    amr: ['pwd'],
    ...overrides,
  };
}

export function consumer(
  overrides: {
    readonly consumerId?: string;
    readonly effectiveStatus?: string;
    readonly authorizations?: Partial<ConsumerAuthorizationView['authorizations']>;
    readonly attestation?: Partial<ConsumerAuthorizationView['attestation']>;
  } = {},
): ConsumerAuthorizationView {
  return {
    consumerId: overrides.consumerId ?? 'claude-desktop-coe',
    effectiveStatus: overrides.effectiveStatus ?? 'active',
    authorizations: {
      bindingTypes: ['rest', 'function'],
      maxSensitivity: 'financial',
      writeAllowed: true,
      roles: ['p2p', 'r2r'],
      packages: ['jde-fin', 'jde-hr'],
      ...overrides.authorizations,
    },
    attestation: { humanInTheLoop: true, ...overrides.attestation },
  };
}

/**
 * W0-N10 — the provenance `[2a]` freezes for a session. A fixture sha, shaped
 * like the real one (64 lowercase hex, `../consumer/registry.ts`), so a test
 * that asserts on the audit column asserts on the same shape production writes.
 */
export function consumerSession(
  overrides: Partial<ConsumerSessionProvenance> = {},
): ConsumerSessionProvenance {
  return {
    consumerId: 'claude-desktop-coe',
    recordSha: 'a'.repeat(64),
    authMethod: 'private-key-jwt',
    consumerSessionId: 'mcp-session-0001',
    ...overrides,
  };
}

export const PROBE_ALL_RESOLVED: ReadonlyMap<ToolId, ProbeStatus> = new Map(
  ALL_TOOL_IDS.map((id) => [id, 'resolved' as ProbeStatus]),
);

export interface ContextOverrides {
  readonly heldRoleIds?: readonly string[];
  readonly consumer?: ConsumerAuthorizationView;
  readonly consumerSession?: ConsumerSessionProvenance;
  readonly activation?: SessionActivation;
  readonly probeStatuses?: ReadonlyMap<ToolId, ProbeStatus>;
  readonly flags?: readonly RuntimeFlag[];
  readonly deployedPackageIds?: readonly string[];
  readonly now?: Date;
}

export function context(overrides: ContextOverrides = {}): ScopeContext {
  return {
    deployment: {
      deploymentId: 'ltm-dev',
      packageIds: [...(overrides.deployedPackageIds ?? DEPLOYED_PACKAGE_IDS)],
    },
    packageSelections: PACKAGE_SELECTIONS,
    roleScopes: ROLE_SCOPES,
    session: {
      principal: principal(),
      heldRoleIds: overrides.heldRoleIds ?? ['p2p', 'o2c'],
      consumer: overrides.consumer ?? consumer(),
      consumerSession:
        overrides.consumerSession ??
        consumerSession(
          overrides.consumer === undefined ? {} : { consumerId: overrides.consumer.consumerId },
        ),
      activation: overrides.activation ?? { mode: 'default' },
    },
    probe: staticProbeStatuses(overrides.probeStatuses ?? PROBE_ALL_RESOLVED),
    flags: inMemoryRuntimeFlags(overrides.flags ?? []),
    now: overrides.now ?? new Date('2026-09-03T09:00:00Z'),
  };
}
