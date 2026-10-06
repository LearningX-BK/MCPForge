// @vitest-environment jsdom
//
// MCPForge — W0-P6: the module-server inventory reads this repository's real
// `manifests/_servers/` from git, joins runtime state when the gateway answers,
// and keeps "could not read" distinct from "none" and from "not killed".
import { cleanup, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/environments/servers' }));

import { loadServerDefinitions, toInventory } from './load-servers';
import { ServersView, catalogLinkFor } from './servers-view';
import { loadCatalogDefinitions } from '../../catalog/load-catalog';
import { EnvNav } from '../_components/env-nav';

afterEach(cleanup);

const enablement = (tools: { toolId: string; status: string | null }[]) => ({
  asOf: '2026-10-01T00:00:00Z',
  probe: null,
  tools: tools.map((t) => ({
    ...t,
    bindingType: 'function',
    failingCheck: null,
    remediation: null,
    owningTeam: null,
  })),
});

const deployment = (killFlags: { scope: string; target: string; reason: string }[]) =>
  ({
    killFlags: killFlags.map((f, i) => ({
      id: `k${i}`,
      until: null,
      createdBy: 'local:x',
      createdAt: '2026-10-01T00:00:00Z',
      ...f,
    })),
  }) as never;

describe('loadServerDefinitions (git, not a fixture)', () => {
  const defs = loadServerDefinitions();

  it('reads every committed manifests/_servers/*.server.yaml', () => {
    expect(defs.map((d) => d.id)).toEqual(['jde-fin-ap', 'jde-fin-gl', 'jde-scm-po']);
    const ap = defs.find((d) => d.id === 'jde-fin-ap')!;
    expect(ap.mode).toBe('A');
    expect(ap.version).toBe('1.4.0');
    expect(ap.owner).toContain('JDE Fin');
  });

  it('counts tools and binding types from the committed tool manifests', () => {
    const catalog = loadCatalogDefinitions().tools;
    for (const d of defs) {
      const expected = catalog.filter((t) => t.manifest.server === d.id);
      expect(d.toolIds.length).toBe(expected.length);
      expect(d.bindingTypes).toEqual(
        [...new Set(expected.map((t) => t.manifest.binding.type))].sort(),
      );
    }
    expect(defs.some((d) => d.toolIds.length > 0)).toBe(true);
  });
});

describe('toInventory', () => {
  const defs = loadServerDefinitions();
  const ap = defs.find((d) => d.id === 'jde-fin-ap')!;

  it('is unknown, not empty, for both runtime columns when neither read succeeded', () => {
    const rows = toInventory(defs, null, null);
    expect(rows.every((r) => r.probe.kind === 'unknown' && r.kill.kind === 'unknown')).toBe(true);
  });

  it('separates not-probed (null status) from not-reported (absent)', () => {
    const [first, second] = ap.toolIds;
    const rows = toInventory(
      defs,
      enablement([
        { toolId: first!, status: 'resolved' },
        { toolId: second!, status: null },
      ]),
      deployment([]),
    );
    const row = rows.find((r) => r.id === 'jde-fin-ap')!;
    expect(row.probe).toEqual({
      kind: 'reported',
      summary: { byStatus: [{ status: 'resolved', count: 1 }], notProbed: 1 },
    });
    expect(row.kill).toEqual({ kind: 'known', serverFlags: [], killedToolCount: 0 });
  });

  it('attributes moduleServer, deployment and tool kill flags correctly', () => {
    const rows = toInventory(
      defs,
      null,
      deployment([
        { scope: 'moduleServer', target: 'jde-fin-ap', reason: 'bad release' },
        { scope: 'moduleServer', target: 'jde-fin-gl', reason: 'other' },
        { scope: 'tool', target: ap.toolIds[0]!, reason: 'one tool' },
      ]),
    );
    const apRow = rows.find((r) => r.id === 'jde-fin-ap')!;
    const poRow = rows.find((r) => r.id === 'jde-scm-po')!;
    expect(apRow.kill).toEqual({
      kind: 'known',
      serverFlags: [{ scope: 'moduleServer', reason: 'bad release' }],
      killedToolCount: 1,
    });
    expect(poRow.kill).toEqual({ kind: 'known', serverFlags: [], killedToolCount: 0 });
  });
});

describe('ServersView', () => {
  const defs = loadServerDefinitions();

  it('shows id, mode, version, owner, a Catalog-filtered tool link, binding types', () => {
    render(<ServersView servers={toInventory(defs, enablement([]), deployment([]))} />);
    const card = screen.getByTestId('server-jde-fin-ap');
    expect(within(card).getByText('A — in-process')).toBeTruthy();
    expect(within(card).getByText('1.4.0')).toBeTruthy();
    const link = within(card).getByRole('link', { name: /open in Catalog/ });
    expect(link.getAttribute('href')).toBe('/catalog?server=jde-fin-ap');
    // W0-Q2: the id opens the server's own detail page.
    expect(within(card).getByTestId('server-detail-link-jde-fin-ap').getAttribute('href')).toBe(
      '/catalog/servers/jde-fin-ap',
    );
    expect(catalogLinkFor('jde-fin-ap')).toBe('/catalog?server=jde-fin-ap');
    expect(within(card).getByText('Not killed')).toBeTruthy();
  });

  it('gateway-down is visibly distinct from empty or not-killed, and git data still renders', () => {
    render(
      <ServersView
        servers={toInventory(defs, null, null)}
        runtimeNotice={{
          state: { kind: 'gateway-down', endpoint: 'http://x', next: 'Start the gateway.' },
          subject: 'Probe status and kill-switch state',
        }}
      />,
    );
    expect(screen.getByTestId('server-jde-fin-ap')).toBeTruthy();
    expect(screen.getByTestId('probe-unknown-jde-fin-ap')).toBeTruthy();
    expect(screen.getByTestId('kill-unknown-jde-fin-ap')).toBeTruthy();
    expect(screen.queryByText('Not killed')).toBeNull();
    expect(document.body.textContent).toContain('Start the gateway.');
  });

  it('a killed server says so and why', () => {
    render(
      <ServersView
        servers={toInventory(
          defs,
          enablement([]),
          deployment([{ scope: 'moduleServer', target: 'jde-fin-gl', reason: 'bad release' }]),
        )}
      />,
    );
    expect(within(screen.getByTestId('server-jde-fin-gl')).getByText(/bad release/)).toBeTruthy();
  });

  it('never renders "verified" (no probe reference is shown here)', () => {
    render(<ServersView servers={toInventory(defs, enablement([]), deployment([]))} />);
    expect(document.body.textContent?.toLowerCase()).not.toContain('verified');
  });

  it('an empty inventory is its own message', () => {
    render(<ServersView servers={[]} />);
    expect(screen.getByTestId('servers-empty')).toBeTruthy();
  });

  it('is reachable from /environments: the nav links to it', () => {
    render(<EnvNav />);
    expect(screen.getByRole('link', { name: 'Servers' }).getAttribute('href')).toBe(
      '/environments/servers',
    );
  });

  it('has no serious or critical axe violations, with and without runtime data', async () => {
    for (const rows of [
      toInventory(defs, enablement([]), deployment([])),
      toInventory(defs, null, null),
    ]) {
      const { container, unmount } = render(<ServersView servers={rows} />);
      const results = await axe(container);
      const bad = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(bad.map((v) => v.id)).toEqual([]);
      unmount();
    }
  });
});
