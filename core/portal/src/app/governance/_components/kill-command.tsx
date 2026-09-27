'use client';

// MCPForge — W0-P5b: what a kill control shows in place of a write path.
// W0-P4 §3 and §9 decision 4.
//
// With the admin persona held, the exact `forge kill` command to run on the
// gateway host. Without it, the note's refusal and who can act instead. The
// control is disabled, never hidden (03 §2).

import * as React from 'react';

import type { GateResult } from '@/lib/viewer/gates';

export function KillCommand({
  gate,
  command,
  testId,
}: {
  readonly gate: GateResult;
  /** Null until the form names everything the command needs. */
  readonly command: string | null;
  readonly testId: string;
}): React.ReactElement | null {
  if (!gate.allowed) {
    return (
      <div
        data-testid={`${testId}-refusal`}
        role="note"
        className="rounded-lg border border-line bg-surface-2 p-3"
      >
        <p className="text-[12.5px] font-semibold text-text-1">{gate.message}</p>
        <p className="mt-1 text-[12px] text-text-2">{gate.next}</p>
      </div>
    );
  }
  if (command === null) return null;
  return (
    <div data-testid={testId} className="flex flex-col gap-1">
      <p className="text-[12.5px] text-text-1">
        The portal does not set kill flags yet. Run this on the gateway host; it writes the flag and
        its audit record, and takes effect on the gateway&apos;s next poll.
      </p>
      <pre className="overflow-x-auto rounded-md border border-line bg-surface-2 p-2 font-mono text-[12px] text-text-1">
        <code>{command}</code>
      </pre>
    </div>
  );
}
