'use client';

// MCPForge — W0-J6: the topbar (03 §5.2).
// Left: page title + subtitle. Centre: command palette trigger, a wide
// search affordance (not a small icon). Right: environment chip · branch
// chip · persona pill · density toggle · theme toggle · account.
import * as React from 'react';
import { Search, Sun, Moon, Rows3, LayoutList, User } from 'lucide-react';
import { cn } from 'cn';
import type { EnvClass } from '@mcpforge/shared';

import { EnvChip } from '../chips';
import { BranchChip, type BranchChipProps } from './branch-chip';

export type Density = 'comfortable' | 'compact';
export type ThemeChoice = 'light' | 'dark';

export interface TopbarProps {
  title: string;
  subtitle?: string | undefined;
  envClass: EnvClass;
  branch?: BranchChipProps['branch'] | undefined;
  remote?: BranchChipProps['remote'] | undefined;
  /** Judgment call: persona is prop-driven placeholder text — no auth/session backend yet (see app-shell.tsx). */
  personaName?: string;
  personaRole?: string | undefined;
  density?: Density;
  onDensityChange?: (density: Density) => void;
  /** Reads/writes the same `mcpforge-theme` key `THEME_INIT_SCRIPT` reads (03 §13.2). `undefined` means "system". */
  theme?: ThemeChoice | undefined;
  onThemeChange?: (theme: ThemeChoice) => void;
  onOpenCommandPalette?: (() => void) | undefined;
  className?: string;
}

export function Topbar({
  title,
  subtitle,
  envClass,
  branch,
  remote,
  personaName = 'You',
  personaRole,
  density = 'comfortable',
  onDensityChange,
  theme,
  onThemeChange,
  onOpenCommandPalette,
  className,
}: TopbarProps) {
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');

  return (
    <header
      className={cn(
        'flex h-14 items-center gap-4 border-b border-line bg-surface px-4',
        className,
      )}
    >
      <div className="min-w-0 flex-none">
        <h1 className="truncate text-sm font-bold text-text-1">{title}</h1>
        {subtitle && <p className="truncate text-xs text-text-3">{subtitle}</p>}
      </div>

      <div className="flex flex-1 justify-center px-4">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          aria-label="Open command palette. Search tools, drafts and pages."
          // W0-J22: `text-text-2`, not `text-text-3` — `--text-3` on
          // `--bg-canvas` measures 4.38:1 under axe's `color-contrast`,
          // below WCAG AA's 4.5:1 (`tokens.semantic.css`'s own comment
          // documents this exact combination as "never in the contrast
          // gate's scope" — a real, previously-uncaught gap that stayed
          // invisible until this task mounted `AppShell`, and this
          // button, globally, exposing it to axe on every route). `--text-2`
          // (`--ltm-grey-700` #54585f) clears 4.5:1 against `--bg-canvas`
          // in both themes.
          className="flex w-full max-w-md items-center gap-2 rounded-md border border-line bg-canvas px-3 py-1.5 text-sm text-text-2 hover:border-line-strong focus-visible:outline-2 focus-visible:outline-focus-ring"
        >
          <Search aria-hidden="true" className="size-4" />
          <span className="flex-1 text-left">Search tools, drafts, pages…</span>
          <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-text-2">
            {isMac ? '⌘K' : 'Ctrl K'}
          </kbd>
        </button>
      </div>

      <div className="flex flex-none items-center gap-3">
        <EnvChip envClass={envClass} />
        <BranchChip branch={branch} remote={remote} />

        <span
          className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-text-1"
          aria-label={personaRole ? `Signed in as ${personaName}, ${personaRole}.` : `Signed in as ${personaName}.`}
        >
          {personaName}
        </span>

        <button
          type="button"
          role="switch"
          aria-checked={density === 'compact'}
          aria-label={`Density: ${density}. Toggle density.`}
          onClick={() => onDensityChange?.(density === 'compact' ? 'comfortable' : 'compact')}
          className="flex size-8 items-center justify-center rounded-md text-text-2 hover:bg-surface-2 hover:text-text-1 focus-visible:outline-2 focus-visible:outline-focus-ring"
        >
          {density === 'compact' ? (
            <Rows3 aria-hidden="true" className="size-4" />
          ) : (
            <LayoutList aria-hidden="true" className="size-4" />
          )}
        </button>

        <button
          type="button"
          aria-label={`Theme: ${theme ?? 'system'}. Switch theme.`}
          onClick={() => onThemeChange?.(theme === 'dark' ? 'light' : 'dark')}
          className="flex size-8 items-center justify-center rounded-md text-text-2 hover:bg-surface-2 hover:text-text-1 focus-visible:outline-2 focus-visible:outline-focus-ring"
        >
          {theme === 'dark' ? (
            <Sun aria-hidden="true" className="size-4" />
          ) : (
            <Moon aria-hidden="true" className="size-4" />
          )}
        </button>

        <button
          type="button"
          aria-label={`Account: ${personaName}`}
          className="flex size-8 items-center justify-center rounded-full bg-surface-3 text-text-2 hover:bg-surface-2 hover:text-text-1 focus-visible:outline-2 focus-visible:outline-focus-ring"
        >
          <User aria-hidden="true" className="size-4" />
        </button>
      </div>
    </header>
  );
}

/** Reads/writes `mcpforge-theme` (03 §13.2 rule 4) — the same key `THEME_INIT_SCRIPT` reads pre-paint. Exported so `AppShell` can wire a default `onThemeChange` without every page having to know the storage key. */
export function persistTheme(theme: ThemeChoice) {
  try {
    window.localStorage.setItem('mcpforge-theme', theme);
  } catch {
    /* localStorage blocked or unavailable — the toggle still updates the DOM. */
  }
  document.documentElement.setAttribute('data-theme', theme);
}
