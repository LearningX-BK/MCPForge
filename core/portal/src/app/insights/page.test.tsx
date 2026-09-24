// @vitest-environment jsdom
//
// W0-J20 (reduced scope): Insights renders the five real metric cards, the
// real per-role TTFC breakdown, real token-budget pressure, and both
// deferred panels with their explanatory text — never fake data for the two
// deferred surfaces.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import InsightsPage from './page';
import { fixtureInsightsSourceFor, fixtureReport, fixtureReportNoFailingIntents } from './_lib/test-fixture';
import type { BaselineComparison, BenchBaseline } from './types';

function fixtureBaseline(over: Partial<BenchBaseline> = {}): BenchBaseline {
  return {
    schemaVersion: 1,
    recorded: '2026-09-04',
    coverage: { toolsInCatalogue: 0, intents: 0, servers: 0, rolesWithManifest: 0 },
    summary: {
      'sa1.overall': 1,
      'sa1.direct': 1,
      'sa1.near_miss': 1,
      'sa1.negative': 1,
      'sa1.sod_negative': 1,
      'ttfc.core-hit.max': 0,
      'ttfc.core-miss.max': 0,
      'ttfc.cold.max': 0,
      'vtc.max': 4,
      'dh.median': 0,
      'dh.p95': 0,
      'mtb.card.max': 0,
      'mtb.resident.max': 0,
      'mtb.describe.max': 0,
      'mtb.role-core-set.max': 0,
      'mtb.meta-resident': 315,
    },
    notes: ['PROVISIONAL BASELINE — recorded over an EMPTY catalogue and/or an empty intents suite.'],
    ...over,
  };
}

afterEach(cleanup);

describe('InsightsPage — the four honestly-sourceable elements', () => {
  it('renders exactly five metric cards, one per 02 §5.9 metric', () => {
    render(<InsightsPage source={() => fixtureInsightsSourceFor()} />);
    const row = screen.getByTestId('metric-card-row');
    expect(row.children.length).toBe(5);
    for (const id of ['sa1', 'ttfc', 'vtc', 'dh', 'mtb']) {
      expect(screen.getByTestId(`metric-card-${id}`)).toBeTruthy();
    }
  });

  it('sources each card\'s current value and CI verdict from the real BenchReport.metrics/.gates', () => {
    render(<InsightsPage source={() => fixtureInsightsSourceFor()} />);
    // SA@1: 9/10 -> 90.0%
    expect(screen.getByTestId('metric-card-sa1').textContent).toContain('90.0%');
    // TTFC core-hit max 1200
    expect(screen.getByTestId('metric-card-ttfc').textContent).toContain('1200');
    // Every gate in the fixture is ok:true -> CI pass badge
    expect(screen.getAllByTestId('metric-badge-pass').length).toBeGreaterThan(0);
  });

  it('flips a card to CI fail when its real gate is breached', () => {
    const report = fixtureReport();
    const breached = {
      ...report,
      gates: report.gates.map((g) => (g.id === 'ttfc.core-hit' ? { ...g, ok: false, observed: 2500 } : g)),
    };
    render(<InsightsPage source={() => fixtureInsightsSourceFor({ report: breached })} />);
    const card = screen.getByTestId('metric-card-ttfc');
    expect(card.querySelector('[data-testid="metric-badge-fail"]')).toBeTruthy();
  });

  it('shows a trend arrow computed from the real baseline comparison, and "no baseline recorded" without one', () => {
    render(<InsightsPage source={() => fixtureInsightsSourceFor()} />);
    // No baseline injected -> every card shows the no-trend state.
    expect(screen.getAllByTestId('metric-trend-none').length).toBe(5);
    expect(screen.getByTestId('insights-no-baseline')).toBeTruthy();

    const report = fixtureReport();
    const baseline: BenchBaseline = {
      schemaVersion: 1,
      recorded: '2026-09-01',
      coverage: { toolsInCatalogue: 3, intents: 10, servers: 1, rolesWithManifest: 1 },
      summary: { ...report.summary, 'ttfc.core-hit.max': 1500 },
      notes: [],
    };
    const comparison: BaselineComparison = { ok: true, compared: 16, regressions: [], missingFromCurrent: [], newInCurrent: [] };
    render(<InsightsPage source={() => fixtureInsightsSourceFor({ baseline, comparison })} />);
    expect(screen.queryAllByTestId('metric-trend').length).toBeGreaterThan(0);
  });

  it('renders the real per-role TTFC breakdown from TtfcReport.byRole', () => {
    render(<InsightsPage source={() => fixtureInsightsSourceFor()} />);
    expect(screen.getByTestId('role-ttfc-row-p2p')).toBeTruthy();
    expect(screen.getByTestId('role-ttfc-row-r2r')).toBeTruthy();
    // r2r has no Role manifest in the fixture -> flagged
    expect(screen.getByTestId('role-ttfc-row-r2r').textContent).toContain('no Role manifest');
  });

  it('renders real token-budget pressure rows from the real TokenBudgetGateResult', () => {
    render(<InsightsPage source={() => fixtureInsightsSourceFor()} />);
    // jde.ap.voucher.create: 390/400 resident = 97.5% -> above the 70% threshold
    expect(screen.getByTestId('budget-pressure-row-tool-jde.ap.voucher.create-resident')).toBeTruthy();
  });
});

describe('InsightsPage — the scaling-invariant chart, now a real single-point chart', () => {
  it('renders "no baseline to plot" when no baseline was read at all', () => {
    render(<InsightsPage source={() => fixtureInsightsSourceFor({ baseline: null, comparison: null })} />);
    const panel = screen.getByTestId('insights-scaling-chart');
    expect(screen.getByTestId('insights-scaling-chart-empty')).toBeTruthy();
    expect(panel.querySelector('svg')).toBeNull();
  });

  it('renders a real single-point chart off the committed baseline, honestly labelled as provisional/pre-scaling, no fabricated second point', () => {
    const baseline = fixtureBaseline();
    render(
      <InsightsPage
        source={() =>
          fixtureInsightsSourceFor({
            baseline,
            comparison: { ok: true, compared: 0, regressions: [], missingFromCurrent: [], newInCurrent: [] },
          })
        }
      />,
    );
    const panel = screen.getByTestId('insights-scaling-chart');
    expect(panel.querySelector('svg')).toBeTruthy();
    expect(screen.getByTestId('insights-scaling-chart-point')).toBeTruthy();
    // exactly one plotted point — never a fabricated series
    expect(screen.getAllByTestId('insights-scaling-chart-point').length).toBe(1);
    expect(screen.getByTestId('insights-scaling-chart-badge').textContent).toMatch(
      /pre-scaling.*single baseline.*more waves needed/i,
    );
    expect(screen.getByTestId('insights-scaling-chart-caption').textContent).toContain('2026-09-04');
    expect(screen.getByTestId('insights-scaling-chart-caption').textContent).toMatch(/provisional/i);
  });

  it('reads its point straight from the real BenchBaseline fields — catalogue size and TTFC core-hit max', () => {
    const baseline = fixtureBaseline({
      coverage: { toolsInCatalogue: 42, intents: 100, servers: 3, rolesWithManifest: 2 },
      summary: { ...fixtureBaseline().summary, 'ttfc.core-hit.max': 1350 },
    });
    render(
      <InsightsPage
        source={() =>
          fixtureInsightsSourceFor({
            baseline,
            comparison: { ok: true, compared: 0, regressions: [], missingFromCurrent: [], newInCurrent: [] },
          })
        }
      />,
    );
    expect(screen.getByTestId('insights-scaling-chart-point-label').textContent).toContain('42 tools');
    expect(screen.getByTestId('insights-scaling-chart-point-label').textContent).toContain('1350 tokens');
    // a non-provisional (fully-covered) baseline is not mislabelled "provisional"
    expect(screen.getByTestId('insights-scaling-chart-caption').textContent).not.toMatch(/provisional/i);
  });
});

describe('InsightsPage — failing benchmark cases, now real', () => {
  it('renders real failing intents from Sa1Report.failingIntents, distinguishing near-miss confusion from a wrongly-answered negative', () => {
    render(<InsightsPage source={() => fixtureInsightsSourceFor()} />);
    const panel = screen.getByTestId('failing-intents-panel');
    expect(panel.textContent).toContain('Failing benchmark cases');
    const row = screen.getByTestId('failing-intent-row-0');
    expect(row.getAttribute('data-category')).toBe('near_miss');
    // fixture: expect jde.ap.voucher.get, actual jde.ap.voucher.search
    expect(row.textContent).toContain('jde.ap.voucher.get');
    expect(row.textContent).toContain('jde.ap.voucher.search');
    expect(row.textContent).toContain('p2p');
  });

  it('shows an honest empty state when the last run has zero failing intents', () => {
    render(
      <InsightsPage
        source={() => fixtureInsightsSourceFor({ report: fixtureReportNoFailingIntents() })}
      />,
    );
    expect(screen.getByTestId('failing-intents-empty').textContent).toMatch(
      /No failing intents in the last run/,
    );
    expect(screen.queryByTestId('failing-intents-list')).toBeNull();
  });
});
