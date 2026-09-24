// MCPForge — W0-J18: the Policy & guardrails tab's two data sources
// (03 §5.3 "Governance" item 2, 02 §4.7 "Caps").
//
// Two halves and they are read differently on purpose:
//
//  - GUARDRAILS are a read-only view over the manifests, so they are read
//    straight out of `manifests/**/*.tool.yaml`. The tab's only write action is
//    "propose change", which routes to Build — nothing here edits a manifest.
//  - CAPS are the overlay value and the compiled-in hard ceiling, SIDE BY SIDE.
//    Both numbers come from the gateway's own module: `HARD_CEILINGS` (a frozen
//    code constant) and `resolveEffectiveCaps` (the one place the
//    `min(overlay ?? ceiling, ceiling)` merge lives). Recomputing either here
//    would give the portal a second opinion about a limit the gateway enforces,
//    and a portal that disagrees with the enforcer about a ceiling is worse
//    than one that shows nothing.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  CAP_NAMES,
  HARD_CEILINGS,
  loadCapsOverlayFile,
  resolveEffectiveCaps,
  type CapName,
} from '@mcpforge/gateway/caps';

import { resolveRepoRoot } from '../../build/_lib/repo-root';
import type { CapRowView, GuardrailRowView } from '../types';

/** Human labels for the six capped quantities. The names themselves are the gateway's. */
const CAP_LABELS: Readonly<Record<CapName, string>> = {
  rowCap: 'Rows per call',
  responseByteCap: 'Response bytes per call',
  perToolRateLimitPerMinute: 'Calls per tool, per caller, per minute',
  perCallerRateLimitPerMinute: 'Calls per caller, per minute',
  perBindingConcurrency: 'Concurrent calls per binding',
  globalConcurrency: 'Concurrent calls, whole gateway',
};

/**
 * The overlay values and the ceilings, as two numbers per row.
 *
 * `deployment` names the overlay directory; Wave 0 ships `overlays/local/`.
 * A deployment with no `caps.yaml` tightens nothing, and that renders as
 * "not tightened" — never as the ceiling wearing the overlay's clothes.
 */
export function loadCapRows(
  deployment = 'local',
  repoRoot: string = resolveRepoRoot(),
): readonly CapRowView[] {
  const path = join(repoRoot, 'overlays', deployment, 'caps.yaml');
  const loaded = loadCapsOverlayFile(path);
  const overlay = loaded.ok ? (loaded.doc?.caps ?? null) : null;
  const effective = resolveEffectiveCaps(overlay);
  return CAP_NAMES.map((name) => {
    const overlayValue = overlay?.[name] ?? null;
    const hardCeiling = HARD_CEILINGS[name];
    return {
      name,
      label: CAP_LABELS[name],
      overlayValue,
      hardCeiling,
      effective: effective[name],
      clamped: overlayValue !== null && overlayValue > hardCeiling,
    };
  });
}

function walkYaml(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walkYaml(abs, out);
    else if (name.endsWith('.tool.yaml')) out.push(abs);
  }
  return out;
}

/** Every declared guardrail across the catalogue, grouped by kind+field+threshold. */
export function loadGuardrailRows(
  repoRoot: string = resolveRepoRoot(),
): readonly GuardrailRowView[] {
  const byKey = new Map<string, { row: Omit<GuardrailRowView, 'toolIds'>; tools: Set<string> }>();
  for (const abs of walkYaml(join(repoRoot, 'manifests'))) {
    let doc: Record<string, unknown>;
    try {
      doc = (parseYaml(readFileSync(abs, 'utf8')) ?? {}) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (doc['kind'] !== 'Tool') continue;
    const toolId = typeof doc['id'] === 'string' ? doc['id'] : '';
    // 02 §3.1.3 / the Tool schema: guardrails live under `writeSafety` on a
    // write tool and at the top level on a read tool. Both are read; neither
    // location is assumed to be the only one.
    const writeSafety = doc['writeSafety'];
    const nested =
      typeof writeSafety === 'object' && writeSafety !== null
        ? (writeSafety as Record<string, unknown>)['guardrails']
        : undefined;
    const guardrails = Array.isArray(nested) ? nested : doc['guardrails'];
    if (!Array.isArray(guardrails)) continue;
    for (const g of guardrails) {
      if (typeof g !== 'object' || g === null) continue;
      const entry = g as Record<string, unknown>;
      const kind = typeof entry['kind'] === 'string' ? entry['kind'] : '';
      const field = typeof entry['field'] === 'string' ? entry['field'] : null;
      const threshold = describeThreshold(entry);
      const message = typeof entry['message'] === 'string' ? entry['message'] : '';
      const key = `${kind}|${field ?? ''}|${threshold}|${message}`;
      const existing = byKey.get(key);
      if (existing === undefined) {
        byKey.set(key, {
          row: { kind, field, threshold, message },
          tools: new Set(toolId === '' ? [] : [toolId]),
        });
      } else if (toolId !== '') {
        existing.tools.add(toolId);
      }
    }
  }
  return [...byKey.values()]
    .map(({ row, tools }) => ({ ...row, toolIds: [...tools].sort() }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || (a.field ?? '').localeCompare(b.field ?? ''));
}

/** The guardrail's own threshold fields, rendered as one cell. Never invented. */
function describeThreshold(entry: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of [
    'value',
    'max',
    'min',
    'allowedValues',
    'limit',
    'window',
    'perMinute',
    'enumRef',
    'with',
    'scope',
  ]) {
    const value = entry[key];
    if (value === undefined || value === null) continue;
    parts.push(`${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`);
  }
  return parts.length === 0 ? '—' : parts.join(' · ');
}
