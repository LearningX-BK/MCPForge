// MCPForge — W0-K2 proofs. 02 §6.5: "same image, one environment variable",
// and the both-modes CI matrix (02 §7.2 row 7) runs exactly this file (its
// name matches the `contract` filter `tools/ci/src/stages.ts` stage 7 uses)
// under `MCPFORGE_MODE=headless` and again under `MCPFORGE_MODE=full`.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { GATEWAY_MODES, launchGateway, parseGatewayMode } from './launch.js';

function fakeChildProcess(): ChildProcess {
  const emitter = new EventEmitter() as ChildProcess;
  (emitter as unknown as { kill: () => boolean }).kill = () => true;
  return emitter;
}

function emptyRepoRoot(): string {
  // No `consumers/` dir at all — `loadConsumerRegistry` treats that as a
  // valid, empty registry (registry.ts: "if (!existsSync(dir)) return {
  // consumers: [], failures: [] }"), so this is a real (if empty) registry,
  // not a stub standing in for one.
  return mkdtempSync(join(tmpdir(), 'mcpforge-launch-'));
}

describe('parseGatewayMode — the closed MCPFORGE_MODE vocabulary', () => {
  it('defaults to full when unset', () => {
    expect(parseGatewayMode({ MCPFORGE_MODE: undefined })).toBe('full');
  });

  it('accepts headless', () => {
    expect(parseGatewayMode({ MCPFORGE_MODE: 'headless' })).toBe('headless');
  });

  it('accepts full', () => {
    expect(parseGatewayMode({ MCPFORGE_MODE: 'full' })).toBe('full');
  });

  it('refuses anything outside the closed vocabulary — no silent fallback', () => {
    expect(() => parseGatewayMode({ MCPFORGE_MODE: 'staging' })).toThrow(/Unknown MCPFORGE_MODE/);
  });

  it('the vocabulary is exactly {headless, full} — nothing wider is a mode', () => {
    expect(GATEWAY_MODES).toEqual(['headless', 'full']);
  });
});

describe('launchGateway — same assembly, one process-start decision', () => {
  const roots: string[] = [];
  function root(): string {
    const r = emptyRepoRoot();
    roots.push(r);
    return r;
  }

  afterEach(() => {
    for (const r of roots.splice(0)) {
      rmSync(r, { recursive: true, force: true });
    }
  });

  it('headless mode starts the gateway and spawns no portal process', async () => {
    let spawnCalls = 0;
    const launched = await launchGateway({
      repoRoot: root(),
      mode: 'headless',
      spawnPortal: () => {
        spawnCalls += 1;
        return fakeChildProcess();
      },
    });
    try {
      expect(launched.mode).toBe('headless');
      expect(launched.portal).toBeNull();
      expect(spawnCalls).toBe(0);
      expect(launched.gatewayPort).toBeGreaterThan(0);
    } finally {
      await launched.close();
    }
  });

  it('full mode starts the SAME gateway assembly and additionally spawns the portal', async () => {
    let spawnCalls = 0;
    const launched = await launchGateway({
      repoRoot: root(),
      mode: 'full',
      spawnPortal: () => {
        spawnCalls += 1;
        return fakeChildProcess();
      },
    });
    try {
      expect(launched.mode).toBe('full');
      expect(launched.portal).not.toBeNull();
      expect(spawnCalls).toBe(1);
      expect(launched.gatewayPort).toBeGreaterThan(0);
    } finally {
      await launched.close();
    }
  });

  it('an unregistered/unpresented consumer is refused identically in both modes — headless changes nothing about session establishment (02 §6.5 is a process-start decision, not a security posture change)', async () => {
    for (const mode of GATEWAY_MODES) {
      const launched = await launchGateway({
        repoRoot: root(),
        mode,
        spawnPortal: () => fakeChildProcess(),
      });
      try {
        const response = await fetch(`http://127.0.0.1:${launched.gatewayPort}/mcp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
          }),
        });
        expect(response.status).toBe(401);
        const body: unknown = await response.json();
        expect((body as { error: { data: { code: string } } }).error.data.code).toBe(
          'CONSUMER_UNREGISTERED',
        );
      } finally {
        await launched.close();
      }
    }
  });
});
