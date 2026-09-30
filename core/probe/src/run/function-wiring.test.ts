// W0-P21 — the `function` probe executor wired per module server. The refusals
// are the point: a gap in the overlay is named before any check runs, and no
// identity or target is ever substituted.
import { parseAisTargetsOverlay } from '@mcpforge/adapter-function';
import { describe, expect, it } from 'vitest';

import { createFunctionProbeExecutor } from './function-executor.js';
import { wireFunctionProbe } from './function-wiring.js';

function overlay(opts: { probeIdentity?: string; servers?: string[] } = {}) {
  const servers = opts.servers ?? ['jde-fin-ap', 'jde-fin-gl'];
  return parseAisTargetsOverlay({
    apiVersion: 'mcpforge/v1',
    kind: 'AisTargets',
    deployment: 'local',
    targets: {
      mock: {
        baseUrl: 'http://127.0.0.1:9/jderest',
        tokenUrl: 'http://127.0.0.1:9/token',
        ...(opts.probeIdentity === undefined ? {} : { probeIdentity: opts.probeIdentity }),
      },
    },
    servers: Object.fromEntries(
      servers.map((s) => [
        s,
        { target: 'mock', clientId: `gw-${s}`, clientCredentialRef: `secretRef://binding/${s}/c` },
      ]),
    ),
  });
}

const TOOLS = [
  { toolId: 'jde.ap.voucher.create', serverId: 'jde-fin-ap' },
  { toolId: 'jde.fin.journal.create', serverId: 'jde-fin-gl' },
];
const credential = (ref: string) => ({
  ref,
  secretStore: { get: () => Promise.resolve({ revealSecretValue: () => 'x' }) },
});

describe('the auth check says why a token could not be acquired', () => {
  it('fails with the exchange’s own reason, never an assumed pass and never a crash', async () => {
    const executor = createFunctionProbeExecutor({
      client: { call: () => Promise.reject(new Error('unused')) },
      testIdentity: 'probe@x',
      acquireToken: () =>
        Promise.reject(new Error('No credential is stored for secretRef://binding/jde-fin-ap/c.')),
    });
    const result = await executor.run({
      toolId: 'jde.ap.voucher.create',
      bindingType: 'function',
      write: true,
      ref: 'AP_VOUCHER_CREATE',
      refVersion: null,
      check: { name: 'auth_token_for_test_identity' } as never,
      correlationId: 'c',
    });
    expect(result.result).toBe('fail');
    expect(result.detail).toContain('No credential is stored');
  });
});

describe('wireFunctionProbe', () => {
  it('wires one executor for every server, each probed as its target’s probeIdentity', () => {
    const wiring = wireFunctionProbe({
      overlay: overlay({ probeIdentity: 'probe@x' }),
      tools: TOOLS,
      credential,
    });
    expect(wiring.ok).toBe(true);
    if (!wiring.ok) return;
    expect(wiring.executor.bindingType).toBe('function');
    expect([...wiring.probeIdentityByServer.entries()]).toEqual([
      ['jde-fin-ap', 'probe@x'],
      ['jde-fin-gl', 'probe@x'],
    ]);
  });

  it('refuses when the target names no probeIdentity, naming where to put one', () => {
    const wiring = wireFunctionProbe({ overlay: overlay(), tools: TOOLS, credential });
    expect(wiring.ok).toBe(false);
    if (wiring.ok) return;
    expect(wiring.problems.map((p) => p.serverId)).toEqual(['jde-fin-ap', 'jde-fin-gl']);
    expect(wiring.problems[0]!.next).toContain('probeIdentity');
    expect(wiring.problems[0]!.next).toContain('targets.mock');
  });

  it('refuses a server with no AIS target, naming the server', () => {
    const wiring = wireFunctionProbe({
      overlay: overlay({ probeIdentity: 'probe@x', servers: ['jde-fin-ap'] }),
      tools: TOOLS,
      credential,
    });
    expect(wiring.ok).toBe(false);
    if (wiring.ok) return;
    expect(wiring.problems).toHaveLength(1);
    expect(wiring.problems[0]!.next).toContain('servers.jde-fin-gl');
  });

  it('fails a check for a tool it was not given, rather than running it under another server', async () => {
    const wiring = wireFunctionProbe({
      overlay: overlay({ probeIdentity: 'probe@x' }),
      tools: TOOLS,
      credential,
    });
    if (!wiring.ok) throw new Error('expected wiring');
    const result = await wiring.executor.run({
      toolId: 'jde.scm.purchase_order.create',
      bindingType: 'function',
      write: true,
      ref: 'PO_CREATE',
      refVersion: null,
      check: { name: 'whoami' } as never,
      correlationId: 'c',
    });
    expect(result.result).toBe('fail');
    expect(result.detail).toContain('not wired');
  });
});
