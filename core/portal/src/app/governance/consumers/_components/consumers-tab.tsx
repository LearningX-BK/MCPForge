'use client';

// MCPForge — W0-N12: the Consumers tab body (03 §16.2).
//
// The table selects, the editor edits, the actions act. Selection is client
// state and the two server seams — the live compile and the Register scaffold
// — are passed in as props, exactly as `../../page.tsx` passes
// `compileRoleDraft` to `RoleEditor`, so this file holds no `node:fs` and no
// gateway call of its own.
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ConsequenceView } from '@/components/write-path';

import { ConsumerActions, type ConsumerKillRequest, type ConsumerProposalKind } from './consumer-actions';
import { ConsumerEditor, type CompileConsumerFn } from './consumer-editor';
import { RegistryTable } from './registry-table';
import type { ConsumerRowView, ConsumerSource } from '../types';

export type ScaffoldConsumerFn = (
  consumerId: string,
) => Promise<{ source?: ConsumerSource; error?: { message: string; next: string } }>;

export interface ConsumersTabProps {
  sources: readonly ConsumerSource[];
  failures?: readonly ConsumerRowView[];
  compile: CompileConsumerFn;
  scaffold: ScaffoldConsumerFn;
  deploymentId: string;
  envClass: ConsequenceView['envClass'];
  onKill?: ((request: ConsumerKillRequest) => void | Promise<void>) | undefined;
  onProposeLifecycle?:
    | ((consumerId: string, kind: ConsumerProposalKind) => void | Promise<void>)
    | undefined;
}

export function ConsumersTab({
  sources,
  failures = [],
  compile,
  scaffold,
  deploymentId,
  envClass,
  onKill,
  onProposeLifecycle,
}: ConsumersTabProps) {
  const [selectedId, setSelectedId] = React.useState<string | undefined>(sources[0]?.consumerId);
  const [drafted, setDrafted] = React.useState<ConsumerSource | undefined>(undefined);
  const [newId, setNewId] = React.useState('');
  const [registerError, setRegisterError] = React.useState<
    { message: string; next: string } | undefined
  >(undefined);

  const selected =
    drafted !== undefined && drafted.consumerId === selectedId
      ? drafted
      : sources.find((s) => s.consumerId === selectedId);

  const rows = [
    ...sources.map((s) => s.row),
    ...(drafted === undefined ? [] : [drafted.row]),
  ];

  async function onRegister() {
    setRegisterError(undefined);
    const result = await scaffold(newId);
    if (result.error !== undefined || result.source === undefined) {
      setRegisterError(
        result.error ?? {
          message: 'The registration could not be scaffolded.',
          next: 'Choose a lower-case slug id and Register again.',
        },
      );
      return;
    }
    setDrafted(result.source);
    setSelectedId(result.source.consumerId);
    setNewId('');
  }

  return (
    <div className="flex flex-col gap-6">
      <RegistryTable
        rows={rows}
        failures={failures}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />

      <section aria-labelledby="consumer-register-heading" className="flex flex-col gap-2">
        <h2 id="consumer-register-heading" className="font-display text-base text-text-1">
          Register a consumer
        </h2>
        <p className="max-w-[80ch] text-[12px] text-text-2">
          Registration is a grant, so it is a reviewed git artefact with an approval record — not a
          command that writes a file, and never Dynamic Client Registration. The scaffold starts
          closed: no binding types, no roles, no packages, no writes. Widening it is the diff a
          reviewer reads.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="consumer-new-id">Consumer id (immutable once registered)</Label>
            <Input
              id="consumer-new-id"
              data-testid="consumer-new-id"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              className="max-w-[42ch] font-mono"
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            data-testid="consumer-register"
            disabled={newId.trim() === ''}
            onClick={() => void onRegister()}
          >
            Register
          </Button>
        </div>
        {registerError === undefined ? null : (
          <div
            role="alert"
            data-testid="register-error"
            className="rounded-lg border border-status-danger-border bg-status-danger-bg p-3"
          >
            <p className="text-[12.5px] font-semibold text-status-danger-strong">
              {registerError.message}
            </p>
            <p className="mt-1 text-[12px] text-text-1">{registerError.next}</p>
          </div>
        )}
      </section>

      {selected === undefined ? (
        <p data-testid="consumers-none-selected" className="text-[12.5px] text-text-2">
          Select a consumer above, or register one, to see what it may reach.
        </p>
      ) : (
        <>
          <ConsumerEditor key={selected.consumerId} source={selected} compile={compile} />
          <div className="border-t border-line pt-4">
            <ConsumerActions
              consumerId={selected.consumerId}
              deploymentId={deploymentId}
              envClass={envClass}
              {...(onKill === undefined ? {} : { onKill })}
              {...(onProposeLifecycle === undefined
                ? {}
                : {
                    onProposeLifecycle: (kind: ConsumerProposalKind) =>
                      onProposeLifecycle(selected.consumerId, kind),
                  })}
            />
          </div>
        </>
      )}
    </div>
  );
}
