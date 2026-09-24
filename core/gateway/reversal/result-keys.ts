// MCPForge — extracting the business keys that ARE the reversal handle.
// W0-F5, 02 §2.2 ("A business key. These ARE the reversal handle"), 02 §4.6.
//
// The generated handler already performs this extraction over the RAW target
// response (`core/codegen/src/templates/handler.ts`'s `extractResultKeys`) and
// returns the flat `{name: value}` `Result` object. The write dispatcher sits
// downstream of that, so it sees the flat form — but it must not ASSUME the
// flat form, because a custom binding may hand back the raw response instead.
// Both shapes are read here, flat first, so one function covers the whole path
// and there is no second extraction rule to drift.

import type { AuditResultKey } from '../store/audit/types.js';
import type { ResultKeySpec } from './types.js';

/** Minimal `$.a.b.c` reader — the shape every declared `resultKeys.path` uses. */
export function readJsonPath(raw: unknown, path: string): unknown {
  const segments = path
    .replace(/^\$\.?/, '')
    .split('.')
    .filter((s) => s.length > 0);
  let cur: unknown = raw;
  for (const segment of segments) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[segment];
  }
  return cur;
}

/**
 * A business key is written to audit as text, so that `audit_result_key` is one
 * indexed lookup on both dialects (02 §10.4 item 2). A number becomes its
 * decimal form and an object its JSON — never `[object Object]`, which would
 * make "who created document 12345" unanswerable for that key.
 */
function asKeyValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * Extract the declared result keys from a tool's result.
 *
 * A key whose value is absent is OMITTED rather than written as an empty
 * string: an empty business key in the audit trail is worse than a missing one,
 * because it looks like a document number that exists.
 */
export function extractResultKeys(
  result: unknown,
  specs: readonly ResultKeySpec[],
): readonly AuditResultKey[] {
  const out: AuditResultKey[] = [];
  const flat =
    result !== null && typeof result === 'object' && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : undefined;
  for (const spec of specs) {
    // Flat first: the generated handler has already applied `spec.path`, so the
    // value is under `spec.name`. Falling through to the path covers a custom
    // binding that returned the raw response.
    const value = asKeyValue(flat?.[spec.name] ?? readJsonPath(result, spec.path));
    if (value !== null) {
      out.push({ keyName: spec.name, keyValue: value });
    }
  }
  return out;
}

/** `[{keyName, keyValue}]` -> `{keyName: keyValue}`, for `argMap` resolution. */
export function resultKeyMap(
  keys: readonly AuditResultKey[],
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const key of keys) out[key.keyName] = key.keyValue;
  return out;
}
