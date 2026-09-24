// @vitest-environment jsdom
//
// W0-J19: Requests shows the real similarity score (not hidden), and the
// lifecycle ends at Enabled with a named owning team.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import RequestsPage from './page';

afterEach(cleanup);

describe('RequestsPage', () => {
  it('shows a real numeric similarity score for every tracked request verdict, not hidden', () => {
    render(<RequestsPage />);
    const scores = screen.getAllByTestId('verdict-score');
    expect(scores.length).toBeGreaterThan(0);
    for (const el of scores) {
      expect(el.textContent).toMatch(/score \d+\.\d{3}/);
    }
  });

  it('names the owning application team for the enabled request', () => {
    render(<RequestsPage />);
    const owning = screen.getAllByTestId('owning-team');
    expect(owning.length).toBeGreaterThan(0);
    expect(owning[0]?.textContent).toContain('Waiting on');
  });

  it("ends the lifecycle at Enabled, not Merged", () => {
    render(<RequestsPage />);
    const list = screen.getByTestId('request-list');
    expect(list.textContent).toContain('Enabled');
    // The lifecycle line names both, but the FINAL, terminal word must be Enabled.
    const lifecycleText = screen.getByText(/Lifecycle:/).textContent ?? '';
    const states = lifecycleText.split('Lifecycle:')[1]?.split('.')[0] ?? '';
    expect(states.trim().endsWith('Enabled')).toBe(true);
  });
});
