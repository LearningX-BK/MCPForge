'use client';

// MCPForge — W0-J18: the Governance tab nav (03 §5.3 "Governance").
//
// Five tabs — Roles · Policy & guardrails · Security posture · Kill switch ·
// Consumers. The fifth (03 §16.2) was deliberately absent until its route
// existed, on the rule that a nav entry leading nowhere is worse than one that
// is not yet there; `W0-N12` built `/governance/consumers`, so it is listed
// here now. This one line is the only edit W0-N12 makes outside
// `governance/consumers/**`, and it is unavoidable: a fifth tab nobody can
// navigate to is not a delivered tab.
//
// Real routes, each independently linkable, so this is links with
// `aria-current` rather than a `role="tablist"` — same reasoning as
// `environments/_components/env-nav.tsx`.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from 'cn';

export const GOVERNANCE_TABS = [
  { href: '/governance', label: 'Roles' },
  { href: '/governance/policy', label: 'Policy & guardrails' },
  { href: '/governance/posture', label: 'Security posture' },
  { href: '/governance/kill-switch', label: 'Kill switch' },
  { href: '/governance/consumers', label: 'Consumers' },
] as const;

export function GovNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Governance" className="flex flex-wrap gap-2 border-b border-line pb-2">
      {GOVERNANCE_TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1 text-[12.5px] font-semibold',
              active
                ? 'border-accent-border bg-accent-tint text-accent'
                : 'border-line text-text-1 hover:bg-surface-2',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
