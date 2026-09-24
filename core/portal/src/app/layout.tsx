import type { Metadata } from 'next';
import localFont from 'next/font/local';

import '../styles/globals.css';
import { THEME_INIT_SCRIPT } from './theme-init';
// Named follow-up from W0-J21: the real `ChangeHost` every route needs so
// "Save draft" actually works instead of reporting "No change host is
// available" (see components/shell/app-change-host.tsx's header).
import { AppChangeHostProvider } from '../components/shell/app-change-host';
// W0-J22: `AppShell` (W0-J6, built and tested but never mounted before this
// task) mounted once, globally, around every route — not just `/home`.
// `AppChrome` also carries the command-palette wiring that used to be
// `/home`-local (`home/layout.tsx` + `home/_components/home-palette.tsx`)
// and includes the one `TooltipProvider` instance every route needs
// (`components/ui/tooltip.tsx`'s `Tooltip` requires it — Radix errors
// "must be used within `TooltipProvider`" otherwise; `AppShell` itself
// renders it, so the root layout no longer needs its own).
import { AppChrome } from '../components/shell/app-chrome';

// Self-hosted Inter (03 §4.5, §13.2 rule 4): no external font request, no
// CLS. Variable font, latin subset, vendored under public/fonts/. Exposed
// as the `--font-inter` CSS variable that globals.css's `--font-sans`
// references — components never name a font family directly.
const inter = localFont({
  src: [
    {
      path: '../../public/fonts/Inter-Variable.woff2',
      weight: '100 900',
      style: 'normal',
    },
    {
      path: '../../public/fonts/Inter-Italic-Variable.woff2',
      weight: '100 900',
      style: 'italic',
    },
  ],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'MCPForge',
  description:
    'MCPForge — the governed control plane and runtime gateway that turns Oracle application capability into MCP tools.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `THEME_INIT_SCRIPT` (03 §13.2 rule 4) sets `data-theme` on this element
    // directly via the DOM, before React hydrates, whenever `localStorage`
    // holds an explicit light/dark choice — by design, so there is no
    // flash of the wrong theme. React's hydration diff has no way to know
    // that attribute was set on purpose outside its own render, so it
    // reports a mismatch every time a stored preference exists. This is
    // exactly the documented case `suppressHydrationWarning` exists for
    // (React's own docs: a server/client attribute difference caused
    // deliberately, by script, before hydration) — it silences the warning
    // for `data-theme` specifically without hiding a real mismatch
    // elsewhere in the tree.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <AppChangeHostProvider>
          <AppChrome>{children}</AppChrome>
        </AppChangeHostProvider>
      </body>
    </html>
  );
}
