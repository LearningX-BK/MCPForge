// MCPForge — W0-J16: `DataTable` column defs for the Calls table (03 §5.3
// "Activity"). Columns per spec: time, caller, tool, verb/write chip, phase,
// outcome, target env, latency, result keys, reversal state.
import type { ColumnDef } from '@tanstack/react-table';
import { CALL_OUTCOME, CALL_PHASE } from '@mcpforge/shared';

import { StatusChip, VerbChip, WriteChip, EnvChip } from '../../components/chips';
import type { ActivityCallSummary } from './types';

function timeLabel(ts: string): string {
  return new Date(ts).toLocaleString();
}

export const activityColumns: ColumnDef<ActivityCallSummary, unknown>[] = [
  {
    id: 'ts',
    header: 'Time',
    accessorFn: (row) => row.ts,
    cell: ({ row }) => (
      <span className="font-mono text-[12px] text-text-2">{timeLabel(row.original.ts)}</span>
    ),
  },
  {
    id: 'caller',
    header: 'Caller',
    accessorFn: (row) => row.callerDisplay ?? row.callerSubject,
    cell: ({ row }) => (
      <span className="text-text-1">{row.original.callerDisplay ?? row.original.callerSubject}</span>
    ),
  },
  {
    id: 'toolId',
    header: 'Tool',
    accessorFn: (row) => row.toolId,
    cell: ({ row }) => <span className="font-mono text-[12px] text-text-1">{row.original.toolId}</span>,
  },
  {
    id: 'verb',
    header: 'Verb',
    accessorFn: (row) => row.verb ?? '',
    cell: ({ row }) => (
      <span className="flex items-center gap-1">
        {row.original.verb ? <VerbChip verb={row.original.verb as never} /> : null}
        {row.original.isWrite ? <WriteChip /> : null}
      </span>
    ),
  },
  {
    id: 'phase',
    header: 'Phase',
    accessorFn: (row) => row.phase,
    cell: ({ row }) => <StatusChip entry={CALL_PHASE[row.original.phase]} />,
  },
  {
    id: 'outcome',
    header: 'Outcome',
    accessorFn: (row) => row.outcome,
    cell: ({ row }) => <StatusChip entry={CALL_OUTCOME[row.original.outcome]} />,
  },
  {
    id: 'targetEnv',
    header: 'Env',
    accessorFn: (row) => row.targetEnv ?? '',
    cell: ({ row }) =>
      row.original.targetEnv ? <EnvChip envClass={row.original.targetEnv as never} /> : <span>—</span>,
  },
  {
    id: 'latency',
    header: 'Latency',
    accessorFn: (row) => row.latencyMsTotal ?? 0,
    cell: ({ row }) =>
      row.original.latencyMsTotal !== undefined ? (
        <span className="tabular-nums text-text-2">{row.original.latencyMsTotal} ms</span>
      ) : (
        <span className="text-text-2">—</span>
      ),
  },
  {
    id: 'resultKeys',
    header: 'Result keys',
    accessorFn: (row) => row.resultKeys.map((k) => k.keyValue).join(' '),
    cell: ({ row }) => (
      <span className="font-mono text-[11.5px] text-text-2">
        {row.original.resultKeys.map((k) => k.keyValue).join(', ') || '—'}
      </span>
    ),
  },
  {
    id: 'reversal',
    header: 'Reversal',
    accessorFn: (row) => (row.reversedByCallId ? 'reversed' : row.reversesCallId ? 'is-reversal' : ''),
    cell: ({ row }) =>
      row.original.reversedByCallId ? (
        <span
          data-testid="reversed-chip"
          className="rounded-full border border-status-platform-border bg-status-platform-bg px-2 py-0.5 text-[10.5px] font-bold text-status-platform-strong"
        >
          REVERSED
        </span>
      ) : row.original.reversesCallId ? (
        <span className="text-[11.5px] text-text-2">Reverses {row.original.reversesCallId}</span>
      ) : (
        <span className="text-text-2">—</span>
      ),
  },
];
