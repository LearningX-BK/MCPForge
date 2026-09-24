// MCPForge — 02 §3.5: "There is no 'call arbitrary orchestration' tool, and none
// may be authored."
//
// This file proves the half of that sentence THIS package can prove: the
// executor's own surface offers no way to name an orchestration, so no such
// tool can be built on top of it. The other half — that no MANIFEST may be
// authored declaring a free-text orchestration input — belongs to a
// `forge validate` policy rule in `core/codegen/src/rules/**`, which is outside
// this task's `touches:` and is FLAGGED FOR A HUMAN in the task report rather
// than added here.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as publicSurface from './index.js';
import { buildFunctionBindingDescriptor } from './descriptor.js';
import { applyInputMapping } from './mapping.js';
import { voucherCreateManifest } from './fixtures.test-support.js';

const SRC = dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) out.push(full);
  }
  return out;
}

describe('no "call arbitrary orchestration" surface exists', () => {
  it('exports no entry point that accepts an orchestration name', () => {
    // Every exported function is inspected for a parameter that could be one.
    const names = Object.keys(publicSurface);
    expect(names).not.toContain('callOrchestration');
    expect(names).not.toContain('invokeOrchestration');
    for (const name of names) {
      const value = (publicSurface as Record<string, unknown>)[name];
      if (typeof value !== 'function') continue;
      const source = value.toString();
      const params = source.slice(source.indexOf('('), source.indexOf(')') + 1);
      expect(params.toLowerCase()).not.toMatch(/orchestration|\bref\b/);
    }
  });

  it('reads binding.ref in exactly one place in the package source', () => {
    const hits = sourceFiles(SRC)
      .filter((f) =>
        /(?:^|[\\/])(?:descriptor|mapping|executor|types|schema|errors|concurrency|index)\.ts$/.test(
          f,
        ),
      )
      .flatMap((file) => {
        const text = readFileSync(file, 'utf8');
        return text.includes('binding.ref') && /binding\.ref\?\.|binding\.ref\b/.test(text)
          ? [file]
          : [];
      })
      // Comments quote the spec sentence; only real reads count, and a real
      // read is `binding.ref` used as an expression.
      .filter((file) => /=\s*binding\.ref|binding\.ref\?\./.test(readFileSync(file, 'utf8')));
    expect(hits.map((f) => f.split(/[\\/]/).pop())).toEqual(['descriptor.ts']);
  });

  it('drops a caller field even when its name collides with the mapping table', () => {
    // Belt and braces: an argument literally called `ref` is not in the
    // mapping, so it is dropped like any other unmapped extra.
    const d = buildFunctionBindingDescriptor(voucherCreateManifest);
    const { inputs, droppedArgs } = applyInputMapping(d, {
      supplier: '4242',
      amount: 1,
      ref: 'MCPFORGE_PAYMENT_TRANSMIT',
      orchestration: 'MCPFORGE_PAYMENT_TRANSMIT',
    });
    expect(inputs).toEqual({ supplier: '4242', amount: 1 });
    expect(droppedArgs).toEqual(['orchestration', 'ref']);
  });

  it('cannot be pointed at another orchestration by mutating the mapping table', () => {
    const d = buildFunctionBindingDescriptor(voucherCreateManifest);
    expect(Object.isFrozen(d.inputMapping)).toBe(true);
    expect(() => {
      'use strict';
      (d.inputMapping as Record<string, string>)['orchestration'] = 'orchestration';
    }).toThrow();
  });
});
