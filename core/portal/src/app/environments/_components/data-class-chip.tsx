'use client';

// MCPForge — W0-J17: the data-class chip (03 §11.2). Not one of §8's six
// chip families (like `EnvChip`, it is a singular indicator, not a family
// member — see chips/env-chip.tsx's own header for that distinction) and
// this task's `touches:` is `environments/**` only, so it lives here rather
// than in `../../components/chips`.
//
// Driven by ONE field — `StoreDescriptor` (`runtime.store.kind`'s shape,
// `@mcpforge/gateway/store`) — never a second boolean. The tooltip text is
// 03 §11.2's own copy, verbatim, and only renders the ephemeral half when
// `store.ephemeral` is true; a Postgres/Oracle store drops the ephemerality
// language entirely, per spec ("drops the ephemerality language").
import { Database } from 'lucide-react';
import type { StoreDescriptor } from '@mcpforge/gateway/store';

import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';

export interface DataClassChipProps {
  store: StoreDescriptor;
  className?: string;
}

/** 03 §11.2, verbatim. */
export const EPHEMERAL_TOOLTIP =
  'Runtime data (audit, approvals, probe results) is stored in a local SQLite file at ' +
  '`./.mcpforge/runtime.db`. It is not backed up and does not survive a clean checkout. ' +
  'Definitional data is in git and is safe.';

export function DataClassChip({ store, className }: DataClassChipProps) {
  const tooltip = store.ephemeral
    ? EPHEMERAL_TOOLTIP
    : `Runtime data is stored in ${store.label} at ${store.location}. Definitional data is in git and is safe.`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="data-class-chip"
          aria-label={`Runtime data class: ${store.label}. ${tooltip}`}
          className={
            'inline-flex w-fit shrink-0 items-center gap-1 rounded-full border border-line px-2 py-0.5 ' +
            'text-[10.5px] font-bold tracking-[0.4px] whitespace-nowrap text-text-2 ' +
            (className ?? '')
          }
        >
          <Database aria-hidden="true" focusable="false" className="size-3" />
          <span>{store.label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-left">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
