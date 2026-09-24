// MCPForge — the call-time kill-switch check. W0-E5.

import { describe, expect, it } from 'vitest';
import { inMemoryRuntimeFlags, noProbeReport } from '../scope/sources.js';
import type { ScopeCatalogueEntry, ScopeContext } from '../scope/types.js';
import { killSwitchRefusalError } from './checks.js';

const ENTRY: ScopeCatalogueEntry = {
  toolId: 'jde.ap.voucher.create',
  serverId: 'ebs-p2p-ap',
  bindingType: 'plsql',
  sensitivity: 'financial',
  write: true,
};

function ctxWith(flags: ScopeContext['flags']): ScopeContext {
  return {
    deployment: { deploymentId: 'dep-1', packageIds: [] },
    packageSelections: new Map(),
    roleScopes: new Map(),
    session: {
      principal: { subject: 'user:aisha.khan@ltm.example' } as ScopeContext['session']['principal'],
      heldRoleIds: [],
      consumer: {
        consumerId: 'agent-x',
        effectiveStatus: 'active',
        authorizations: {
          bindingTypes: ['plsql'],
          maxSensitivity: 'financial',
          writeAllowed: true,
          roles: [],
          packages: [],
        },
        attestation: { humanInTheLoop: true },
      },
      consumerSession: {
        consumerId: 'agent-x',
        recordSha: 'b'.repeat(64),
        authMethod: 'private-key-jwt',
        consumerSessionId: 'mcp-session-flags',
      },
      activation: { mode: 'default' },
    },
    probe: noProbeReport(),
    flags,
    now: new Date('2026-01-01T00:00:00.000Z'),
  };
}

describe('killSwitchRefusalError', () => {
  it('returns null when nothing is kill-switched', () => {
    const ctx = ctxWith(inMemoryRuntimeFlags([]));
    expect(killSwitchRefusalError(ENTRY, ctx, 'corr-1')).toBeNull();
  });

  it("returns a TOOL_DISABLED ForgeError carrying the flag's own reason and a non-empty next, for a tool-scope kill", () => {
    const ctx = ctxWith(
      inMemoryRuntimeFlags([
        { scope: 'tool', target: ENTRY.toolId, reason: 'binding regression', until: null },
      ]),
    );
    const error = killSwitchRefusalError(ENTRY, ctx, 'corr-2');
    expect(error?.code).toBe('TOOL_DISABLED');
    expect(error?.message).toContain('binding regression');
    expect(error?.next.trim().length).toBeGreaterThan(0);
  });

  it('returns CONSUMER_SUSPENDED for a consumer-scope kill, naming the reason', () => {
    const ctx = ctxWith(
      inMemoryRuntimeFlags([
        { scope: 'consumer', target: 'agent-x', reason: 'burst-write anomaly', until: null },
      ]),
    );
    const error = killSwitchRefusalError(ENTRY, ctx, 'corr-3');
    expect(error?.code).toBe('CONSUMER_SUSPENDED');
    expect(error?.message).toContain('burst-write anomaly');
  });

  it('an expired --until flag no longer refuses', () => {
    const ctx = ctxWith(
      inMemoryRuntimeFlags([
        {
          scope: 'tool',
          target: ENTRY.toolId,
          reason: 'temporary freeze',
          until: new Date('2025-01-01T00:00:00.000Z'),
        },
      ]),
    );
    expect(killSwitchRefusalError(ENTRY, ctx, 'corr-4')).toBeNull();
  });

  it.each(['moduleServer', 'bindingType', 'deployment'] as const)(
    '%s-scope kill also refuses with TOOL_DISABLED',
    (scope) => {
      const target =
        scope === 'moduleServer'
          ? ENTRY.serverId
          : scope === 'bindingType'
            ? ENTRY.bindingType
            : 'dep-1';
      const ctx = ctxWith(inMemoryRuntimeFlags([{ scope, target, reason: 'freeze', until: null }]));
      const error = killSwitchRefusalError(ENTRY, ctx, 'corr-5');
      expect(error?.code).toBe('TOOL_DISABLED');
    },
  );
});
