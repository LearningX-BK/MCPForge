// MCPForge — W0-J16: the business-key search box (03 §5.3 "Activity").
//
// "'Who created document 12345, through which tool, under whose approval,
// and has it been reversed?' — a business-key search box, first-class, at
// the top of the page. This is the query that gets asked under pressure and
// it should be one field, not four filters."
//
// So this renders ABOVE the saved-view tabs and the DataTable, as its own
// section with its own heading — never folded into `FacetPanel`, which is
// for constructed multi-facet filtering, not the one-field, high-pressure
// query this box exists for.
'use client';

import * as React from 'react';
import { Search } from 'lucide-react';
import { cn } from 'cn';

import { Input } from '../../components/ui/input';
import type { ActivityCallSummary } from './types';

/** Matches a call whose `resultKeys` contain this business-key value (case-insensitive). */
export function matchesBusinessKey(
  call: ActivityCallSummary,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return false;
  return call.resultKeys.some((key) => key.keyValue.toLowerCase().includes(needle));
}

export interface BusinessKeySearchProps {
  value: string;
  onChange: (value: string) => void;
  className?: string | undefined;
}

export function BusinessKeySearch({ value, onChange, className }: BusinessKeySearchProps) {
  return (
    <section
      data-testid="business-key-search"
      aria-label="Business-key search"
      className={cn('flex w-full flex-col gap-1', className)}
    >
      <label
        htmlFor="business-key-search-input"
        className="text-[11px]/[1.4] font-semibold tracking-[0.5px] uppercase text-text-2"
      >
        Find by business key
      </label>
      <div className="relative w-full max-w-xl">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-3"
        />
        <Input
          id="business-key-search-input"
          data-testid="business-key-search-input"
          type="search"
          placeholder="Document number, e.g. 00123456"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="pl-8"
        />
      </div>
      <p className="text-[12.5px]/[1.5] text-text-2">
        Who created it, through which tool, under whose approval, and whether it has been
        reversed — search the value the business actually knows, not the call id.
      </p>
    </section>
  );
}
