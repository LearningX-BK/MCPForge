// MCPForge — W0-J6: the nine-destination nav model (03 §5.2).
//
// Assigned once, centrally, exactly as 03 §5.2 asks ("Rail icons must be
// distinct — the concept console already hit this bug ... Assigned once,
// centrally, in `NAV`"). Every destination gets its own `lucide-react`
// export name; `nav.test.tsx` asserts no two destinations share one.
//
// Icon choices follow 03 §5.2's own disambiguation record (⌂ ▤ ⚒ ✎ ✓ ⚖ ∿ ⬡ ▲)
// mapped to real lucide-react exports by *meaning*, not by hunting for a
// glyph lookalike: Home -> Home, a library/grid for Catalog -> LayoutGrid,
// a tool for Build -> Hammer, an edit affordance for Requests -> PenSquare,
// a check for Approvals -> CheckCircle2, a scale for Governance -> Scale,
// a pulse for Activity -> Activity, a many-sided platform shape for
// Environments -> Hexagon, a chart for Insights -> BarChart3.
import type { LucideIcon } from 'lucide-react';
import {
  Activity as ActivityIcon,
  BarChart3,
  CheckCircle2,
  Hammer,
  Hexagon,
  Home,
  LayoutGrid,
  PenSquare,
  Scale,
} from 'lucide-react';

export const NAV_GROUP_IDS = ['work', 'control', 'platform'] as const;
export type NavGroupId = (typeof NAV_GROUP_IDS)[number];

export interface NavDestination {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * Sub-route prefixes that still count as "on this destination" for
   * active-state and group-auto-expand purposes (03 §5.2's parenthetical
   * sub-routes, e.g. Catalog's `/catalog/[toolId]`).
   */
  matchPrefixes?: readonly string[];
  /** Approvals carries a live count badge (03 §5.2's `[n]`). */
  hasBadge?: boolean;
}

export interface NavGroup {
  id: NavGroupId;
  label: string;
  destinations: readonly NavDestination[];
}

export const NAV: readonly NavGroup[] = [
  {
    id: 'work',
    label: 'Work',
    destinations: [
      { id: 'home', label: 'Home', href: '/', icon: Home },
      {
        id: 'catalog',
        label: 'Catalog',
        href: '/catalog',
        icon: LayoutGrid,
        matchPrefixes: ['/catalog'],
      },
      { id: 'build', label: 'Build', href: '/build', icon: Hammer, matchPrefixes: ['/build'] },
      {
        id: 'requests',
        label: 'Requests',
        href: '/requests',
        icon: PenSquare,
        matchPrefixes: ['/requests'],
      },
    ],
  },
  {
    id: 'control',
    label: 'Control',
    destinations: [
      {
        id: 'approvals',
        label: 'Approvals',
        href: '/approvals',
        icon: CheckCircle2,
        matchPrefixes: ['/approvals'],
        hasBadge: true,
      },
      {
        id: 'governance',
        label: 'Governance',
        href: '/governance',
        icon: Scale,
        matchPrefixes: ['/governance'],
      },
      {
        id: 'activity',
        label: 'Activity',
        href: '/activity',
        icon: ActivityIcon,
        matchPrefixes: ['/activity'],
      },
    ],
  },
  {
    id: 'platform',
    label: 'Platform',
    destinations: [
      {
        id: 'environments',
        label: 'Environments',
        href: '/environments',
        icon: Hexagon,
        matchPrefixes: ['/environments'],
      },
      { id: 'insights', label: 'Insights', href: '/insights', icon: BarChart3 },
    ],
  },
];

/** Every destination, flattened, for lookups that don't care about grouping. */
export const NAV_DESTINATIONS: readonly NavDestination[] = NAV.flatMap((g) => g.destinations);

/**
 * True when `pathname` is "on" `destination` — an exact match on `href`, or
 * a match on one of its declared sub-route prefixes. `/` only matches `/`
 * itself (it would otherwise prefix-match everything).
 */
export function isDestinationActive(destination: NavDestination, pathname: string): boolean {
  if (destination.href === '/') return pathname === '/';
  if (pathname === destination.href) return true;
  return (destination.matchPrefixes ?? []).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** The group id containing whichever destination is active for `pathname`. */
export function activeGroupId(pathname: string): NavGroupId | undefined {
  return NAV.find((group) =>
    group.destinations.some((d) => isDestinationActive(d, pathname)),
  )?.id;
}
