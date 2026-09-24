// MCPForge — W0-P7: `records.ts` must stay the read-only half of the consumer
// module. The portal imports it in-process (allowlisted per symbol in
// `tools/ci/src/portal-http-boundary.ts`), so if a future edit re-exports from
// `credential.ts` or `proposal.ts` — directly or through a sibling — the
// portal process would load credential issuance or the proposal writer again
// while the boundary gate still passed on symbol names. This walks the real
// RUNTIME import graph (type-only imports are erased and skipped) and fails
// if either becomes reachable.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as records from './records.js';

const here = dirname(fileURLToPath(import.meta.url));

// `import { a } from './x.js'`, `import x from`, `import * as`, `export … from`,
// and bare side-effect imports — but NOT `import type` / `export type`.
const RUNTIME_EDGE_RE =
  /^\s*(?:import|export)\s+(?!type\s)(?:[^'";]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm;

function runtimeGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [resolve(here, entry)];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(RUNTIME_EDGE_RE)) {
      const spec = m[1] as string;
      stack.push(join(dirname(file), spec.replace(/\.js$/, '.ts')));
    }
  }
  return new Set(
    [...seen].map((f) =>
      f
        .slice(here.length + 1)
        .split('\\')
        .join('/'),
    ),
  );
}

describe('consumer/records — the read-only consumer surface', () => {
  it('cannot reach credential issuance or the proposal writer at runtime', () => {
    const graph = runtimeGraph('./records.ts');
    expect(graph.has('records.ts')).toBe(true);
    expect(graph.has('registry.ts')).toBe(true);
    expect(graph.has('credential.ts')).toBe(false);
    expect(graph.has('proposal.ts')).toBe(false);
    expect(graph.has('index.ts')).toBe(false);
  });

  it('exports no credential or proposal-writing function', () => {
    const names = Object.keys(records);
    for (const forbidden of [
      'issueConsumerCredential',
      'verifyConsumerCredential',
      'refuseIssuance',
      'writeChangeProposal',
      'proposalsRoot',
      'proposalDirectory',
    ]) {
      expect(names).not.toContain(forbidden);
    }
    expect(names).toContain('loadConsumerRegistry');
    expect(names).toContain('scaffoldConsumerRecord');
  });
});
