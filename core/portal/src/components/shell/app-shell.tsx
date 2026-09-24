'use client';

// MCPForge — W0-J6: the app shell (03 §5.2, §6.3, §11.1). Composes the
// sidebar, topbar, skip link, top-of-viewport environment rule and change
// tray around page content. This is chrome only — it renders `children`
// for the page body and builds none of the nine routes' content (other
// J-track tasks own that).
//
// Judgment call — `ShellProps`: there is no auth/session, branch/ChangeHost,
// drafts, or approvals-count backend yet at Wave 0 for this task's scope
// (`touches: core/portal/src/components/shell/**` only). Every piece of
// "who is signed in, what environment, what branch, what's uncommitted" is
// therefore a prop with a realistic Wave-0 default (env `local`, branch
// `main`, persona `You`, zero pending changes) rather than a fetch against
// an endpoint that doesn't exist. Callers (page-level layouts, added by
// later tasks) wire real data in as it becomes available; the shell itself
// never assumes a particular data source.
import * as React from 'react';
import type { EnvClass } from '@mcpforge/shared';

import { Sidebar } from './sidebar';
import { Topbar, persistTheme, type Density, type ThemeChoice, type TopbarProps } from './topbar';
import { ChangeTray, type ChangeTrayItem } from './change-tray';
import { TooltipProvider } from '../ui/tooltip';

export interface ShellProps {
  title: string;
  subtitle?: string | undefined;
  envClass?: EnvClass;
  branch?: string;
  remote?: string | undefined;
  personaName?: string;
  personaRole?: string | undefined;
  approvalsCount?: number;
  changeTrayItems?: readonly ChangeTrayItem[];
  onProposeAll?: (() => void) | undefined;
  onProposeOne?: ((id: string) => void) | undefined;
  onDiscardOne?: ((id: string) => void) | undefined;
  onOpenCommandPalette?: (() => void) | undefined;
  children: React.ReactNode;
}

// 03 §11.1's table: local and prod each get a 3px top-of-viewport rule
// (local: --status-platform, prod: --status-danger); probe and staging get
// none. Keyed on the Tailwind utility already wired from tokens.semantic.css
// via globals.css's @theme block (`bg-status-<token>-strong`), never a raw
// colour.
const TOP_RULE_CLASS: Partial<Record<EnvClass, string>> = {
  local: 'bg-status-platform-strong',
  prod: 'bg-status-danger-strong',
};

export function AppShell({
  title,
  subtitle,
  envClass = 'local',
  branch,
  remote,
  personaName = 'You',
  personaRole,
  approvalsCount = 0,
  changeTrayItems = [],
  onProposeAll,
  onProposeOne,
  onDiscardOne,
  onOpenCommandPalette,
  children,
}: ShellProps) {
  // `branch`/`remote` are left `undefined` (never defaulted to `'main'`
  // here) so that, when unset, `Topbar` -> `BranchChip` falls through to
  // `useRepoState()` — the REAL branch/remote `ChangeHostProvider` loaded
  // from `defaultChangeHost` (now globally mounted, see `app-chrome.tsx`).
  // `BranchChip`'s own context default (`DEFAULT_REPO_STATE`) is already
  // `{ branch: 'main', remote: unconfigured }`, so a caller with no host in
  // scope (tests, Storybook) sees the identical fallback this used to
  // hardcode — the only thing this removes is a default that used to WIN
  // over the real value once one became available.
  const [density, setDensity] = React.useState<Density>('comfortable');
  const [theme, setTheme] = React.useState<ThemeChoice | undefined>(undefined);

  const handleThemeChange: TopbarProps['onThemeChange'] = (next) => {
    setTheme(next);
    persistTheme(next);
  };

  const topRuleClass = TOP_RULE_CLASS[envClass];

  return (
    <TooltipProvider>
    <div className="flex h-dvh flex-col bg-canvas text-text-1" data-density={density}>
      <a
        href="#main-content"
        className="sr-only rounded-md bg-accent-solid-bg px-3 py-2 text-sm font-semibold text-accent-solid-fg focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to main content
      </a>

      {topRuleClass && <div aria-hidden="true" className={`h-[3px] w-full ${topRuleClass}`} />}

      <Topbar
        title={title}
        subtitle={subtitle}
        envClass={envClass}
        branch={branch}
        remote={remote}
        personaName={personaName}
        personaRole={personaRole}
        density={density}
        onDensityChange={setDensity}
        theme={theme}
        onThemeChange={handleThemeChange}
        onOpenCommandPalette={onOpenCommandPalette}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar approvalsCount={approvalsCount} />
        {/*
          A plain `<div>`, not `<main>`: every route's own page (built
          against this shell being unmounted, W0-J6/J22's own finding)
          already renders its own top-level `<main>` for its content — a
          second `<main>` here would both be invalid HTML (landmarks don't
          nest) and fail axe's `landmark-unique`, discovered only once this
          shell was actually mounted on every route. This element is chrome
          — the scroll container and the skip link's target — not a second
          landmark; the route's own `<main>` remains the page's one
          landmark, exactly as each page already declares it.

          `tabIndex={0}`, not `-1`: this region scrolls (`overflow-y-auto`)
          whenever a route's content exceeds the viewport, and axe's
          `scrollable-region-focusable` (WCAG 2.1.1/2.1.3) requires a
          scrollable container to be reachable by keyboard — either via a
          focusable descendant or the container itself being in the tab
          order. `-1` is unreachable by Tab; `0` keeps it a valid skip-link
          target (focus() works on either) while also making it
          independently keyboard-scrollable.
        */}
        <div id="main-content" tabIndex={0} className="min-w-0 flex-1 overflow-y-auto p-6">
          {children}
        </div>
      </div>

      <ChangeTray
        items={changeTrayItems}
        onProposeAll={onProposeAll}
        onProposeOne={onProposeOne}
        onDiscardOne={onDiscardOne}
      />
    </div>
    </TooltipProvider>
  );
}
