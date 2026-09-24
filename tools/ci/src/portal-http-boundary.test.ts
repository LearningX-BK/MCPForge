// MCPForge — W0-K2. Proves the "portal reaches the gateway only over HTTP,
// never in-process" claim mechanically, over the REAL portal source tree —
// not a fixture standing in for it, because the claim is about this repo's
// actual files.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkPortalHttpBoundary } from './portal-http-boundary.js';
import { findRepoRoot } from './repo-root.js';

describe('checkPortalHttpBoundary — the real repo', () => {
  it('passes over the actual core/portal/src tree today', () => {
    const report = checkPortalHttpBoundary(findRepoRoot());
    expect(report.filesScanned).toBeGreaterThan(0);
    expect(report.violations).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

describe('checkPortalHttpBoundary — fixtures', () => {
  const roots: string[] = [];
  function fixtureRoot(): string {
    const r = mkdtempSync(join(tmpdir(), 'mcpforge-boundary-'));
    roots.push(r);
    mkdirSync(join(r, 'core', 'portal', 'src'), { recursive: true });
    return r;
  }

  afterEach(() => {
    for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  });

  it('allows a type-only import from any subpath', () => {
    const root = fixtureRoot();
    writeFileSync(
      join(root, 'core', 'portal', 'src', 'a.ts'),
      "import type { StoreDescriptor } from '@mcpforge/gateway/store';\n",
    );
    expect(checkPortalHttpBoundary(root).ok).toBe(true);
  });

  it('allows an allowlisted pure helper value import', () => {
    const root = fixtureRoot();
    writeFileSync(
      join(root, 'core', 'portal', 'src', 'b.ts'),
      "import { describeStore } from '@mcpforge/gateway/store';\n",
    );
    expect(checkPortalHttpBoundary(root).ok).toBe(true);
  });

  it('allows an inline `type X` specifier mixed with an allowlisted value specifier', () => {
    const root = fixtureRoot();
    writeFileSync(
      join(root, 'core', 'portal', 'src', 'c.ts'),
      "import { describeStore, type StoreConfig } from '@mcpforge/gateway/store';\n",
    );
    expect(checkPortalHttpBoundary(root).ok).toBe(true);
  });

  it('rejects a runtime import from the live transport module — this is the fiction the task exists to prevent', () => {
    const root = fixtureRoot();
    writeFileSync(
      join(root, 'core', 'portal', 'src', 'd.ts'),
      "import { createGatewayHttpTransport } from '@mcpforge/gateway/transport';\n",
    );
    const report = checkPortalHttpBoundary(root);
    expect(report.ok).toBe(false);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.specifier).toBe('createGatewayHttpTransport');
    expect(report.violations[0]?.subpath).toBe('transport');
  });

  it('rejects a runtime import from the policy chain', () => {
    const root = fixtureRoot();
    writeFileSync(
      join(root, 'core', 'portal', 'src', 'e.ts'),
      "import { runPolicyChain } from '@mcpforge/gateway/policy';\n",
    );
    expect(checkPortalHttpBoundary(root).ok).toBe(false);
  });

  it('rejects a runtime import of the consumer registry', () => {
    const root = fixtureRoot();
    writeFileSync(
      join(root, 'core', 'portal', 'src', 'f.ts'),
      "import { loadConsumerRegistry } from '@mcpforge/gateway/consumer';\n",
    );
    expect(checkPortalHttpBoundary(root).ok).toBe(false);
  });

  it('rejects a runtime import from the bare barrel', () => {
    const root = fixtureRoot();
    writeFileSync(
      join(root, 'core', 'portal', 'src', 'g.ts'),
      "import { runtimeInfo } from '@mcpforge/gateway';\n",
    );
    expect(checkPortalHttpBoundary(root).ok).toBe(false);
  });

  it('rejects a non-allowlisted value import even from an otherwise-allowed subpath', () => {
    const root = fixtureRoot();
    writeFileSync(
      join(root, 'core', 'portal', 'src', 'h.ts'),
      "import { someNewLiveHelper } from '@mcpforge/gateway/store';\n",
    );
    const report = checkPortalHttpBoundary(root);
    expect(report.ok).toBe(false);
    expect(report.violations[0]?.specifier).toBe('someNewLiveHelper');
  });
});
