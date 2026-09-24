// MCPForge — row-cap enforcement, re-checked AFTER fetch. W0-E6, 02 §4.7.
//
// "Row caps (per tool, from the manifest, re-checked after fetch)": the
// manifest may declare a row cap tighter than the effective ceiling (this
// module never raises a manifest's own declared cap), and the check runs
// again on the ACTUAL result set once the binding has executed — a target
// system that ignores or cannot honour a requested row limit must still be
// caught here, not trusted.
//
// `ROW_CAP_EXCEEDED` already exists in the closed taxonomy
// (core/shared/src/errors/codes.ts) with a generic default `next`; this
// module's job is to construct the SPECIFIC one the done criterion requires —
// "a next naming the narrowing parameter" — using the manifest's own declared
// filter arguments, never a generic "add filters" placeholder.

import { forgeError, type ForgeError } from '@mcpforge/shared/errors';
import type { CapValues } from './ceilings.js';

export interface RowCapCheckInput {
  readonly toolId: string;
  readonly correlationId: string;
  /** Rows actually returned by the binding, after fetch. */
  readonly rowCount: number;
  /** The tool's own `rowCap`, if its manifest declares one. Never raises the effective ceiling — only ever tightens it further. */
  readonly manifestRowCap?: number;
  readonly effectiveCaps: CapValues;
  /**
   * The manifest's declared narrowing parameters for this tool — e.g. the
   * input names of a date range, a company filter, a status filter. Required
   * and non-empty: a row-capped tool with nothing to narrow by is a manifest
   * authoring defect, not something this module papers over with a vague
   * `next` (non-negotiable #5 forbids a dead-end `next`).
   */
  readonly narrowingParams: readonly string[];
}

/** `min(manifest's own declared cap, the effective ceiling)` — a manifest may only ever tighten, never raise, the ceiling. */
export function effectiveRowCap(
  manifestRowCap: number | undefined,
  effectiveCaps: CapValues,
): number {
  return manifestRowCap === undefined
    ? effectiveCaps.rowCap
    : Math.min(manifestRowCap, effectiveCaps.rowCap);
}

/**
 * Throws a closed-taxonomy `ROW_CAP_EXCEEDED` `ForgeError` when `rowCount`
 * exceeds the effective cap; otherwise returns the effective cap that was
 * checked against, for the call site to log or assert on.
 */
export function enforceRowCap(input: RowCapCheckInput): number {
  if (input.narrowingParams.length === 0) {
    throw new Error(
      `Row-capped tool ${input.toolId} declares no narrowingParams — every row-capped manifest must name at least one input a caller can narrow by (CLAUDE.md non-negotiable #5: a ROW_CAP_EXCEEDED next must name the narrowing parameter, and there is none to name here).`,
    );
  }
  const cap = effectiveRowCap(input.manifestRowCap, input.effectiveCaps);
  if (input.rowCount <= cap) return cap;

  const params = input.narrowingParams.join(', ');
  throw rowCapExceededError(input.toolId, input.correlationId, cap, params);
}

function rowCapExceededError(
  toolId: string,
  correlationId: string,
  cap: number,
  narrowingParamList: string,
): ForgeError {
  return forgeError(
    'ROW_CAP_EXCEEDED',
    `${toolId} returned more rows than the row cap of ${cap}.`,
    correlationId,
    {
      condition: `result row count exceeded the effective row cap of ${cap} for ${toolId}`,
      next: `Narrow your call to ${toolId} using ${narrowingParamList} and call it again; the row cap (${cap}) is enforced twice and cannot be raised per call.`,
    },
  );
}
