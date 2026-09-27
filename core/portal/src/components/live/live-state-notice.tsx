// MCPForge — W0-P3b: what a live page shows when it has no data to show.
//
// W0-P2 §4(c): "A gateway-down state must be visibly distinct from an empty
// state, because 'no audit rows yet' and 'cannot reach the gateway' must never
// look alike." So there is exactly one component for the four not-ok states of
// a `ReadResult`, each with its own tone, icon, title and test id. There are no
// skeleton rows behind it, and every state carries its `next` (non-negotiable 5,
// applied to a human surface). An EMPTY state is not one of these: it is the
// page's own copy, rendered only when the read succeeded and returned nothing.
//
// Server-safe: no hooks and no client APIs, so a server page can render it.

import { cn } from 'cn';

import { StatusIcon } from '../chips/icon';

export type LiveNotice =
  | { readonly kind: 'signed-out'; readonly next: string }
  | { readonly kind: 'gateway-down'; readonly endpoint: string; readonly next: string }
  | {
      readonly kind: 'refused';
      readonly code: string;
      readonly message: string;
      readonly next: string;
      readonly correlationId?: string;
    }
  | { readonly kind: 'not-found'; readonly message: string; readonly next: string };

export interface LiveStateNoticeProps {
  readonly state: LiveNotice;
  /** What this panel would have shown, e.g. "Calls". Named in the title. */
  readonly subject: string;
  readonly className?: string;
}

const TONE: Record<LiveNotice['kind'], string> = {
  'gateway-down': 'border-status-danger-border bg-status-danger-bg text-status-danger-strong',
  refused: 'border-status-write-border bg-status-write-bg text-status-write-strong',
  'signed-out': 'border-status-neutral-border bg-status-neutral-bg text-status-neutral-strong',
  'not-found': 'border-status-neutral-border bg-status-neutral-bg text-status-neutral-strong',
};

const ICON: Record<LiveNotice['kind'], string> = {
  'gateway-down': 'Unplug',
  refused: 'ShieldAlert',
  'signed-out': 'LogIn',
  'not-found': 'SearchX',
};

function title(state: LiveNotice, subject: string): string {
  switch (state.kind) {
    case 'gateway-down':
      return `${subject}: cannot reach the gateway`;
    case 'refused':
      return `${subject}: the gateway refused this read (${state.code})`;
    case 'signed-out':
      return `${subject}: sign in to see live data`;
    case 'not-found':
      return `${subject}: not found`;
  }
}

export function LiveStateNotice({ state, subject, className }: LiveStateNoticeProps) {
  return (
    <section
      role={state.kind === 'gateway-down' || state.kind === 'refused' ? 'alert' : 'status'}
      data-testid={`live-state-${state.kind}`}
      data-state={state.kind}
      className={cn(
        'flex w-full flex-col gap-2 rounded-lg border p-3 text-[13.5px]/[1.55]',
        TONE[state.kind],
        className,
      )}
    >
      <h2 className="flex items-center gap-2 text-[14px]/[1.5] font-semibold">
        <StatusIcon name={ICON[state.kind]} className="size-4 shrink-0" aria-hidden />
        <span>{title(state, subject)}</span>
      </h2>
      {state.kind === 'gateway-down' ? (
        <p>
          The portal could not reach the gateway at{' '}
          <code className="font-mono text-[12.5px]" data-testid="live-state-endpoint">
            {state.endpoint}
          </code>
          . This is not an empty result.
        </p>
      ) : null}
      {state.kind === 'refused' || state.kind === 'not-found' ? <p>{state.message}</p> : null}
      <p data-testid="live-state-next">
        <span className="font-semibold">Next: </span>
        {state.next}
      </p>
      {state.kind === 'refused' && state.correlationId !== undefined ? (
        <p className="text-[12px] opacity-80">
          Correlation id <code className="font-mono">{state.correlationId}</code>
        </p>
      ) : null}
      {state.kind === 'signed-out' ? (
        <p>
          <a className="underline" href="/sign-in">
            Sign in
          </a>
        </p>
      ) : null}
    </section>
  );
}
