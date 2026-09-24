'use client';

// MCPForge — W0-J10: the thin Next.js adapter over `facets.ts`'s pure core.
//
// Kept separate from facets.ts so the encode/decode contract stays
// unit-testable without a router mock, per this task's brief. This hook is
// the only piece that touches `next/navigation`.
import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { clearAllFacets, decodeFacets, encodeFacets, toggleFacet, type FacetState } from './facets';

export interface UseFacetStateResult {
  facets: FacetState;
  toggle: (group: string, value: string) => void;
  clearGroup: (group: string) => void;
  clearAll: () => void;
  isSelected: (group: string, value: string) => boolean;
}

/**
 * Reads facet selection from the current URL's search params and writes
 * changes back via `router.replace` (no history entry per toggle — a
 * facet flip is not a "back button" moment). The URL is the single source
 * of truth: there is no separate React state to fall out of sync with it.
 */
export function useFacetState(): UseFacetStateResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const facets = React.useMemo(() => decodeFacets(searchParams.toString()), [searchParams]);

  const write = React.useCallback(
    (next: FacetState) => {
      const query = encodeFacets(next);
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const toggle = React.useCallback(
    (group: string, value: string) => write(toggleFacet(facets, group, value)),
    [facets, write],
  );

  const clearGroup = React.useCallback(
    (group: string) => {
      const rest = { ...facets };
      delete rest[group];
      write(rest);
    },
    [facets, write],
  );

  const clearAll = React.useCallback(() => write(clearAllFacets()), [write]);

  const isSelected = React.useCallback(
    (group: string, value: string) => Boolean(facets[group]?.includes(value)),
    [facets],
  );

  return { facets, toggle, clearGroup, clearAll, isSelected };
}
