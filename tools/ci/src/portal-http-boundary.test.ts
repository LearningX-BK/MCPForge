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
  // ---- W0-P7 ---------------------------------------------------------------

  it('still rejects the consumer barrel even for a symbol the narrow entry allows', () => {
    const root = fixtureRoot();
    writeFileSync(
      join(root, 'core', 'portal', 'src', 'i.ts'),
      "import { scaffoldConsumerRecord } from '@mcpforge/gateway/consumer';\n",
    );
    const report = checkPortalHttpBoundary(root);
    expect(report.ok).toBe(false);
    expect(report.violations[0]?.subpath).toBe('consumer');
  });

  it('allows the allowlisted read-only helpers from consumer/records', () => {
    const root = fixtureRoot();
    writeFileSync(
      join(root, 'core', 'portal', 'src', 'j.ts'),
      "import {\n  loadConsumerRegistry,\n  scaffoldConsumerRecord,\n  type ConsumerRecord,\n} from '@mcpforge/gateway/consumer/records';\n",
    );
    expect(checkPortalHttpBoundary(root).ok).toBe(true);
  });

  it('rejects a symbol consumer/records does not allowlist', () => {
    const root = fixtureRoot();
    writeFileSync(
      join(root, 'core', 'portal', 'src', 'k.ts'),
      "import { issueConsumerCredential } from '@mcpforge/gateway/consumer/records';\n",
    );
    const report = checkPortalHttpBoundary(root);
    expect(report.ok).toBe(false);
    expect(report.violations[0]?.subpath).toBe('consumer/records');
  });

  it('sees nested subpaths — the store driver entry is refused (previously invisible)', () => {
    const root = fixtureRoot();
    writeFileSync(
      join(root, 'core', 'portal', 'src', 'l.ts'),
      "import { openStore } from '@mcpforge/gateway/store/server';\n",
    );
    const report = checkPortalHttpBoundary(root);
    expect(report.ok).toBe(false);
    expect(report.violations[0]?.subpath).toBe('store/server');
  });

  it.each([
    ["import * as gw from '@mcpforge/gateway/store';\n", 'store'],
    ["import gw from '@mcpforge/gateway/policy';\n", 'policy'],
    ["export * from '@mcpforge/gateway/consumer';\n", 'consumer'],
    ["import '@mcpforge/gateway/transport';\n", 'transport'],
    ["const m = await import('@mcpforge/gateway/secrets/server');\n", 'secrets/server'],
    ["export { runPolicyChain } from '@mcpforge/gateway/policy';\n", 'policy'],
  ])('rejects an opaque or re-exported reach: %s', (source, subpath) => {
    const root = fixtureRoot();
    writeFileSync(join(root, 'core', 'portal', 'src', 'm.ts'), source);
    const report = checkPortalHttpBoundary(root);
    expect(report.ok).toBe(false);
    expect(report.violations[0]?.subpath).toBe(subpath);
  });

  it('still allows type-only namespace and re-export forms', () => {
    const root = fixtureRoot();
    writeFileSync(
      join(root, 'core', 'portal', 'src', 'n.ts'),
      "import type * as gw from '@mcpforge/gateway/store';\nexport type * from '@mcpforge/gateway/consumer';\nexport type { AuditRow } from '@mcpforge/gateway/store';\n",
    );
    expect(checkPortalHttpBoundary(root).ok).toBe(true);
  });

  it('admits a test-only allowance in a *.test.ts file, and only there', () => {
    const root = fixtureRoot();
    const line = "import { DETECTOR_DEFAULTS } from '@mcpforge/gateway/anomaly';\n";
    writeFileSync(join(root, 'core', 'portal', 'src', 'defaults.test.ts'), line);
    expect(checkPortalHttpBoundary(root).ok).toBe(true);
    writeFileSync(join(root, 'core', 'portal', 'src', 'defaults.ts'), line);
    const report = checkPortalHttpBoundary(root);
    expect(report.ok).toBe(false);
    expect(report.violations.map((v) => v.file)).toEqual(['core/portal/src/defaults.ts']);
  });

  it('does not extend a test-only allowance to other symbols in a test file', () => {
    const root = fixtureRoot();
    writeFileSync(
      join(root, 'core', 'portal', 'src', 'runner.test.ts'),
      "import { runDetector } from '@mcpforge/gateway/anomaly';\n",
    );
    expect(checkPortalHttpBoundary(root).ok).toBe(false);
  });
});
