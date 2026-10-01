// `forge probe` — W0-H4, W0-P21. In-process (no subprocess), against the REAL
// local mock JDE (tests/mocks, loaded by URL as the gateway's e2e test does)
// and a copy of this repository's committed manifests and catalogue index.
//
// W0-P21's done criterion is the first case: every Wave 0 tool resolves, with
// validate-pair evidence, when the probe is wired from the AIS overlay and
// authenticates as the target's designated probeIdentity. The other cases are
// the refusals: no overlay, no probe identity, a server with no target, an
// index tool with no manifest. Each refuses BEFORE any check runs, with a next.

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { loadProbeReport, validateProbeReport } from '@mcpforge/probe';
import { runProbeCommand, type ProbeDeps } from './probe.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const PROBE_USER = 'mcpforge-probe@ltm.example';
const CLIENTS: Record<string, string> = {
  'mcpforge-local-jde-fin-ap': 'p21-secret-ap',
  'mcpforge-local-jde-fin-gl': 'p21-secret-gl',
  'mcpforge-local-jde-scm-po': 'p21-secret-po',
};

interface MockJde {
  readonly baseUrl: string;
  readonly tokenUrl: string;
  close(): Promise<void>;
}

function manifestVersions(dir: string, out: Record<string, string> = {}): Record<string, string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) manifestVersions(full, out);
    else if (entry.endsWith('.tool.yaml')) {
      const doc = parseYaml(readFileSync(full, 'utf8')) as {
        binding?: { ref?: string; refVersion?: string };
      };
      if (doc.binding?.ref && doc.binding.refVersion) out[doc.binding.ref] = doc.binding.refVersion;
    }
  }
  return out;
}

let jde: MockJde;
beforeAll(async () => {
  const url = pathToFileURL(join(REPO_ROOT, 'tests', 'mocks', 'src', 'mock-jde', 'server.ts'));
  const mod = (await import(url.href)) as {
    startMockJde(config: {
      users: string[];
      clients: Record<string, string>;
      versions: Record<string, string>;
    }): Promise<MockJde>;
  };
  jde = await mod.startMockJde({
    users: [PROBE_USER],
    clients: { ...CLIENTS },
    versions: manifestVersions(join(REPO_ROOT, 'manifests')),
  });
});
afterAll(async () => {
  await jde?.close();
});

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function overlay(opts: { probeIdentity?: string | null; servers?: string[] } = {}): string {
  const servers = opts.servers ?? ['jde-fin-ap', 'jde-fin-gl', 'jde-scm-po'];
  const identity =
    opts.probeIdentity === null ? '' : `    probeIdentity: ${opts.probeIdentity ?? PROBE_USER}\n`;
  return [
    'apiVersion: mcpforge/v1',
    'kind: AisTargets',
    'deployment: local',
    'targets:',
    '  jde-local-mock:',
    `    baseUrl: ${jde.baseUrl}`,
    `    tokenUrl: ${jde.tokenUrl}`,
    identity.trimEnd(),
    'servers:',
    ...servers.flatMap((s) => [
      `  ${s}:`,
      '    target: jde-local-mock',
      `    clientId: mcpforge-local-${s}`,
      `    clientCredentialRef: secretRef://binding/${s}/token-provider-client`,
    ]),
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

/** A copy of the committed manifests and index, plus an AIS overlay (or none). */
function world(aisTargets: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'mcpforge-probe-cli-'));
  dirs.push(root);
  cpSync(join(REPO_ROOT, 'manifests'), join(root, 'manifests'), { recursive: true });
  cpSync(join(REPO_ROOT, 'generated', 'index'), join(root, 'generated', 'index'), {
    recursive: true,
  });
  if (aisTargets !== null) {
    mkdirSync(join(root, 'overlays', 'local'), { recursive: true });
    writeFileSync(join(root, 'overlays', 'local', 'ais-targets.yaml'), aisTargets);
  }
  return root;
}

/** The mock's client secrets, handed over as the SecretStore would. */
const deps: ProbeDeps = {
  credential: (ref: string) => {
    const serverId = ref.split('/')[3] ?? '';
    return {
      ref,
      secretStore: {
        get: () =>
          Promise.resolve({ revealSecretValue: () => CLIENTS[`mcpforge-local-${serverId}`] ?? '' }),
      },
    };
  },
};

function captureStdout(): { text: () => string; restore: () => void } {
  let buf = '';
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    buf += String(chunk);
    return true;
  });
  return { text: () => buf, restore: () => spy.mockRestore() };
}

async function probe(root: string, extra: { env?: string } = {}) {
  const out = captureStdout();
  const code = await runProbeCommand({ json: true, root, ...extra }, deps);
  out.restore();
  return { code, body: JSON.parse(out.text()) as Record<string, unknown> };
}

describe('forge probe — W0-P21, against the running mock JDE', () => {
  it('resolves every Wave 0 tool, with validate-pair evidence, as the designated probe user', async () => {
    const root = world(overlay());
    const { code, body } = await probe(root);
    expect(code).toBe(0);
    expect(validateProbeReport(body).violations).toEqual([]);

    const report = loadProbeReport(root);
    expect(report.target.deploymentId).toBe('local');
    expect(report.tools).toHaveLength(11);
    expect(
      report.tools.filter((t) => t.status !== 'resolved').map((t) => [t.toolId, t.status]),
    ).toEqual([]);
    for (const tool of report.tools) {
      expect(tool.owningTeam.length).toBeGreaterThan(0);
    }
    // Every write tool carries its validate-pair evidence from the probe.
    const writes = report.tools.filter((t) => t.validatePair !== undefined);
    expect(writes.length).toBeGreaterThanOrEqual(6);
    expect(report.target.mutatingChecksRefused).toBe(true);
  });

  it('accepts every environment class 02 §7.1 names and refuses anything else', async () => {
    const root = world(overlay());
    for (const env of ['local', 'probe', 'staging', 'prod']) {
      const { code, body } = await probe(root, { env });
      expect(code).toBe(0);
      expect(body).toMatchObject({ target: { environmentClass: env } });
    }
    const { code, body } = await probe(root, { env: 'production-ish' });
    expect(code).toBe(64);
    expect(body['code']).toBe('INPUT_INVALID');
  });
});

describe('forge probe — W0-P33d: definitions root apart from the install root', () => {
  it('reads manifests, index and overlays from MCPFORGE_DEFINITIONS_ROOT and writes the report under the install root only', async () => {
    const defs = world(overlay());
    const install = mkdtempSync(join(tmpdir(), 'mcpforge-probe-install-'));
    dirs.push(install);
    const out = captureStdout();
    const code = await runProbeCommand(
      { json: true },
      { ...deps, env: { MCPFORGE_DEFINITIONS_ROOT: defs }, cwd: install },
    );
    out.restore();
    expect(code).toBe(0);
    const report = loadProbeReport(install);
    expect(report.tools).toHaveLength(11);
    expect(report.tools.every((t) => t.status === 'resolved')).toBe(true);
    // Nothing was written into the definitions clone.
    expect(readdirSync(defs).sort()).toEqual(['generated', 'manifests', 'overlays']);
  });

  it('refuses, naming the clone-relative overlay, when the definitions root has none', async () => {
    const defs = world(null);
    const install = world(overlay());
    const out = captureStdout();
    const code = await runProbeCommand(
      { json: true },
      { ...deps, env: { MCPFORGE_DEFINITIONS_ROOT: defs }, cwd: install },
    );
    out.restore();
    expect(code).toBe(64);
    const body = JSON.parse(out.text()) as Record<string, unknown>;
    expect(body['code']).toBe('PROBE_TARGET_UNCONFIGURED');
    expect(String(body['next'])).toContain('overlays/local/ais-targets.yaml');
  });
});

describe('forge probe — refusals, each before any check runs', () => {
  it('refuses when the deployment has no AIS overlay, naming the file', async () => {
    const root = world(null);
    const { code, body } = await probe(root);
    expect(code).toBe(64);
    expect(body['code']).toBe('PROBE_TARGET_UNCONFIGURED');
    expect(String(body['next'])).toContain('overlays/local/ais-targets.yaml');
  });

  it('refuses a target that names no probeIdentity: the probe never picks a test user', async () => {
    const root = world(overlay({ probeIdentity: null }));
    const { code, body } = await probe(root);
    expect(code).toBe(64);
    expect(body['code']).toBe('PROBE_TARGET_UNCONFIGURED');
    expect(String(body['next'])).toContain('probeIdentity');
    expect(String(body['next'])).toContain('targets.jde-local-mock');
  });

  it('refuses a module server with no AIS target, naming the server', async () => {
    const root = world(overlay({ servers: ['jde-fin-ap', 'jde-fin-gl'] }));
    const { code, body } = await probe(root);
    expect(code).toBe(64);
    expect(String(body['next'])).toContain('servers.jde-scm-po');
  });

  it('refuses when the index names a tool no manifest declares', async () => {
    const root = world(overlay());
    rmSync(join(root, 'manifests', 'jde', 'fin', 'ap', 'voucher.get.tool.yaml'));
    const { code, body } = await probe(root);
    expect(code).toBe(64);
    expect(body['code']).toBe('CATALOGUE_UNAVAILABLE');
    expect(String(body['message'])).toContain('jde.ap.voucher.get');
  });

  it('fails with a named next when the catalogue index has not been generated', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcpforge-probe-empty-'));
    dirs.push(root);
    const { code, body } = await probe(root);
    expect(code).toBe(64);
    expect(body['code']).toBe('CATALOGUE_UNAVAILABLE');
    expect(String(body['next'])).toContain('forge codegen');
  });
});
