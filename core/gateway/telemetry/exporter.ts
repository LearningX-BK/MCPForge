// MCPForge — telemetry exporters. W0-E7.
//
// Wave 0 local-first (CLAUDE.md §3.1): no OTel Collector, no managed tracing
// backend is a Wave 0 prerequisite. Two real exporters plus an explicit "off"
// switch are enough to prove the shape; a production OTLP exporter is a later,
// additive choice behind the same `TelemetryExporterKind` seam.
//
// STRUCTURAL SEPARATION FROM AUDIT (the done criterion's second half): this
// file has no import of, and no reference to, `core/gateway/store/audit/**`.
// A span here is produced by the OTel SDK's own processor/exporter pipeline —
// a different in-process queue, a different failure mode — and `'none'` below
// does not merely mute output, it installs a processor that never queues or
// exports a span at all. Nothing about disabling it can touch the store.

import {
  InMemorySpanExporter,
  ConsoleSpanExporter,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';

/** `'none'` is the exporter the done-criterion test disables telemetry with. */
export type TelemetryExporterKind = 'console' | 'memory' | 'none';

export interface TelemetryExporterHandle {
  readonly kind: TelemetryExporterKind;
  /** `undefined` for `'none'` — there is nothing to attach a processor to. */
  readonly exporter: SpanExporter | undefined;
  /** Only populated for `'memory'`; read spans back in tests without a collector. */
  readonly memory: InMemorySpanExporter | undefined;
}

/**
 * Build the exporter named by `kind`. Never throws for a recognised kind, and
 * a `'none'` handle carries no exporter at all rather than a swallowing one —
 * so a caller that forgets to check `kind` cannot accidentally export.
 */
export function createTelemetryExporter(kind: TelemetryExporterKind): TelemetryExporterHandle {
  switch (kind) {
    case 'console':
      return { kind, exporter: new ConsoleSpanExporter(), memory: undefined };
    case 'memory': {
      const memory = new InMemorySpanExporter();
      return { kind, exporter: memory, memory };
    }
    case 'none':
      return { kind, exporter: undefined, memory: undefined };
  }
}
