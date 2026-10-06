// MCPForge — W0-P5b: every route renders for every persona.
//
// 03 §2 makes this a requirement: persona "never hides a page", because
// "hiding governance surfaces from the people being governed is the failure
// mode this product exists to prevent." So this test finds every
// `src/app/**/page.tsx`, renders each one on the server for each viewer (signed
// out, signed in with no persona, and each persona), and requires a page every
// time: no throw, no `notFound()`, and no redirect away. The one redirect
// allowed is `/`'s landing choice, which goes to another route that is itself
// in this list and also renders for everyone.
//
// Only the viewer and Next's navigation hooks are replaced; every page renders
// its real component tree against the real repository.

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { PERSONA_LANDING, type Persona } from '@/lib/viewer/personas';
import type { Viewer } from '@/lib/viewer/viewer';

const current: { viewer: Viewer | null } = { viewer: null };

vi.mock('@/lib/viewer/session', () => ({
  getViewer: () => Promise.resolve(current.viewer),
  sessionIdFromCookies: () => Promise.resolve(undefined),
  SESSION_COOKIE: 'mcpforge_session',
}));

class NavigationEscape extends Error {
  constructor(
    readonly kind: 'redirect' | 'notFound',
    readonly to?: string,
  ) {
    super(`${kind}${to === undefined ? '' : ` -> ${to}`}`);
  }
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: (to: string) => {
    throw new NavigationEscape('redirect', to);
  },
  notFound: () => {
    throw new NavigationEscape('notFound');
  },
}));

vi.mock('@/lib/viewer/actions', () => ({
  signInAction: () => Promise.resolve({}),
  signOutAction: () => Promise.resolve(),
  selectPersonaAction: () => Promise.resolve({ ok: true }),
  safeReturnTo: (v: unknown) =>
    Promise.resolve(typeof v === 'string' && v.startsWith('/') ? v : '/'),
}));

afterEach(() => {
  current.viewer = null;
});

const APP_DIR = path.join(__dirname);

/** Every page file, as a route path. `@modal` intercepts are not URLs. */
function pageFiles(dir: string, prefix = ''): { route: string; file: string }[] {
  const found: { route: string; file: string }[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name.startsWith('@') || name.startsWith('_') || name.startsWith('(')) continue;
      found.push(...pageFiles(full, `${prefix}/${name}`));
    } else if (name === 'page.tsx') {
      found.push({ route: prefix === '' ? '/' : prefix, file: full });
    }
  }
  return found.sort((a, b) => a.route.localeCompare(b.route));
}

// W0-Q5: the repo holds no committed request (they are git artefacts a person
// submits), so the one route that needs one gets a single in-memory request. It
// is the real parser and the real deriver; only the file read is replaced.
vi.mock('@/app/requests/_lib/load-requests', async (importActual) => {
  const actual = await importActual<typeof import('@/app/requests/_lib/load-requests')>();
  const { parseRequestYaml } = await import('@/app/requests/_lib/request-file');
  const { deriveRequestState } = await import('@/app/requests/_lib/derive-state');
  const parsed = parseRequestYaml(
    [
      'apiVersion: mcpforge/v1',
      'kind: Request',
      'id: req-20261006-route-test',
      'requestedBy: local:route-test',
      'requestedAt: "2026-10-06T10:00:00.000Z"',
      'ask: search AP vouchers by amount',
      'business: { does: find vouchers by amount, app: jde, module: ap, access: read, inputs: [amount], goodAnswer: a list, whoMayRun: AP clerks }',
      'verdictAtSubmit: { tier: new, indexDigest: "sha256:abc", matches: [] }',
      'governance: { owner: JDE Finance CoE, steward: bob, sensitivity: internal, processTag: P2P, expectedVolume: "", intendedToolId: jde.ap.voucher.search_by_amount, server: jde-fin-ap }',
      '',
    ].join('\n'),
  );
  if (!parsed.ok) throw new Error(`route-test request fixture is invalid: ${parsed.message}`);
  const facts = {
    submissionOpen: false,
    draftProposalState: undefined,
    manifestMerged: false,
    approvalRecorded: false,
    inIndex: false,
    probeStatus: undefined,
  };
  return {
    ...actual,
    loadRequest: (id: string) =>
      Promise.resolve(
        id === parsed.request.id
          ? {
              request: parsed.request,
              derivation: deriveRequestState(parsed.request, facts),
              submissionProposalId: undefined,
              draftProposalId: undefined,
            }
          : undefined,
      ),
  };
});

/** One representative id per dynamic segment, as the a11y route list does. */
const PARAMS: Readonly<Record<string, Record<string, string>>> = {
  '/catalog/servers/[serverId]': { serverId: 'jde-fin-ap' },
  '/requests/[requestId]': { requestId: 'req-20261006-route-test' },
  '/activity/calls/[callId]': { callId: 'call_a1f9e0' },
  // W0-P3c: drafts are git branches now, so the one id that always resolves is `new`.
  '/build/[draftId]': { draftId: 'new' },
  '/catalog/[toolId]': { toolId: 'jde.ap.voucher.search' },
};

function viewerFor(personas: readonly Persona[] | 'signed-out'): Viewer | null {
  if (personas === 'signed-out') return null;
  return {
    subject: 'local:route-test',
    displayName: 'Route Test',
    groups: [],
    personas,
    persona: personas[0] ?? null,
    sessionExpiresAt: '2099-01-01T00:00:00.000Z',
  };
}

const VIEWERS: readonly [string, readonly Persona[] | 'signed-out'][] = [
  ['signed out', 'signed-out'],
  ['no persona', []],
  ['developer', ['developer']],
  ['business', ['business']],
  ['admin', ['admin']],
];

type PageModule = {
  default: (props: {
    params: Promise<Record<string, string>>;
    searchParams: Promise<Record<string, string>>;
  }) => React.ReactNode | Promise<React.ReactNode>;
};

async function firstApprovalId(): Promise<string> {
  const { loadApprovalQueue } = await import('./approvals/fixtures');
  const entry = loadApprovalQueue().find((e) => e.kind === 'runtime');
  if (entry === undefined || entry.kind !== 'runtime')
    throw new Error('no runtime approval fixture');
  return entry.approval.approvalId;
}

async function render(file: string, route: string): Promise<string> {
  const mod = (await import(/* @vite-ignore */ file)) as PageModule;
  const params =
    route === '/approvals/[approvalId]'
      ? { approvalId: await firstApprovalId() }
      : (PARAMS[route] ?? {});
  const props = { params: Promise.resolve(params), searchParams: Promise.resolve({}) };
  const Page = mod.default;
  // An async server component is awaited here, as Next does on the server; a
  // synchronous (often client) page renders as an element, so its hooks run
  // inside React.
  const element =
    Page.constructor.name === 'AsyncFunction'
      ? await Page(props)
      : React.createElement(Page as React.FC<typeof props>, props);
  return renderToString(<TooltipProvider>{element}</TooltipProvider>);
}

const PAGES = pageFiles(APP_DIR);

describe('every route renders for every persona (03 §2)', () => {
  it('finds the routes, including the governance surfaces and sign-in', () => {
    const routes = PAGES.map((p) => p.route);
    for (const r of [
      '/',
      '/governance',
      '/governance/kill-switch',
      '/governance/consumers',
      '/sign-in',
    ]) {
      expect(routes).toContain(r);
    }
  });

  for (const { route, file } of PAGES) {
    for (const [label, personas] of VIEWERS) {
      it(`${route} — ${label}`, async () => {
        current.viewer = viewerFor(personas);
        try {
          const html = await render(file, route);
          expect(html.length).toBeGreaterThan(0);
        } catch (error) {
          if (
            error instanceof NavigationEscape &&
            error.kind === 'redirect' &&
            route === '/' &&
            current.viewer?.persona != null
          ) {
            // `/`'s landing choice: allowed, and only to a route that is
            // itself rendered for everyone by this test.
            expect(error.to).toBe(PERSONA_LANDING[current.viewer.persona]);
            expect(PAGES.map((p) => p.route)).toContain(error.to);
            return;
          }
          throw error;
        }
      }, 60_000);
    }
  }
});
