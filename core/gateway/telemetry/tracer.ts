// MCPForge — the gateway's OTel tracer. W0-E7.
//
// PACKAGE CHOICE: `@opentelemetry/api` for the vendor-neutral span surface,
// `@opentelemetry/sdk-trace-node` for `NodeTracerProvider` (Wave 0's Node
// runtime — CLAUDE.md §3), `@opentelemetry/sdk-trace-base` for the exporters
// and `SimpleSpanProcessor`/`NoopSpanProcessor`, `@opentelemetry/resources` to
// name the service on every span. No OTLP exporter package: Wave 0 has no
// collector to send to (CLAUDE.md §3.1 — no cloud/managed service may become a
// Wave 0 prerequisite), so `./exporter.ts`'s console/memory/none seam is the
// whole story until a later wave adds one behind the same seam.
//
// NOT registered globally. `createGatewayTelemetry` builds and returns its own
// `NodeTracerProvider`; it never calls `.register()` and never touches
// `trace.setGlobalTracerProvider`. Two reasons: (1) tests construct several
// instances (an enabled one and a disabled one) in the same process and must
// not have the second silently take over the first's global; (2) "structurally
// separate from audit" is easiest to prove when nothing here is reachable
// through ambient global state at all — a caller must be handed this exact
// `GatewayTelemetry` value to produce a span through it.

import { SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  NoopSpanProcessor,
  SimpleSpanProcessor,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  createTelemetryExporter,
  type TelemetryExporterHandle,
  type TelemetryExporterKind,
} from './exporter.js';
import { budgetStage, type BudgetStageId } from './stages.js';

export interface GatewayTelemetryOptions {
  /** Defaults to `'none'` — telemetry is opt-in, never a silent default sink. */
  readonly exporter?: TelemetryExporterKind;
  /** `service.name` on every span. Defaults to `'mcpforge-gateway'`. */
  readonly serviceName?: string;
}

export interface StageSpanResult<T> {
  readonly value: T;
  /** Wall time inside the span, for reporting against the 02 §4.8 budget row. */
  readonly durationMs: number;
}

export interface GatewayTelemetry {
  readonly exporterKind: TelemetryExporterKind;
  /** `undefined` unless constructed with `exporter: 'memory'` — read spans back in tests. */
  readonly exportedSpans: TelemetryExporterHandle['memory'];
  readonly tracer: Tracer;
  /**
   * Run `fn` inside one span named for `stageId` (`gateway.stage.<id>`,
   * ./stages.ts), tagging it with the stage's own 02 §4.8 budget so a span can
   * be compared to its row without a second lookup. Records an exception and
   * ERROR status on throw, then re-throws — a stage's failure is never hidden
   * by its own instrumentation.
   */
  withStageSpan<T>(
    stageId: BudgetStageId,
    fn: (span: Span) => T | Promise<T>,
  ): Promise<StageSpanResult<T>>;
  /** Flush and stop the underlying processor. Idempotent per-instance. */
  shutdown(): Promise<void>;
}

function processorFor(handle: TelemetryExporterHandle): SpanProcessor {
  // `'none'` gets a NoopSpanProcessor, not "no processor" — the provider still
  // requires one, and Noop is the documented way to make every span a no-op
  // all the way through `onStart`/`onEnd`/export without a conditional at every
  // call site that creates a span.
  if (handle.exporter === undefined) return new NoopSpanProcessor();
  return new SimpleSpanProcessor(handle.exporter);
}

export function createGatewayTelemetry(options: GatewayTelemetryOptions = {}): GatewayTelemetry {
  const exporterKind = options.exporter ?? 'none';
  const serviceName = options.serviceName ?? 'mcpforge-gateway';
  const handle = createTelemetryExporter(exporterKind);

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
    spanProcessors: [processorFor(handle)],
  });

  const tracer = provider.getTracer('mcpforge-gateway-telemetry');

  return {
    exporterKind,
    exportedSpans: handle.memory,
    tracer,
    async withStageSpan<T>(stageId: BudgetStageId, fn: (span: Span) => T | Promise<T>) {
      const spec = budgetStage(stageId);
      const span = tracer.startSpan(spec.spanName, {
        attributes: {
          'mcpforge.budget.stage_id': spec.id,
          'mcpforge.budget.label': spec.label,
          'mcpforge.budget.ms': spec.budgetMs,
        },
      });
      const start = performance.now();
      try {
        const value = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return { value, durationMs: performance.now() - start };
      } catch (cause) {
        span.recordException(cause instanceof Error ? cause : String(cause));
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: cause instanceof Error ? cause.message : String(cause),
        });
        throw cause;
      } finally {
        span.end();
      }
    },
    async shutdown() {
      await provider.shutdown();
    },
  };
}

/** A telemetry instance that produces spans but never queues or exports one. Wave 0's default. */
export function createDisabledGatewayTelemetry(): GatewayTelemetry {
  return createGatewayTelemetry({ exporter: 'none' });
}
