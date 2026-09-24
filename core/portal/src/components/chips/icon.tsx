// MCPForge — resolves a `status.ts` icon name (a lucide-react PascalCase
// export, e.g. "CircleCheck") to the actual icon component.
//
// `status.ts` deliberately only *names* the icon (core/shared/src/status.ts's
// own header: "this file only names the icon, it does not import the
// package") so the shared kernel never depends on a UI library. This module
// is the one place that dependency is taken, on the portal side.
//
// Icons are always `aria-hidden` — the chip's accessible name comes from the
// chip's `aria-label`, never from the icon (03 §12.5: "no icon-only status").
import * as LucideIcons from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { HelpCircle } from 'lucide-react';

type IconComponent = React.ComponentType<LucideProps>;

const icons = LucideIcons as unknown as Record<string, IconComponent>;

export interface StatusIconProps extends Omit<LucideProps, 'ref'> {
  /** A `lucide-react` export name, as stored in a `status.ts` `StatusEntry.icon`. */
  name: string;
}

/**
 * Renders the named lucide icon, or a visible fallback (`HelpCircle`) if the
 * name does not match a real export — a typo in `status.ts` should render
 * *something* wrong-looking rather than crash the chip it decorates.
 */
export function StatusIcon({ name, ...props }: StatusIconProps) {
  const Component = icons[name] ?? HelpCircle;
  return <Component aria-hidden="true" focusable="false" {...props} />;
}
