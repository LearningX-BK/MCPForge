// @vitest-environment jsdom
//
// W0-Q2: the detail reads this repository's real server and tool manifests,
// shows the split-rule inputs, drills entity -> tool -> binding -> target, links
// every tool to its Catalog page, and says "runtime state unavailable" when the
// gateway could not be read.
import { cleanup, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it } from 'vitest';

import { loadServerDefinitions } from '../../../environments/servers/load-servers';
import { loadServerDetailDefinition, toServerRuntime, toolCountPosition } from './load-detail';
import { ServerDetailView } from './server-detail-view';

afterEach(cleanup);

const render1 = (id: string) => {
  const detail = loadServerDetailDefinition(id)!;
  render(<ServerDetailView detail={detail} runtime={toServerRuntime(detail.def, null, null)} />);
  return detail;
};

describe('loadServerDetailDefinition', () => {
  it('returns undefined for an unknown server', () => {
    expect(loadServerDetailDefinition('no-such-server')).toBeUndefined();
  });
  it('agrees with the inventory on tool ids and binding types for every real server', () => {
    for (const inv of loadServerDefinitions()) {
      const d = loadServerDetailDefinition(inv.id)!;
      expect(d.def.toolIds).toEqual(inv.toolIds);
      expect(d.def.bindingTypes).toEqual(inv.bindingTypes);
    }
  });
  it('places the tool count against the 15–20 range', () => {
    expect([toolCountPosition(5), toolCountPosition(17), toolCountPosition(21)]).toEqual([
      'below',
      'in-range',
      'above',
    ]);
  });
});

describe('ServerDetailView', () => {
  it('shows facts, split inputs and a linked drill-down', () => {
    const d = render1('jde-fin-ap');
    expect(screen.getByTestId('split-count').textContent).toContain(
      `${d.def.toolIds.length} of 15–20`,
    );
    expect(screen.getAllByTestId('tool-row')).toHaveLength(d.def.toolIds.length);
    const first = d.def.toolIds[0]!;
    expect(
      screen.getAllByRole('link').some((a) => a.getAttribute('href') === `/catalog/${first}`),
    ).toBe(true);
    expect(
      within(screen.getAllByTestId('tool-row')[0]!).getByText(/function|plsql|database|rest/),
    ).not.toBeNull();
  });
  it('says runtime state is unavailable, never faked', () => {
    render1('jde-fin-ap');
    expect(screen.getByTestId('detail-probe').textContent).toBe('runtime state unavailable');
    expect(screen.getByTestId('detail-kill').textContent).toBe('runtime state unavailable');
  });
  it('has no serious or critical axe violations', async () => {
    render1('jde-fin-ap');
    const r = await axe(document.body);
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
  });
});
