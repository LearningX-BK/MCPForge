// W0-P33a — `findDefinitionsRoot` follows MCPFORGE_DEFINITIONS_ROOT, and only it.

import { describe, expect, it } from 'vitest';
import { findDefinitionsRoot, findRepoRoot } from './repo-root.js';

describe('findDefinitionsRoot (W0-P33a)', () => {
  it('is the repo root when MCPFORGE_DEFINITIONS_ROOT is unset or empty', () => {
    expect(findDefinitionsRoot({})).toBe(findRepoRoot());
    expect(findDefinitionsRoot({ MCPFORGE_DEFINITIONS_ROOT: '' })).toBe(findRepoRoot());
  });

  it('is the configured clone when MCPFORGE_DEFINITIONS_ROOT is set', () => {
    expect(findDefinitionsRoot({ MCPFORGE_DEFINITIONS_ROOT: '/opt/mcpforge/defs' })).toBe(
      '/opt/mcpforge/defs',
    );
  });
});
