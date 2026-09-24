// MCPForge — W0-J13: Catalog data shapes.
//
// JUDGMENT CALL (documented here, and in the final task report): exactly the
// same seam discipline `write-path/types.ts`, `change/test-fixtures.ts` and
// `palette/find-client.ts` already established for this portal — no gateway
// HTTP client exists yet (`/api/find` itself is still a documented seam, per
// `palette/find-client.ts`'s file header), so this module types a
// `CatalogSource` INJECTABLE SEAM rather than inventing a parallel, simplified
// shape. The fields below are not a new vocabulary: every one of them is a
// real field off `ToolManifest`/`ToolBinding` (`@mcpforge/shared`) or the real
// probe-status / change-state closed enums in `@mcpforge/shared/status`, which
// is what the task's `done:` line means by "every facet [is] a real manifest
// or probe field, not invented." `fixtures.ts` supplies the default
// `CatalogSource` used by the pages until a real gateway/registry HTTP client
// lands — swapping it for a live implementation touches no component in this
// directory.
import type {
  Archetype,
  BindingType,
  GuardrailKind,
  ProbeStatus,
  ChangeState,
  Sensitivity,
  ToolInput,
  ToolManifest,
  Verb,
} from '@mcpforge/shared';

/** One row in the Catalog — a tool, its manifest facets, and its runtime facets. */
export interface CatalogTool {
  readonly manifest: ToolManifest;
  /** `probe-report.json` field (02 §4.5) — never derived from the manifest. */
  readonly probeStatus: ProbeStatus;
  /** Git/PR state (03 §6.1) — absent for a tool that has never had a draft. */
  readonly changeState: ChangeState;
  /** The package ids this tool ships in — derived from `server` membership (registry judgment call, `core/registry/src/index/types.ts`). */
  readonly packages: readonly string[];
  /** `manifests/**` blob sha, for the "view on git" link (03 §5.3 item 4). */
  readonly manifestSha: string;
  /**
   * Identity carriage AS REPORTED BY THE PROBE — never read off
   * `binding.identity`. `null` means no probe has ever run against this
   * binding, which is its own, third, visually distinct state (CLAUDE.md #2;
   * `write-path/identity-block.tsx`'s file header says exactly why this must
   * stay probe-sourced).
   */
  readonly probeIdentity: {
    readonly carries: 'verified' | 'unverified' | 'no';
    readonly probeRef: string;
    readonly probedAt?: string | undefined;
  } | null;
  /** 30-day call volume and last-call time, for the Consumption section. */
  readonly consumption: {
    readonly last30dCalls: number;
    readonly lastCallAt?: string | undefined;
    readonly consumers: readonly { readonly id: string; readonly platform: string; readonly calls30d: number }[];
  };
  /** Last benchmark outcome for this tool's eval intents (section 9). */
  readonly lastBenchmark?: {
    readonly saAt1: number;
    readonly runAt: string;
  } | undefined;
}

/** The Role facet's options come from compiled role scopes — a role id + its label + its compiled tool-id set. */
export interface CatalogRole {
  readonly id: string;
  readonly label: string;
  readonly toolIds: readonly string[];
}

/** The deployed package — the facet's default selection (03 §5.3: "defaulting to the deployed package"). */
export interface CatalogDeployment {
  readonly deployedPackageId: string;
  readonly deploymentLabel: string;
}

export interface CatalogData {
  readonly tools: readonly CatalogTool[];
  readonly roles: readonly CatalogRole[];
  readonly deployment: CatalogDeployment;
}

/** The injectable seam. A live implementation reads git + the gateway; the default reads `fixtures.ts`. */
export type CatalogSource = () => CatalogData;

export type { Archetype, BindingType, GuardrailKind, ProbeStatus, ChangeState, Sensitivity, ToolInput, ToolManifest, Verb };
