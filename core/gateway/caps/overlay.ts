// MCPForge — overlay-settable caps, and the one-directional merge with the
// compiled-in hard ceilings. W0-E6, 02 §4.7.
//
// File format mirrors W0-D4's `overlays/<deployment>/mappings/groups-to-roles.yaml`
// on purpose (CLAUDE.md: "Overlays may contain config, mappings and branding —
// never code, never manifests" — this file is VALUES ONLY, read the same way
// `core/cli/src/lib/group-role-mapping.ts` reads its mapping files: parse with
// `yaml`, validate structurally, return a typed error rather than throwing).
//
// `overlays/<deployment>/caps.yaml`:
//
//   apiVersion: mcpforge/v1
//   kind: Caps
//   deployment: local
//   caps:
//     rowCap: 500
//     responseByteCap: 1000000
//     perToolRateLimitPerMinute: 60
//     perCallerRateLimitPerMinute: 30
//     perBindingConcurrency: 5
//     globalConcurrency: 20
//
// THE ONE-DIRECTIONAL RULE, stated once and enforced in one place
// (`resolveEffectiveCaps`): `effectiveCap = min(overlayValue ?? ceiling,
// ceiling)`. An overlay value ABOVE the compiled-in ceiling is silently
// clamped to the ceiling — never honoured, never an error either, because a
// customer overlay author asking for a higher cap than the code allows is not
// a mistake worth failing a deploy over; it just does not work, and
// `overlay.cannot-loosen.test.ts` is the proof that it does not.

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import {
  CAP_NAMES,
  HARD_CEILINGS,
  isValidCapValue,
  type CapName,
  type CapValues,
} from './ceilings.js';

export interface CapsOverlayFile {
  readonly apiVersion: 'mcpforge/v1';
  readonly kind: 'Caps';
  readonly deployment: string;
  /** Every field optional — an overlay may tighten none, some, or all six caps. */
  readonly caps: Partial<Record<CapName, number>>;
}

export interface CapsParseError {
  readonly filePath: string;
  readonly message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse and structurally validate one `caps.yaml`'s already-read text. Returns
 * a typed error rather than throwing, matching `parseGroupRoleMappingFile`'s
 * contract (core/cli/src/lib/group-role-mapping.ts) — a malformed overlay in
 * one deployment must not be indistinguishable from "no overlay at all", and
 * must not crash a caller trying to load several.
 */
export function parseCapsOverlayFile(
  filePath: string,
  text: string,
): { readonly ok: true; doc: CapsOverlayFile } | { readonly ok: false; error: CapsParseError } {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    return { ok: false, error: { filePath, message: `invalid YAML: ${(err as Error).message}` } };
  }
  if (!isRecord(raw)) {
    return { ok: false, error: { filePath, message: 'must be a YAML mapping document' } };
  }
  if (raw['apiVersion'] !== 'mcpforge/v1') {
    return { ok: false, error: { filePath, message: 'apiVersion must be "mcpforge/v1"' } };
  }
  if (raw['kind'] !== 'Caps') {
    return { ok: false, error: { filePath, message: 'kind must be "Caps"' } };
  }
  if (typeof raw['deployment'] !== 'string' || raw['deployment'].length === 0) {
    return { ok: false, error: { filePath, message: 'deployment must be a non-empty string' } };
  }
  const capsRaw = raw['caps'];
  if (capsRaw !== undefined && !isRecord(capsRaw)) {
    return {
      ok: false,
      error: { filePath, message: 'caps must be a mapping of cap name -> number' },
    };
  }
  const caps: Partial<Record<CapName, number>> = {};
  for (const [key, value] of Object.entries((capsRaw ?? {}) as Record<string, unknown>)) {
    if (!(CAP_NAMES as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: {
          filePath,
          message: `caps.${key} is not one of the six overlay-settable caps: ${CAP_NAMES.join(', ')}`,
        },
      };
    }
    if (!isValidCapValue(value)) {
      return {
        ok: false,
        error: { filePath, message: `caps.${key} must be a non-negative integer` },
      };
    }
    caps[key as CapName] = value;
  }

  return {
    ok: true,
    doc: { apiVersion: 'mcpforge/v1', kind: 'Caps', deployment: raw['deployment'], caps },
  };
}

/** Load and parse `overlays/<deployment>/caps.yaml`. `null` (not an error) when the file is absent — an overlay declaring no caps.yaml tightens nothing. */
export function loadCapsOverlayFile(
  filePath: string,
):
  | { readonly ok: true; doc: CapsOverlayFile | null }
  | { readonly ok: false; error: CapsParseError } {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf-8');
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') return { ok: true, doc: null };
    return { ok: false, error: { filePath, message: (err as Error).message } };
  }
  const parsed = parseCapsOverlayFile(filePath, text);
  if (!parsed.ok) return parsed;
  return { ok: true, doc: parsed.doc };
}

/**
 * THE merge, in one place. `effectiveCap = min(overlayValue ?? ceiling,
 * ceiling)` for every one of the six caps — an overlay value above the
 * ceiling is clamped, never honoured; a missing overlay value falls back to
 * the ceiling unchanged; an overlay value below the ceiling tightens exactly
 * as declared.
 */
export function resolveEffectiveCaps(overlay: Partial<Record<CapName, number>> | null): CapValues {
  const out: Record<CapName, number> = { ...HARD_CEILINGS };
  for (const name of CAP_NAMES) {
    const ceiling = HARD_CEILINGS[name];
    const overlayValue = overlay?.[name];
    if (overlayValue === undefined) {
      out[name] = ceiling;
      continue;
    }
    out[name] = Math.min(overlayValue, ceiling);
  }
  return Object.freeze(out);
}

/** Convenience: load the overlay file (if any) and resolve it against the ceilings in one call. */
export function loadEffectiveCaps(
  capsYamlPath: string,
): { readonly ok: true; caps: CapValues } | { readonly ok: false; error: CapsParseError } {
  const loaded = loadCapsOverlayFile(capsYamlPath);
  if (!loaded.ok) return loaded;
  return { ok: true, caps: resolveEffectiveCaps(loaded.doc?.caps ?? null) };
}
