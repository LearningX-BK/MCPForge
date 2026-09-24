'use client';

// MCPForge — W0-J6: the sidebar (03 §5.2). Three collapsible groups (WORK /
// CONTROL / PLATFORM) in the expanded state; an icon-only rail (~56px, every
// icon with a tooltip) when collapsed. `done:` requires:
//   - only the group containing the current page open on load;
//   - navigating into a collapsed group auto-expands it.
// Both are driven by `usePathname` — `activeGroupId` decides which group
// *must* be open, and an effect adds it to the open set whenever the route
// changes into a group that isn't already expanded (it never removes a
// group the user opened by hand, so manual exploration of an unrelated
// group survives a same-group navigation).
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, PanelLeft, PanelLeftClose } from 'lucide-react';
import { cn } from 'cn';

import { Separator } from '../ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { LtmLogo } from '../brand/LtmLogo';
import { activeGroupId, isDestinationActive, NAV, type NavGroupId } from './nav';

export interface SidebarProps {
  /** Pending-approval count for the Approvals badge (03 §5.2's `[n]`). Judgment call: prop-driven placeholder — there is no approvals API to read from yet (see ShellProps doc in app-shell.tsx). */
  approvalsCount?: number;
  className?: string;
}

export function Sidebar({ approvalsCount = 0, className }: SidebarProps) {
  const pathname = usePathname() ?? '/';
  const currentGroup = activeGroupId(pathname);

  const [railCollapsed, setRailCollapsed] = React.useState(false);
  const [openGroups, setOpenGroups] = React.useState<ReadonlySet<NavGroupId>>(
    () => new Set(currentGroup ? [currentGroup] : []),
  );

  // Auto-expand on navigation into a collapsed group. Deliberately does not
  // collapse groups the user opened manually — only adds, never removes.
  React.useEffect(() => {
    if (currentGroup && !openGroups.has(currentGroup)) {
      setOpenGroups((prev) => new Set(prev).add(currentGroup));
    }
  }, [currentGroup]); // openGroups is read via the functional update above, not needed as a dep.

  function toggleGroup(id: NavGroupId) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <TooltipProvider>
      <nav
        aria-label="Primary"
        data-testid="sidebar"
        data-rail={railCollapsed}
        className={cn(
          'flex h-full flex-col border-r border-line bg-sidebar text-text-1 transition-[width]',
          railCollapsed ? 'w-14' : 'w-64',
          className,
        )}
      >
        {/* Brand lockup (03 §4.1): 120px full wordmark expanded, 28px coral
            glyph collapsed — never recoloured, never on a coral ground. */}
        <div
          className={cn(
            'flex items-center border-b border-line py-3',
            railCollapsed ? 'justify-center px-1' : 'justify-start gap-2 px-3',
          )}
        >
          {railCollapsed ? (
            <LtmLogo variant="glyph" />
          ) : (
            <>
              <LtmLogo variant="full" />
              <span className="font-display text-sm font-bold text-text-1">MCPForge</span>
            </>
          )}
        </div>

        <div className={cn('flex-1 overflow-y-auto py-2', railCollapsed ? 'px-1' : 'px-2')}>
          {NAV.map((group, i) => (
            <React.Fragment key={group.id}>
              {i > 0 && <Separator className="my-2" />}
              <NavGroupBlock
                group={group}
                pathname={pathname}
                railCollapsed={railCollapsed}
                open={openGroups.has(group.id)}
                onToggle={() => toggleGroup(group.id)}
                approvalsCount={approvalsCount}
              />
            </React.Fragment>
          ))}
        </div>

        <Separator />
        <div className="flex justify-center p-2">
          <button
            type="button"
            aria-label={railCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={railCollapsed}
            onClick={() => setRailCollapsed((v) => !v)}
            className="flex size-9 items-center justify-center rounded-md text-text-2 hover:bg-surface-2 hover:text-text-1 focus-visible:outline-2 focus-visible:outline-focus-ring"
          >
            {railCollapsed ? (
              <PanelLeft aria-hidden="true" className="size-4" />
            ) : (
              <PanelLeftClose aria-hidden="true" className="size-4" />
            )}
          </button>
        </div>
      </nav>
    </TooltipProvider>
  );
}

interface NavGroupBlockProps {
  group: (typeof NAV)[number];
  pathname: string;
  railCollapsed: boolean;
  open: boolean;
  onToggle: () => void;
  approvalsCount: number;
}

function NavGroupBlock({
  group,
  pathname,
  railCollapsed,
  open,
  onToggle,
  approvalsCount,
}: NavGroupBlockProps) {
  if (railCollapsed) {
    // Rail mode: no group chrome, just every icon with a tooltip. Group
    // separation is still visible (the <Separator> between groups above).
    return (
      <ul className="flex flex-col items-center gap-1">
        {group.destinations.map((d) => {
          const active = isDestinationActive(d, pathname);
          const Icon = d.icon;
          return (
            <li key={d.id}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={d.href}
                    aria-label={d.label}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative flex size-9 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-focus-ring',
                      active
                        ? 'bg-accent-tint text-accent'
                        : 'text-text-2 hover:bg-surface-2 hover:text-text-1',
                    )}
                  >
                    <Icon aria-hidden="true" className="size-4" />
                    {d.hasBadge && approvalsCount > 0 && (
                      <span
                        aria-hidden="true"
                        className="absolute top-0.5 right-0.5 flex size-3.5 items-center justify-center rounded-full bg-status-write-strong text-[9px] font-bold text-white"
                      >
                        {approvalsCount > 9 ? '9+' : approvalsCount}
                      </span>
                    )}
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{d.label}</TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    );
  }

  const panelId = `nav-group-${group.id}`;
  const headingId = `nav-group-${group.id}-heading`;

  return (
    <div>
      <button
        type="button"
        id={headingId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px] font-bold tracking-[0.6px] text-text-3 uppercase hover:text-text-1 focus-visible:outline-2 focus-visible:outline-focus-ring"
      >
        {group.label}
        <ChevronDown
          aria-hidden="true"
          className={cn('size-3.5 transition-transform', open ? 'rotate-0' : '-rotate-90')}
        />
      </button>
      {open && (
        <ul id={panelId} aria-labelledby={headingId} className="flex flex-col gap-0.5 py-1">
          {group.destinations.map((d) => {
            const active = isDestinationActive(d, pathname);
            const Icon = d.icon;
            return (
              <li key={d.id}>
                <Link
                  href={d.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-focus-ring',
                    active
                      ? 'bg-accent-tint text-accent'
                      : 'text-text-2 hover:bg-surface-2 hover:text-text-1',
                  )}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="flex-1">{d.label}</span>
                  {d.hasBadge && approvalsCount > 0 && (
                    <span
                      aria-label={`${approvalsCount} pending`}
                      className="rounded-full bg-status-write-strong px-1.5 py-0.5 text-[10px] font-bold text-white"
                    >
                      {approvalsCount}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
