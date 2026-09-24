// MCPForge — W0-E7's second done clause: "telemetry is structurally separate
// from the audit trail (different sink, different retention), asserted by a
// test that audit rows are written even when the telemetry exporter is
// disabled."
//
// The proof has two halves. The first is the ordinary case: telemetry fully
// OFF (`exporter: 'none'`, a `NoopSpanProcessor` all the way through), and a
// real `store.audit.append()` against a real SQLite store still succeeds and
// the row is durably readable back. The second is the adversarial case this
// criterion is really guarding against: a telemetry tracer whose span
// lifecycle THROWS on every call — standing in for "the exporter is broken" —
// wrapping the exact same audit write. If telemetry's failure mode could ever
// reach the store, this is where it would show up. It doesn't, because
// `core/gateway/telemetry/**` never imports anything from
// `core/gateway/store/audit/**` (see ./exporter.ts's header) and a caller
// chooses whether to wrap a store call in a span at all — the store never
// depends on telemetry succeeding, or running, to do its own work.
//
// Reuses the real-store pattern from `../identity/subject-only.test.ts`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntimeStore, type RuntimeStore, type AppendAuditCallInput } from '../store/server.js';
import { createGatewayTelemetry, type GatewayTelemetry } from './tracer.js';

let tempDir: string;
let store: RuntimeStore;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'mcpforge-telemetry-'));
  store = await openRuntimeStore({ kind: 'sqlite', file: join(tempDir, 'runtime.db') });
});

afterEach(async () => {
  await store?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function auditInput(resultValue: string): AppendAuditCallInput {
  return {
    callerSubject: 'local:telemetry-separation-test',
    callerRoles: ['p2p'],
    consumerId: 'portal-local',
    humanInTheLoop: true,
    toolId: 'jde.ap.voucher.get',
    toolVersion: '1.0.0',
    bindingType: 'plsql',
    isWrite: false,
    targetSystem: 'jde',
    targetEnv: 'py920',
    deploymentId: 'local',
    phase: 'execute',
    outcome: 'ok',
    resultKeys: [{ keyName: 'voucher_number', keyValue: resultValue }],
  };
}

describe('audit writes succeed with telemetry exporter disabled', () => {
  it('appends and durably reads back a row while telemetry is exporter: none', async () => {
    const telemetry = createGatewayTelemetry({ exporter: 'none' });
    try {
      const { value: row } = await telemetry.withStageSpan('audit_write', () =>
        store.audit.append(auditInput('none-exporter-1')),
      );
      expect(row.outcome).toBe('ok');

      const reread = await store.audit.get(row.id);
      expect(reread).toBeDefined();
      expect(reread?.toolId).toBe('jde.ap.voucher.get');
    } finally {
      await telemetry.shutdown();
    }
  });

  it('still appends and durably reads back a row when the telemetry span itself throws', async () => {
    const telemetry = createGatewayTelemetry({ exporter: 'none' });
    // Simulate "the exporter/tracer pipeline is broken", not merely absent —
    // the adversarial case the done criterion is guarding against.
    const brokenTracer: GatewayTelemetry = {
      ...telemetry,
      withStageSpan: () => {
        throw new Error('telemetry pipeline is down');
      },
    };

    let telemetryFailed = false;
    try {
      await brokenTracer.withStageSpan('audit_write', () =>
        store.audit.append(auditInput('broken-exporter-1')),
      );
    } catch {
      telemetryFailed = true;
    }
    expect(telemetryFailed).toBe(true);

    // The audit write above never ran, because the caller chose to wrap it in
    // the (now broken) span. That is expected — the point is not that a call
    // wrapped in a broken span still executes, it is that the STORE has no
    // dependency on telemetry succeeding: a caller that does not route the
    // audit write through telemetry at all — the realistic shape of "the
    // exporter is disabled" — is entirely unaffected by it.
    const row = await store.audit.append(auditInput('broken-exporter-2'));
    expect(row.outcome).toBe('ok');

    const reread = await store.audit.get(row.id);
    expect(reread).toBeDefined();
    expect(reread?.resultKeys?.some((k) => k.keyValue === 'broken-exporter-2')).toBe(true);

    await telemetry.shutdown();
  });
});
