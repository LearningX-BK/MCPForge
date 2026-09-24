// MCPForge — W0-J17: `/environments` view types (03 §5.3 "Environments",
// §11.1, §11.2, §11.4).
//
// Judgment call, same spirit as `activity/types.ts` and `catalog/types.ts`'s
// file headers: no live gateway HTTP client exists in the portal at Wave 0
// (`core/portal/src/lib/change-host/**` is the one seam that is real — every
// other J-track task since W0-J7 is prop/fixture-driven for the rest). These
// view shapes mirror REAL gateway/store/probe/secrets types field-for-field
// wherever a field is rendered directly, so the only thing a live wiring task
// changes later is `fixtures.ts`'s loaders, never a component or a shape.
import type { EnvClass } from '@mcpforge/shared';
import type { StoreDescriptor } from '@mcpforge/gateway/store';
import type { IdentityProviderKind } from '@mcpforge/gateway/identity';
import type { KillScope } from '@mcpforge/gateway/scope';
import type { ProbeStatus } from '@mcpforge/shared';

export type { EnvClass, StoreDescriptor, IdentityProviderKind, KillScope, ProbeStatus };

/** One active `runtime_flags` row, as the fingerprint panel renders it. Mirrors `StoredRuntimeFlag`. */
export interface KillFlagView {
  readonly id: string;
  readonly scope: KillScope;
  readonly target: string;
  readonly reason: string;
  readonly until: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
}

/** Mirrors `ProbeReportTarget` + the two report timestamps the fingerprint needs. */
export interface LastProbeRunView {
  readonly deploymentId: string;
  readonly environmentClass: EnvClass;
  readonly finishedAt: string;
  readonly toolCount: number;
}

/** [P5] — secret-store kind and rotation-window overdue count, beside the datastore kind. 02 §11.5. */
export interface SecretPostureView {
  readonly storeKind: string;
  readonly overdueCount: number;
  readonly criticalCount: number;
  readonly totalCount: number;
}

/**
 * The full "what am I actually looking at" screen. Field-for-field with 03
 * §11.1's popover / §5.3 "This deployment" tab list, in that order.
 */
export interface DeploymentFingerprint {
  readonly envClass: EnvClass;
  readonly gatewayVersion: string;
  readonly bundleVersion: string;
  readonly deployedPackage: string;
  readonly catalogueDigest: string;
  readonly store: StoreDescriptor;
  /** `null` — no remote configured (03 §11.3's "local only" branch chip case). */
  readonly gitRemote: { readonly configured: true; readonly name: string } | { readonly configured: false };
  readonly identityProviderKind: IdentityProviderKind;
  readonly identityProviderLabel: string;
  readonly lastProbeRun: LastProbeRunView | null;
  readonly killFlags: readonly KillFlagView[];
  /** [P5]. `undefined` when the secrets subsystem has not reported (never fabricated). */
  readonly secretPosture?: SecretPostureView | undefined;
}

/** 03 §11.4 — "as of when", not a boolean. Every runtime-data panel carries one. */
export interface StalenessView {
  readonly asOf: string;
  readonly staleAfterHours: number;
}

// ---------------------------------------------------------------------------
// Enablement backlog (`/environments/enablement`) — 03 §5.3 item 2.
// ---------------------------------------------------------------------------

/** One backlog line: a tool that is not `resolved`, grouped by `owningTeam`. */
export interface EnablementEntry {
  readonly toolId: string;
  readonly app: string;
  readonly status: ProbeStatus;
  readonly failingCheck: string;
  readonly remediation: string;
  /** Sourced from the owning module server manifest's `owner` field (never invented — see fixtures.ts). */
  readonly owningTeam: string;
}

export interface EnablementBacklogGroup {
  readonly owningTeam: string;
  readonly entries: readonly EnablementEntry[];
}

// ---------------------------------------------------------------------------
// Packages (`/environments/packages`) — 03 §5.3 item 3.
// ---------------------------------------------------------------------------

export interface PackageSummary {
  readonly id: string;
  readonly label: string;
  readonly blurb: string;
  readonly servers: readonly string[];
  readonly roleCount: number;
  readonly bindingTypesPresent: readonly string[];
  readonly toolCount: number;
  readonly waveCount: number;
  readonly notIncluded: readonly string[];
}

/**
 * The verbatim D1 note. There is no single quoted UI string for this note
 * anywhere in 01/02/03 — 03 §5.3 and §5.3's Catalog entry both say the note
 * is "required ... while D1 is open" and 02 §8.1 item 5 says only "the
 * concept console's existing wording is the right precedent" (a demo
 * artefact CLAUDE.md §4 forbids reading at runtime). This is a DISCLOSED
 * judgment call, not an invented fact: every sentence below is built only
 * from 01_GOALS_AND_ROADMAP.md §5's own settled prose about Decision Gate
 * D1 (the gate's name, that it is open, what it decides, and that build
 * work does not wait on it) — see this task's final report for the full
 * flag. If a real verbatim string exists in an approvals record or a
 * steward-authored source this task did not find, replace this constant and
 * nothing else changes, because every consumer imports it from here.
 */
export const D1_PACKAGING_NOTE =
  'Commercial packaging of a customer-facing slice is not decided. This view shows the mechanism only — Decision Gate D1 is still open. Build work does not wait on it.';
