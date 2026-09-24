// MCPForge — W0-J7: the effects table (03 §7.2 item 2).
//
// "one row per entry in `effects`: system, object, action, reversible.
// `reversible: false` rows are chipped danger and pulled to the top."
//
// Pulled to the top is a SORT, not a style: the irreversible rows are moved,
// stably, ahead of the reversible ones, so the first thing read is the part
// that cannot be taken back. The sort is unconditional — there is no prop that
// restores document order.
import { REVERSAL_CLASS } from '@mcpforge/shared';
import { cn } from 'cn';

import { StatusChip } from '../chips';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import type { PlanEffectView } from './types';

export interface EffectsTableProps {
  effects: readonly PlanEffectView[];
  className?: string | undefined;
}

/** Stable partition: irreversible first, original order preserved within each. */
export function sortEffects(effects: readonly PlanEffectView[]): PlanEffectView[] {
  return [...effects.filter((e) => !e.reversible), ...effects.filter((e) => e.reversible)];
}

const REVERSIBLE_CHIP = {
  token: 'status-ok',
  label: 'Reversible',
  srLabel: 'This effect can be reversed.',
  icon: 'RotateCcw',
} as const;

export function EffectsTable({ effects, className }: EffectsTableProps) {
  const rows = sortEffects(effects);

  return (
    <section aria-labelledby="plan-effects-heading" className={cn('w-full', className)}>
      <h3
        id="plan-effects-heading"
        className="mb-1 text-[11px]/[1.4] font-semibold tracking-[0.5px] uppercase text-text-2"
      >
        Effects
      </h3>
      <div className="overflow-x-auto">
        <Table data-testid="effects-table">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">System</TableHead>
              <TableHead scope="col">Object</TableHead>
              <TableHead scope="col">Action</TableHead>
              <TableHead scope="col">Reversible</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e, i) => (
              <TableRow
                key={`${e.system}:${e.object}:${e.action}:${i}`}
                data-testid="effect-row"
                data-reversible={String(e.reversible)}
              >
                <TableCell className="font-mono text-[11.5px]/[1.45]">{e.system}</TableCell>
                <TableCell>{e.object}</TableCell>
                <TableCell>{e.action}</TableCell>
                <TableCell>
                  {e.reversible ? (
                    <StatusChip entry={REVERSIBLE_CHIP} />
                  ) : (
                    <StatusChip
                      entry={REVERSAL_CLASS.irreversible}
                      srLabel={`This effect cannot be reversed: ${e.action} on ${e.object} in ${e.system}.`}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
