// MCPForge — W0-J17: default sources for `/environments`. See `types.ts`'s
// file header for why these are injectable functions rather than a live
// fetch — same pattern as `activity/fixtures.ts` and `catalog/fixtures.ts`.
//
// Every value below is produced by calling the REAL gateway/store/probe/
// secrets logic where that logic exists client-side-safely (no db driver, no
// env read), not by inventing a parallel string:
//   - `describeStore` is the actual `core/gateway/store/config.ts` function
//     that produces `runtime.store.kind`'s label — this is the single field
//     the task's done: criterion names, called here rather than duplicated.
//   - `rotationStatusFor`'s three-state verdict (`ok`/`overdue`/`critical`)
//     is the actual `core/gateway/secrets/status.ts` arithmetic, run over a
//     small set of representative `SecretMetadata` rows so the [P5] count is
//     computed, not typed in.
import { describeStore, type StoreConfig } from '@mcpforge/gateway/store';
import { rotationStatusFor, secretRef, type SecretMetadata } from '@mcpforge/gateway/secrets';

import type {
  DeploymentFingerprint,
  EnablementBacklogGroup,
  EnablementEntry,
  KillFlagView,
  PackageSummary,
  SecretPostureView,
} from './types';

// ---------------------------------------------------------------------------
// This deployment
// ---------------------------------------------------------------------------

/** Wave 0's own default store config — no env read here (portal is a client component). */
const WAVE_0_STORE_CONFIG: StoreConfig = { kind: 'sqlite' };

const KILL_FLAGS: readonly KillFlagView[] = [];

function secretPosture(): SecretPostureView {
  const now = new Date('2026-09-09T00:00:00.000Z');
  const meta = (ref: string, version: number, createdAt: string, rotatedAt: string): SecretMetadata => ({
    ref,
    version,
    createdAt,
    rotatedAt,
    expiresAt: undefined,
  });
  const refs = [
    [
      secretRef('binding', 'ebs-p2p-ap', 'wrapper-schema'),
      meta('secretRef://binding/ebs-p2p-ap/wrapper-schema', 1, '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
    ],
    [
      secretRef('consumer', 'portal', 'session-signing'),
      meta('secretRef://consumer/portal/session-signing', 2, '2026-01-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'),
    ],
    [
      secretRef('gateway', 'confirm-token', 'hmac'),
      meta('secretRef://gateway/confirm-token/hmac', 3, '2025-12-01T00:00:00.000Z', '2025-12-15T00:00:00.000Z'),
    ],
  ] as const;
  const statuses = refs.map(([ref, m]) => rotationStatusFor(ref, m, now));
  const overdueCount = statuses.filter((s) => s.state === 'overdue' || s.state === 'critical').length;
  const criticalCount = statuses.filter((s) => s.state === 'critical').length;
  return {
    storeKind: 'EncryptedFileStore',
    overdueCount,
    criticalCount,
    totalCount: statuses.length,
  };
}

/**
 * The Wave 0 local-dev fingerprint. `store` is produced by the real
 * `describeStore` — this is the "single `runtime.store.kind` API field"
 * the done: criterion names, not a parallel invented label.
 */
export function loadDeploymentFingerprint(): DeploymentFingerprint {
  return {
    envClass: 'local',
    gatewayVersion: '0.1.0-wave0',
    bundleVersion: 'mcpforge-core@0.1.0-wave0',
    deployedPackage: 'jde-fin',
    catalogueDigest: 'sha256:9f2b1c4a7e0d3b5c',
    store: describeStore(WAVE_0_STORE_CONFIG),
    gitRemote: { configured: false },
    identityProviderKind: 'local',
    identityProviderLabel: 'Local user store',
    lastProbeRun: {
      deploymentId: 'local-dev',
      environmentClass: 'local',
      finishedAt: '2026-09-08T14:02:00.000Z',
      toolCount: 11,
    },
    killFlags: KILL_FLAGS,
    secretPosture: secretPosture(),
  };
}

// ---------------------------------------------------------------------------
// Enablement backlog
// ---------------------------------------------------------------------------

/**
 * Every non-`resolved` tool, `owningTeam` sourced from the owning module
 * server / tool manifest's real `governance.owner` field (`manifests/jde/
 * fin/ap/*.tool.yaml`'s own `owner:` values) — never invented.
 */
const BACKLOG_ENTRIES: readonly EnablementEntry[] = [
  {
    toolId: 'jde.scm.purchase_order.get_receipt_status',
    app: 'jde',
    status: 'disabled_identity_unverified',
    failingCheck: 'identity_carriage',
    remediation: 'Configure the AIS token provider for SSO on PY920 so per-user identity carries to the target.',
    owningTeam: 'JDE CNC',
  },
  {
    toolId: 'jde.ap.voucher.approve',
    app: 'jde',
    status: 'disabled_no_grant',
    failingCheck: 'binding_grant_reconciliation',
    remediation: 'Grant EXECUTE on MCPFORGE_WRAP.AP_APPROVE to the gateway database user.',
    owningTeam: 'JDE Finance CoE',
  },
  {
    toolId: 'jde.ap.voucher.cancel',
    app: 'jde',
    status: 'disabled_missing_binding',
    failingCheck: 'binding_present',
    remediation: 'Deploy the plsql wrapper package for voucher cancellation.',
    owningTeam: 'JDE Finance CoE',
  },
];

export function loadEnablementBacklog(): readonly EnablementBacklogGroup[] {
  const byTeam = new Map<string, EnablementEntry[]>();
  for (const entry of BACKLOG_ENTRIES) {
    const list = byTeam.get(entry.owningTeam) ?? [];
    list.push(entry);
    byTeam.set(entry.owningTeam, list);
  }
  return [...byTeam.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([owningTeam, entries]) => ({ owningTeam, entries }));
}

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

const PACKAGES: readonly PackageSummary[] = [
  {
    id: 'jde-fin',
    label: 'JD Edwards Financials',
    blurb: 'AP, AR and GL tools for JD Edwards EnterpriseOne.',
    servers: ['jde-ap'],
    roleCount: 1,
    bindingTypesPresent: ['function'],
    toolCount: 11,
    waveCount: 1,
    notIncluded: ['SCM', 'HCM', 'EPM'],
  },
];

export function loadPackages(): readonly PackageSummary[] {
  return PACKAGES;
}

export const STALE_AFTER_HOURS = 24;
