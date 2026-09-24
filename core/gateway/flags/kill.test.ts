// MCPForge — `forge kill`'s business logic. W0-E5.

import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntimeStore } from '../store/store.js';
import type { RuntimeStore } from '../store/repository.js';
import { applyKill, InvalidKillTargetError, KILL_TOOL_ID, parseKillTarget } from './kill.js';

describe('parseKillTarget', () => {
  it('a bare tool id is tool scope', () => {
    expect(parseKillTarget('jde.ap.voucher.create')).toEqual({
      scope: 'tool',
      target: 'jde.ap.voucher.create',
    });
  });

  it.each([
    ['server:ebs-p2p-ap', 'moduleServer', 'ebs-p2p-ap'],
    ['bindingType:plsql', 'bindingType', 'plsql'],
    ['consumer:agent-x', 'consumer', 'agent-x'],
    ['deployment:dep-1', 'deployment', 'dep-1'],
  ] as const)('%s parses as %s:%s', (raw, scope, target) => {
    expect(parseKillTarget(raw)).toEqual({ scope, target });
  });

  it('rejects an empty string and an unrecognised prefix', () => {
    expect(() => parseKillTarget('')).toThrow(InvalidKillTargetError);
    expect(() => parseKillTarget('nonsense:thing')).toThrow(InvalidKillTargetError);
  });
});

describe('applyKill', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mcpforge-kill-'));

  it('writes a runtime_flags row AND an audit record naming the author and reason, for every granularity', async () => {
    const store: RuntimeStore = await openRuntimeStore({
      kind: 'sqlite',
      file: join(dir, 'runtime.db'),
    });
    try {
      const result = await applyKill(store.runtimeFlags, store.audit, {
        raw: 'consumer:agent-x',
        reason: 'suspended pending review',
        actorSubject: 'ops-bikash',
        deploymentId: 'dep-1',
      });

      expect(result.scope).toBe('consumer');
      expect(result.target).toBe('agent-x');

      const flag = await store.runtimeFlags.get(result.flagId);
      expect(flag).toMatchObject({
        scope: 'consumer',
        target: 'agent-x',
        reason: 'suspended pending review',
        createdBy: 'ops-bikash',
        active: true,
      });

      const auditRow = await store.audit.get(result.auditCallId);
      expect(auditRow).toMatchObject({
        toolId: KILL_TOOL_ID,
        callerSubject: 'ops-bikash',
        outcome: 'ok',
        isWrite: true,
        deploymentId: 'dep-1',
      });
      expect(auditRow?.resultKeys).toEqual(
        expect.arrayContaining([
          { keyName: 'kill_scope', keyValue: 'consumer' },
          { keyName: 'kill_target', keyValue: 'agent-x' },
        ]),
      );
    } finally {
      await store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records --until verbatim', async () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'mcpforge-kill-until-'));
    const store = await openRuntimeStore({ kind: 'sqlite', file: join(dir2, 'runtime.db') });
    try {
      const until = new Date('2099-06-01T00:00:00.000Z');
      const result = await applyKill(store.runtimeFlags, store.audit, {
        raw: 'jde.ap.voucher.create',
        reason: 'binding regression',
        actorSubject: 'ops-bikash',
        deploymentId: 'dep-1',
        until,
      });
      const flag = await store.runtimeFlags.get(result.flagId);
      expect(flag?.until).toBe(until.toISOString());
    } finally {
      await store.close();
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});
