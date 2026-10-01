'use client';
// MCPForge — W0-P33d: "Run probe" on the enablement backlog, for a super admin.
//
// Decision D of the approved W0-P33 design note: a merged tool reads "Not
// probed" and cannot execute until a probe enables it, and in a `local`
// deployment a super admin may start that probe here. The button decides
// nothing: the gateway checks the viewer, the consumer and the environment
// class, and in `probe`, `staging` or `prod` it refuses with the `forge probe`
// command to run instead. That refusal is shown verbatim with its `next`.

import * as React from 'react';

import { PROBE_STATUS, type ProbeStatus } from '@mcpforge/shared';

import { Button } from '@/components/ui/button';

import type { ProbeRunState } from './actions';

export interface ProbeRunPanelProps {
  /** The server action. Injected so a test can drive the panel without a server. */
  readonly action: (prev: ProbeRunState, form: FormData) => Promise<ProbeRunState>;
}

const IDLE: ProbeRunState = { status: 'idle' };

function statusLabel(status: string): string {
  const entry = PROBE_STATUS[status as ProbeStatus] as
    (typeof PROBE_STATUS)[ProbeStatus] | undefined;
  return entry?.label ?? status;
}

export function ProbeRunPanel({ action }: ProbeRunPanelProps) {
  const [state, formAction, pending] = React.useActionState(action, IDLE);
  const headingId = React.useId();

  return (
    <form
      action={formAction}
      data-testid="probe-run-panel"
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
    >
      <h2 id={headingId} className="text-sm font-bold text-text-1">
        Capability probe
      </h2>
      <p className="max-w-[70ch] text-[13px] text-text-2">
        Runs the probe for this deployment, then reloads the gateway so the new statuses are what it
        serves. Its checks are read-only or validate-only. The portal runs it in a local deployment
        only; anywhere else it stays a <code className="font-mono">forge probe</code> command on the
        gateway host. Super admins only, and every run is recorded in the audit trail.
      </p>

      {state.status === 'ran' ? (
        <section
          role="status"
          data-testid="probe-run-done"
          data-served={state.served ? 'true' : 'false'}
          className={
            state.served
              ? 'flex flex-col gap-1 rounded-lg border border-status-ok-border bg-status-ok-bg p-3 text-[13px] text-status-ok-strong'
              : 'flex flex-col gap-1 rounded-lg border border-status-write-border bg-status-write-bg p-3 text-[13px] text-status-write-strong'
          }
        >
          <p className="font-semibold">
            Probe finished ({state.environmentClass}): {state.toolCount} tool
            {state.toolCount === 1 ? '' : 's'}.
          </p>
          <ul data-testid="probe-run-counts" className="flex flex-wrap gap-x-4 gap-y-1">
            {Object.entries(state.byStatus).map(([status, count]) => (
              <li key={status}>
                {statusLabel(status)}: {count}
              </li>
            ))}
          </ul>
          <p data-testid="probe-run-next">
            <span className="font-semibold">Next: </span>
            {state.next}
          </p>
          <p className="text-[12px] opacity-80">
            Audit call <code className="font-mono">{state.auditCallId}</code>
          </p>
        </section>
      ) : null}

      {state.status === 'refused' ? (
        <section
          role="alert"
          data-testid="probe-run-refused"
          className="flex flex-col gap-1 rounded-lg border border-status-write-border bg-status-write-bg p-3 text-[13px] text-status-write-strong"
        >
          <p className="font-semibold">
            No probe ran{state.code === undefined ? '' : ` (${state.code})`}: {state.message}
          </p>
          <p data-testid="probe-run-refused-next">
            <span className="font-semibold">Next: </span>
            {state.next}
          </p>
          {state.correlationId === undefined ? null : (
            <p className="text-[12px] opacity-80">
              Correlation id <code className="font-mono">{state.correlationId}</code>
            </p>
          )}
        </section>
      ) : null}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Probing…' : 'Run probe'}
        </Button>
      </div>
    </form>
  );
}
