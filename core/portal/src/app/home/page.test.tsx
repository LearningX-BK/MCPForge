// @vitest-environment jsdom
//
// W0-J19: Home's empty state says exactly "Nothing is waiting on you" plus
// the three first things to do, and Home never renders a chart.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import HomePage from './page';
import { EMPTY_HOME_WORKLIST, fixtureHomeSource } from './fixtures';

afterEach(cleanup);

describe('HomePage', () => {
  it('shows the exact empty-state copy on a fresh local install, never a blank grid', () => {
    render(<HomePage source={() => EMPTY_HOME_WORKLIST} />);
    const empty = screen.getByTestId('home-empty-state');
    expect(empty.textContent).toContain('Nothing is waiting on you');
    // The three first things to do — never a blank grid.
    expect(screen.getByText(/Run the probe/)).toBeTruthy();
    expect(screen.getByText(/Open the catalog/)).toBeTruthy();
    expect(screen.getByText(/Read the architecture doc/)).toBeTruthy();
  });

  it('renders no chart, canvas or svg-chart element anywhere on Home — that is Insights\' job', () => {
    const { container } = render(<HomePage source={fixtureHomeSource} />);
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('[data-chart]')).toBeNull();
    expect(container.querySelector('.recharts-wrapper')).toBeNull();
  });

  it('renders exactly one four-number KPI strip', () => {
    render(<HomePage source={fixtureHomeSource} />);
    const strip = screen.getByTestId('home-kpi-strip');
    expect(strip.children.length).toBe(4);
  });

  it('renders the three-column worklist — my queue / what broke / what changed — when there is work', () => {
    render(<HomePage source={fixtureHomeSource} />);
    expect(screen.getByText('My queue')).toBeTruthy();
    expect(screen.getByText('What broke')).toBeTruthy();
    expect(screen.getByText('What changed')).toBeTruthy();
  });
});
