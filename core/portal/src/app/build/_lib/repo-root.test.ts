// W0-P33a — the portal reads definitions from MCPFORGE_DEFINITIONS_ROOT, but
// keeps its runtime state (consumer key, change-host sandbox) under the
// install root, never in the clone.

import { afterEach, describe, expect, it } from 'vitest';

import { resolveRepoRoot, resolveRuntimeRoot } from './repo-root';

const saved = process.env['MCPFORGE_DEFINITIONS_ROOT'];
afterEach(() => {
  if (saved === undefined) delete process.env['MCPFORGE_DEFINITIONS_ROOT'];
  else process.env['MCPFORGE_DEFINITIONS_ROOT'] = saved;
});

describe('portal roots (W0-P33a)', () => {
  it('without the variable, definitions and runtime share one root', () => {
    delete process.env['MCPFORGE_DEFINITIONS_ROOT'];
    expect(resolveRepoRoot()).toBe(resolveRuntimeRoot());
  });

  it('with the variable, definitions move to the clone and runtime stays put', () => {
    const install = resolveRuntimeRoot();
    process.env['MCPFORGE_DEFINITIONS_ROOT'] = '/opt/mcpforge/defs';
    expect(resolveRepoRoot()).toBe('/opt/mcpforge/defs');
    expect(resolveRuntimeRoot()).toBe(install);
  });
});
