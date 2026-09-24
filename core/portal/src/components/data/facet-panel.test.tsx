// @vitest-environment jsdom
//
// W0-J10 — `FacetPanel`: roving tabindex within one facet row, `Tab` moves
// between groups (03 §12.2). Zero axe violations at serious/critical, same
// threshold as the chip family (03 §12.7).
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it } from 'vitest';

import { FacetPanel, type FacetGroupDef } from './facet-panel';

const groups: FacetGroupDef[] = [
  {
    key: 'app',
    label: 'Application',
    options: [
      { value: 'jde', label: 'JD Edwards' },
      { value: 'ebs', label: 'E-Business Suite' },
      { value: 'fusion', label: 'Fusion' },
    ],
  },
  {
    key: 'verb',
    label: 'Verb',
    options: [
      { value: 'create', label: 'Create' },
      { value: 'get', label: 'Get' },
    ],
  },
];

function Harness() {
  const [state, setState] = React.useState<Record<string, string[]>>({});
  return (
    <FacetPanel
      groups={groups}
      isSelected={(g: string, v: string) => Boolean(state[g]?.includes(v))}
      onToggle={(g: string, v: string) =>
        setState((prev: Record<string, string[]>) => {
          const current = prev[g] ?? [];
          const next = current.includes(v) ? current.filter((x) => x !== v) : [...current, v];
          return { ...prev, [g]: next };
        })
      }
    />
  );
}

afterEach(() => cleanup());

describe('FacetPanel', () => {
  // Explicit timeout: under a full repo-wide `pnpm test` run (many workspace
  // suites competing for CPU) axe's DOM audit has been observed to exceed
  // vitest's 5000ms default here even though it completes in well under a
  // second running this file alone. Same fix, same rationale, as any other
  // CPU-bound test under contention — not a change to what is asserted.
  it(
    'has zero serious/critical axe violations',
    async () => {
      const { container } = render(<Harness />);
      const results = await axe(container);
      expect(results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toHaveLength(0);
    },
    15000,
  );

  it('renders each group as a labelled role="group"', () => {
    render(<Harness />);
    expect(screen.getByRole('group', { name: 'Application' })).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Verb' })).not.toBeNull();
  });

  it('exactly one pill per row is tabbable at a time (roving tabindex)', () => {
    render(<Harness />);
    const appPills = [
      screen.getByTestId('facet-pill-app-jde'),
      screen.getByTestId('facet-pill-app-ebs'),
      screen.getByTestId('facet-pill-app-fusion'),
    ];
    const tabbable = appPills.filter((p) => p.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toBe(appPills[0]); // none selected yet -> first is the roving stop
  });

  it('ArrowRight/ArrowLeft cycle focus within one row and wrap at the ends', () => {
    render(<Harness />);
    const jde = screen.getByTestId('facet-pill-app-jde');
    const ebs = screen.getByTestId('facet-pill-app-ebs');
    const fusion = screen.getByTestId('facet-pill-app-fusion');

    jde.focus();
    fireEvent.keyDown(jde, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(ebs);
    fireEvent.keyDown(ebs, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(fusion);
    fireEvent.keyDown(fusion, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(jde); // wraps

    fireEvent.keyDown(jde, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(fusion); // wraps backward
  });

  it('does not move focus on Tab — native tab order carries focus to the next group', async () => {
    render(<Harness />);
    // Sanity: Tab is not intercepted (no onKeyDown handling for it), so
    // FacetRow does not preventDefault. We assert this by confirming no
    // keydown handler swallows the key — jsdom/RTL cannot simulate real
    // browser tab order, so this is a negative-handling check rather than
    // an end-to-end tab traversal.
    const jde = screen.getByTestId('facet-pill-app-jde');
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    jde.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('the selected pill becomes the roving tab stop', () => {
    render(<Harness />);
    const ebs = screen.getByTestId('facet-pill-app-ebs');
    fireEvent.click(ebs);
    expect(ebs.tabIndex).toBe(0);
    expect(screen.getByTestId('facet-pill-app-jde').tabIndex).toBe(-1);
  });
});
