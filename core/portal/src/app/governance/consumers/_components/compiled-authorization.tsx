// MCPForge — W0-N12: the right pane. The compiled authorization artefact,
// rendered EXPLICITLY (03 §16.2).
//
// The role editor's right pane renders an explicit tool-id list because a role
// is a grant of visibility. A consumer's grant is six-dimensional — binding
// types, sensitivity ceiling, write, roles, packages, and the elevated grants
// — so "explicitly" means every one of those dimensions is on screen as its
// own value, with what this edit adds and removes marked, and the artefact's
// own bytes available underneath. There is no summary and no "N authorizations"
// count standing in for the list.
//
// This component synthesises NOTHING: it renders `CompiledConsumerDraft` and
// nothing else, and that value comes from `_lib/compile-consumer.ts`, which
// runs the real codegen.
import * as React from 'react';
import { cn } from 'cn';

import { ElevatedGrantPanel } from './elevated-grant-panel';
import type { AuthorizationListDelta, CompiledConsumerDraft } from '../types';

const LIST_LABEL: Readonly<Record<string, string>> = {
  bindingTypes: 'Binding types',
  roles: 'Roles',
  packages: 'Packages',
  networkOrigins: 'Network origins',
};

const LIST_EMPTY: Readonly<Record<string, string>> = {
  bindingTypes: 'none — this consumer may execute no binding at all',
  roles: 'none — this consumer may act within no role',
  packages: 'none',
  networkOrigins: 'unpinned — any origin',
};

function DeltaList({ delta }: { delta: AuthorizationListDelta }) {
  const added = new Set(delta.added);
  const rows = [...new Set([...delta.values, ...delta.removed])].sort();
  const removed = new Set(delta.removed);
  return (
    <div data-testid={`auth-list-${delta.field}`} className="flex flex-col gap-1">
      <p className="text-[12px] font-semibold text-text-1">{LIST_LABEL[delta.field] ?? delta.field}</p>
      {rows.length === 0 ? (
        <p className="text-[12px] text-text-2">{LIST_EMPTY[delta.field] ?? 'none'}</p>
      ) : (
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {rows.map((value) => {
            const state = removed.has(value) ? 'removed' : added.has(value) ? 'added' : 'unchanged';
            return (
              <li
                key={value}
                data-testid={`auth-value-${state}`}
                data-field={delta.field}
                data-value={value}
                className={cn(
                  'font-mono text-[12.5px]',
                  state === 'added'
                    ? 'text-status-ok-strong'
                    : state === 'removed'
                      ? 'text-status-danger-strong line-through'
                      : 'text-text-1',
                )}
              >
                <span aria-hidden="true">
                  {state === 'added' ? '+' : state === 'removed' ? '−' : ' '}{' '}
                </span>
                {value}
                <span className="sr-only"> — {state}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export interface CompiledAuthorizationProps {
  draft: CompiledConsumerDraft | undefined;
  compiling: boolean;
  artefactPath: string;
}

export function CompiledAuthorization({
  draft,
  compiling,
  artefactPath,
}: CompiledAuthorizationProps) {
  return (
    <section aria-labelledby="compiled-authorization-heading" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="compiled-authorization-heading" className="font-display text-base text-text-1">
          Compiled authorization
        </h2>
        <span data-testid="compile-state" className="font-mono text-[12px] text-text-2">
          {compiling ? 'compiling…' : draft === undefined ? 'not yet compiled' : artefactPath}
        </span>
      </div>

      {draft?.error !== undefined ? (
        <div
          data-testid="compile-error"
          role="alert"
          className="rounded-lg border border-status-danger-border bg-status-danger-bg p-3"
        >
          <p className="text-[12.5px] font-semibold text-status-danger-strong">
            {draft.error.message}
          </p>
          <p className="mt-1 text-[12px] text-text-1">{draft.error.next}</p>
        </div>
      ) : draft === undefined ? (
        <p className="text-[12.5px] text-text-2">
          Edit the record on the left and its compiled authorization appears here.
        </p>
      ) : (
        <>
          <div
            data-testid="compiled-authorization"
            className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3"
          >
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[12.5px]">
              <dt className="text-text-2">Effective status</dt>
              <dd data-testid="auth-effective-status" className="font-mono text-text-1">
                {draft.effectiveStatus}
                {draft.expired ? ' (registration expired)' : ''}
              </dd>
              <dt className="text-text-2">Registration expires</dt>
              <dd className="font-mono text-text-1">{draft.expiresAt}</dd>
              <dt className="text-text-2">Sensitivity ceiling</dt>
              <dd data-testid="auth-max-sensitivity" className="font-mono text-text-1">
                {draft.maxSensitivity}
              </dd>
              <dt className="text-text-2">Writes</dt>
              <dd data-testid="auth-write-allowed" className="font-mono text-text-1">
                {draft.writeAllowed ? 'allowed' : 'not allowed'}
              </dd>
              <dt className="text-text-2">Human in the loop</dt>
              <dd data-testid="auth-human-in-the-loop" className="text-text-1">
                {draft.humanInTheLoop
                  ? 'yes'
                  : 'no — every write this consumer attempts forces a human approval'}
              </dd>
            </dl>

            {draft.listDeltas.map((delta) => (
              <DeltaList key={delta.field} delta={delta} />
            ))}

            <div className="flex flex-col gap-1">
              <p className="text-[12px] font-semibold text-text-1">Limits</p>
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {draft.limits.map((row) => (
                  <li
                    key={row.field}
                    data-testid={`auth-limit-${row.field}`}
                    className="font-mono text-[12.5px] text-text-1"
                  >
                    {row.field}: {row.value}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {draft.scalarDeltas.length === 0 ? null : (
            <div
              data-testid="auth-scalar-deltas"
              className="rounded-lg border border-status-write-border bg-status-write-bg p-3"
            >
              <p className="text-[12.5px] font-semibold text-status-write-strong">
                This edit changes what the consumer may do
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {draft.scalarDeltas.map((d) => (
                  <li
                    key={d.field}
                    data-testid={`auth-scalar-${d.field}`}
                    className="font-mono text-[12px] text-text-1"
                  >
                    {d.field}: {d.before === '' ? '(unset)' : d.before} → {d.after}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ElevatedGrantPanel grants={draft.grants} />

          <details className="rounded-lg border border-line bg-surface-2 p-3">
            <summary className="cursor-pointer text-[12.5px] text-text-1">
              The artefact bytes this proposal carries
            </summary>
            <pre
              data-testid="artefact-json"
              tabIndex={0}
              aria-label="Artefact JSON"
              className="mt-2 max-h-[320px] overflow-auto font-mono text-[11.5px] text-text-2"
            >
              {draft.artefactJson}
            </pre>
          </details>
        </>
      )}
    </section>
  );
}
