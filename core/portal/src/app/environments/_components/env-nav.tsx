'use client';

// MCPForge — W0-J17: the three-tab nav across `/environments`,
// `/environments/enablement`, `/environments/packages` (03 §5.3). These are
// real routes (each independently linkable), not client-side tab panels, so
// the nav is a set of links with `aria-current`, not a `role="tablist"`.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from 'cn';

const TABS = [
  { href: '/environments', label: 'This deployment' },
  { href: '/environments/enablement', label: 'Enablement' },
  { href: '/environments/packages', label: 'Packages' },
] as const;

export function EnvNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Environments" className="flex flex-wrap gap-2 border-b border-line pb-2">
      {TABS.map((tab) => {
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
