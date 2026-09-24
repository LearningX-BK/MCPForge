import type { NextConfig } from 'next';

// MCPForge portal — Next.js App Router config (W0-J2).
//
// Nothing exotic here on purpose: this task scaffolds only what layout.tsx
// and globals.css need. Portal features/routes land in later Track J tasks.
//
// W0-J21 (widened `touches`, user-authorized): core/shared, core/registry and
// core/codegen are authored as NodeNext-style ESM — their `src/**/index.ts`
// barrels import sibling modules with an explicit `.js` extension
// (e.g. `./bm25.js`) even though the file on disk is `.ts`, per TypeScript's
// own NodeNext moduleResolution convention (`tsc`/`vitest`/`tsx` all resolve
// this transparently). Next.js's bundlers take an explicit extension
// literally and do not fall back to `.ts`, so every portal route that
// transitively imports one of these barrels 500s with
// `Module not found: Can't resolve './<name>.js'`. This is the minimal,
// bundler-level fix for that — no source file in any workspace package is
// touched, and no unrelated build option is changed.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `core/gateway/store/dialect.ts` (02 §10.2) is the repo's one place that
  // imports `better-sqlite3` — a native Node addon. Left to the default
  // bundling path, both Next.js bundlers try to trace it into the route
  // bundle and fail on its internal `require('fs')`/`require('path')` calls
  // with `Module not found`, 500-ing every route that transitively reaches
  // `core/gateway/store` (environments, governance, insights, requests).
  // Declaring it a server-external package tells Next.js to `require()` it
  // at runtime instead of bundling it, which is the standard fix for a
  // native addon and changes nothing about which code runs.
  serverExternalPackages: ['better-sqlite3'],
  // Next's own dev-mode indicator defaults to the bottom-left corner — the
  // same corner `Sidebar`'s collapse/expand toggle occupies (03 §5.2), which
  // makes the toggle unreachable once collapsed. Moving Next's overlay
  // rather than our own chrome, since it's a dev-only tool overlay, not a
  // product surface.
  devIndicators: {
    position: 'bottom-right',
  },
  // Webpack (production build / `next build`, and `next dev` without --turbopack):
  // alias a `.js` specifier onto the sibling `.ts`/`.tsx` file when the
  // literal `.js` file does not exist.
  experimental: {
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    },
  },
  // Turbopack (`next dev --turbopack`): the equivalent resolution knob.
  // Turbopack's resolver does not auto-fall-back a literal `.js` specifier to
  // `.ts` on its own; widening the extensions it tries, with `.ts`/`.tsx`
  // ordered ahead of `.js`, resolves these workspace-package barrel imports
  // the same way.
  turbopack: {
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
  },
};

export default nextConfig;
