// MCPForge — W0-P3d: the reversal contract of one executed call, as far as
// the portal can honestly state it. Server-only (reads `manifests/**`).
//
// Two sources, each for what it actually knows:
//  - the AUDIT ROW (`/api/v1/calls/{id}`): the reversal class and reversing
//    tool, frozen from the manifest at execute time (W0-F5). These are the
//    facts about THIS call.
//  - the COMMITTED MANIFEST: the window and preconditions. Used only when its
//    `version` is the call's `toolVersion`, because a window read from a later
//    version of the tool is not the window this call was made under.
//
// Nothing is defaulted. A call with no recorded class gets no contract at all
// (the page says so), never an assumed `irreversible`; a version mismatch
// gets a contract without a window, never a guessed one. This replaces the
// `720 hours` and `+30 days` the call page used to hard-code.

import { loadManifestFiles } from '@mcpforge/codegen/validate';
import { REVERSAL_CLASSES, type ReversalClass } from '@mcpforge/shared';

import { resolveRepoRoot } from '../../../build/_lib/repo-root';
import type { PlanReversalView } from '../../../../components/write-path/types';
import type { ActivityCallDetail } from '../../types';

interface ManifestReversal {
  readonly windowHours?: unknown;
  readonly preconditions?: unknown;
  readonly reason?: unknown;
}

interface ToolDoc {
  readonly kind?: unknown;
  readonly id?: unknown;
  readonly version?: unknown;
  readonly writeSafety?: { readonly reversal?: ManifestReversal } | null;
}

function isReversalClass(value: string | undefined): value is ReversalClass {
  return value !== undefined && (REVERSAL_CLASSES as readonly string[]).includes(value);
}

function committedReversal(
  toolId: string,
  toolVersion: string | undefined,
  repoRoot: string,
): ManifestReversal | undefined {
  if (toolVersion === undefined) return undefined;
  for (const file of loadManifestFiles(repoRoot)) {
    const doc = file.doc as ToolDoc | null | undefined;
    if (doc?.kind !== 'Tool' || doc.id !== toolId) continue;
    return doc.version === toolVersion ? (doc.writeSafety?.reversal ?? undefined) : undefined;
  }
  return undefined;
}

/** The contract for an executed write, or `undefined` when none can be stated. */
export function reversalContractFor(
  detail: ActivityCallDetail,
  repoRoot: string = resolveRepoRoot(),
): PlanReversalView | undefined {
  if (detail.phase !== 'execute' || !detail.isWrite || !isReversalClass(detail.reversalClass)) {
    return undefined;
  }
  const manifest = committedReversal(detail.toolId, detail.toolVersion, repoRoot);
  const windowHours =
    typeof manifest?.windowHours === 'number' && manifest.windowHours > 0
      ? manifest.windowHours
      : undefined;
  const executedAt = Date.parse(detail.ts);
  return {
    class: detail.reversalClass,
    ...(detail.reversalToolId === undefined
      ? {}
      : {
          tool: detail.reversalToolId,
          toolHref: `/catalog/${encodeURIComponent(detail.reversalToolId)}`,
        }),
    ...(windowHours === undefined || Number.isNaN(executedAt)
      ? {}
      : {
          windowHours,
          windowEndsAt: new Date(executedAt + windowHours * 3_600_000).toISOString(),
        }),
    ...(typeof manifest?.preconditions === 'string'
      ? { preconditions: manifest.preconditions }
      : {}),
    ...(typeof manifest?.reason === 'string' ? { reason: manifest.reason } : {}),
  };
}
