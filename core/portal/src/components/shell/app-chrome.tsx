'use client';

// MCPForge — W0-J22: the one global mount of `AppShell` (03 §5.2, §6.3,
// §11.1, §12.2). Root layout composes this once around every route instead
// of leaving `AppShell` unmounted; the command-palette wiring that used to
// be local to `app/home/layout.tsx` + `home/_components/home-palette.tsx`
// (⌘K/Ctrl+K, focus-return, the fixture `FindClient` seam) lives here now
// so every route gets it, not just `/home`.
//
// Per-route title: derived from `components/shell/nav.ts`'s `NAV` table
// against `usePathname()`, never hand-authored per page. Every top-level
// destination's own page already renders its own content `<h1>` (Home,
// Catalog, Build, Activity, Approvals, Requests, Environments, Governance,
// Insights) — that was already true for `/home` alone before this task
// (`home-palette.tsx` passed `title="Home"` to `Topbar` while `HomePage`
// itself rendered an `<h1>Home</h1>`), so a second, small chrome-level
// title in `Topbar` alongside a route's own content heading is the
// established, tested pattern here, not a new duplication this task
// introduces. Routes with no `NAV` entry (dynamic detail routes, and the
// `governance`/`environments` subtabs which all share their group's
// destination) fall back to their group's destination label, matching
// what each of those pages' own `<h1>` already says.
import * as React from 'react';
import { usePathname } from 'next/navigation';

import { AppShell } from './app-shell';
import type { ChangeTrayItem } from './change-tray';
import { CommandPalette } from '../palette/command-palette';
import { fixtureFindClient } from '../palette/find-fixture';
import { NAV_DESTINATIONS, isDestinationActive } from './nav';
import { useOptionalChangeHost, type ChangeProposal } from '@/lib/change-host';

const PORTAL_AUTHOR = 'portal';

/** `merged` proposals have nothing left to act on — the tray only ever
 * shows work still in flight (03 §6.3: "3 changes", never a completed one). */
function toTrayItems(proposals: readonly ChangeProposal[]): ChangeTrayItem[] {
  return proposals
    .filter((p) => p.state !== 'merged')
    .map((p) => ({ id: p.id, label: p.title, state: p.state }));
}

/**
 * The chrome title for `pathname` — the label of whichever `NAV`
 * destination's `href`/`matchPrefixes` cover it. Falls back to the closest
 * matching path segment for a route `NAV` does not (yet) list, rather than
 * inventing new copy; every route this task ships against is covered by a
 * `NAV` entry today.
 */
function titleForPathname(pathname: string): string {
  const destination = NAV_DESTINATIONS.find((d) => isDestinationActive(d, pathname));
  if (destination) return destination.label;
  const firstSegment = pathname.split('/').find(Boolean);
  return firstSegment ? firstSegment[0]!.toUpperCase() + firstSegment.slice(1) : 'MCPForge';
}

export function AppChrome({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  const pathname = usePathname();
  const title = titleForPathname(pathname ?? '/');

  const host = useOptionalChangeHost();
  const [trayItems, setTrayItems] = React.useState<readonly ChangeTrayItem[]>([]);

  // Polled, not streamed (03 §11.4's own convention for runtime data): a
  // plain refetch on mount and on every route change, never a subscription.
  // `AppChangeHostProvider` (app/layout.tsx) is the one place `host` comes
  // from a real `ChangeHost` — with none (tests, Storybook) this simply
  // never runs and the tray stays empty, matching `ChangeTray`'s own
  // "hidden entirely at zero" rule.
  const refreshTray = React.useCallback(() => {
    if (host === undefined) return;
    void host.listProposals().then((proposals) => setTrayItems(toTrayItems(proposals)));
  }, [host]);

  React.useEffect(() => {
    refreshTray();
  }, [refreshTray, pathname]);

  const onProposeOne = React.useCallback(
    (id: string) => {
      if (host === undefined) return;
      void host.propose({ id, author: PORTAL_AUTHOR }).then(refreshTray);
    },
    [host, refreshTray],
  );

  const onDiscardOne = React.useCallback(
    (id: string) => {
      if (host === undefined) return;
      void host.discard(id).then(refreshTray);
    },
    [host, refreshTray],
  );

  const onProposeAll = React.useCallback(() => {
    if (host === undefined) return;
    const draftIds = trayItems.filter((item) => item.state === 'draft').map((item) => item.id);
    void Promise.all(draftIds.map((id) => host.propose({ id, author: PORTAL_AUTHOR }))).then(
      refreshTray,
    );
  }, [host, refreshTray, trayItems]);

  const [paletteOpen, setPaletteOpen] = React.useState(false);
  // Whatever had focus when the palette opened — `Topbar` does not forward
  // a ref onto its internal trigger button, and saving `document.
  // activeElement` works identically for the mouse-click, Tab-then-Enter
  // and ⌘K-from-anywhere paths alike (03 §12.2: "Esc closes and returns
  // focus to the trigger" — the trigger IS whatever was focused, by
  // construction).
  const lastFocusedRef = React.useRef<HTMLElement | null>(null);

  const openPalette = React.useCallback(() => {
    lastFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPaletteOpen(true);
  }, []);

  const closePalette = React.useCallback(() => {
    setPaletteOpen(false);
    lastFocusedRef.current?.focus();
  }, []);

  // The ⌘K / Ctrl+K shortcut `Topbar`'s own `kbd` hint advertises. Global
  // on every route (not just while the trigger has focus) — 03 §12.2's
  // "completable without a mouse" rule for this flow assumes the shortcut
  // works from anywhere on the page, and now that there is one persistent
  // shell across route changes, the listener can live here for the whole
  // session instead of being re-attached per `/home` visit.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openPalette();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openPalette]);

  return (
    <>
      <AppShell
        title={title}
        onOpenCommandPalette={openPalette}
        changeTrayItems={trayItems}
        onProposeOne={onProposeOne}
        onDiscardOne={onDiscardOne}
        onProposeAll={onProposeAll}
      >
        {children}
      </AppShell>
      {/*
        `onOpenTool`/`onPlanTool`/`onNavigate`/`onRequestCapability`: this
        fixture-backed wiring closes rather than performing a full route
        navigation — wiring a real destination for each is the honest next
        follow-up once `/api/find` exists (CLAUDE.md §8), recorded in
        TASKS.md, not silently done here.
      */}
      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        findClient={fixtureFindClient}
        onOpenTool={closePalette}
        onPlanTool={closePalette}
        onRequestCapability={closePalette}
        onNavigate={closePalette}
      />
    </>
  );
}
