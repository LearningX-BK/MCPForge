// MCPForge — W0-E7: the tracer produces one span per stage, and 'none' truly exports nothing.
import { describe, expect, it } from 'vitest';
import { createGatewayTelemetry } from './tracer.js';
import { BUDGET_STAGES } from './stages.js';

describe('createGatewayTelemetry with the memory exporter', () => {
  it('records exactly one span per stage it wraps, named for that stage', async () => {
    const telemetry = createGatewayTelemetry({ exporter: 'memory' });
    try {
      for (const stage of BUDGET_STAGES) {
        await telemetry.withStageSpan(stage.id, () => 'ok');
      }
      const spans = telemetry.exportedSpans?.getFinishedSpans() ?? [];
      expect(spans).toHaveLength(BUDGET_STAGES.length);
      const names = spans.map((s) => s.name).sort();
      expect(names).toEqual(BUDGET_STAGES.map((s) => s.spanName).sort());
    } finally {
      await telemetry.shutdown();
    }
  });

  it('returns the wrapped function value and a non-negative duration', async () => {
    const telemetry = createGatewayTelemetry({ exporter: 'memory' });
    try {
      const result = await telemetry.withStageSpan('scope_resolution', () => 42);
      expect(result.value).toBe(42);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await telemetry.shutdown();
    }
  });

  it('records an ERROR-status span and still re-throws when the wrapped work throws', async () => {
    const telemetry = createGatewayTelemetry({ exporter: 'memory' });
    try {
      await expect(
        telemetry.withStageSpan('policy_chain', () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      const spans = telemetry.exportedSpans?.getFinishedSpans() ?? [];
      expect(spans).toHaveLength(1);
      expect(spans[0]?.status.code).toBe(2 /* SpanStatusCode.ERROR */);
    } finally {
      await telemetry.shutdown();
    }
  });
});

describe("createGatewayTelemetry with exporter 'none'", () => {
  it('produces spans (the API works) but exports none of them anywhere', async () => {
    const telemetry = createGatewayTelemetry({ exporter: 'none' });
    try {
      const result = await telemetry.withStageSpan('audit_write', () => 'value-from-stage');
      expect(result.value).toBe('value-from-stage');
      expect(telemetry.exportedSpans).toBeUndefined();
      expect(telemetry.exporterKind).toBe('none');
    } finally {
      await telemetry.shutdown();
    }
  });
});
