'use client';

// MCPForge — named follow-up from W0-J21: composes the real `ChangeHost`
// onto every route (`lib/change-host/local-git-actions.ts`'s header explains
// why this has to be the client component doing the importing, rather than a
// Server Component constructing a host and passing it down as a prop — a
// `ChangeHost` instance does not survive that boundary, only a Server Action
// reference does, and `defaultChangeHost` is already built out of those).
//
// Root-layout-level, same reasoning as this file's neighbour
// `TooltipProvider` composition in `app/layout.tsx`: it is pure context, not
// chrome, and every route needs the same one instance. No `repo` prop is
// passed — `ChangeHostProvider` loads branch + remote from the host itself
// on mount, which is what makes the branch chip's "local only — no remote
// configured" (03 §11.3) an honest read of the sandbox rather than a guess.
import * as React from 'react';

import { ChangeHostProvider, defaultChangeHost } from '@/lib/change-host';

export function AppChangeHostProvider({ children }: { children: React.ReactNode }) {
  return <ChangeHostProvider host={defaultChangeHost}>{children}</ChangeHostProvider>;
}
