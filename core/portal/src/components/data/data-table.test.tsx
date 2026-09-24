// @vitest-environment jsdom
//
// W0-J10 — `DataTable`: real semantics (`<th scope>`, caption, `aria-sort`),
// one tab stop with arrow-key/Enter/Esc grid navigation, virtualisation past
// the threshold, and a once-per-load result-count announcement. 03 §3.4,
// §12.2, §12.6.
import * as React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ColumnDef } from '@tanstack/react-table';
import { axe } from 'vitest-axe';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DataTable } from './data-table';

interface Row {
  id: string;
  name: string;
  verb: string;
}

const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'verb', header: 'Verb' },
];

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${i}`,
    name: `Tool ${i}`,
    verb: i % 2 === 0 ? 'create' : 'get',
  }));
}

afterEach(() => cleanup());

describe('DataTable — semantics', () => {
  it('renders a real <table> with <th scope="col"> for every column', () => {
    render(<DataTable columns={columns} data={makeRows(3)} caption="Tools" />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(2);
    for (const h of headers) {
      expect(h.tagName).toBe('TH');
      expect(h.getAttribute('scope')).toBe('col');
    }
  });

  it('always renders a real <caption> in the DOM, sr-only by default', () => {
    const { container } = render(
      <DataTable columns={columns} data={makeRows(3)} caption="Tools table" />,
    );
    const caption = container.querySelector('caption');
    expect(caption).not.toBeNull();
    expect(caption?.textContent).toBe('Tools table');
    expect(caption?.className).toContain('sr-only');
  });

  it('captionVisible renders the caption without sr-only', () => {
    const { container } = render(
      <DataTable columns={columns} data={makeRows(3)} caption="Tools table" captionVisible />,
    );
    expect(container.querySelector('caption')?.className).not.toContain('sr-only');
  });

  it('aria-sort toggles none -> ascending -> descending -> none on a sortable column', () => {
    render(<DataTable columns={columns} data={makeRows(3)} caption="Tools" />);
    const nameHeader = screen.getAllByRole('columnheader')[0]!;
    expect(nameHeader.getAttribute('aria-sort')).toBe('none');

    const sortButton = within(nameHeader).getByRole('button');
    fireEvent.click(sortButton);
    expect(nameHeader.getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(sortButton);
    expect(nameHeader.getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(sortButton);
    expect(nameHeader.getAttribute('aria-sort')).toBe('none');
  });

  // See facet-panel.test.tsx for why this axe test carries an explicit
  // timeout: it can exceed vitest's 5000ms default under a full repo-wide
  // `pnpm test` run's CPU contention, though it is fast in isolation.
  it(
    'has zero serious/critical axe violations',
    async () => {
      const { container } = render(<DataTable columns={columns} data={makeRows(5)} caption="Tools" />);
      const results = await axe(container);
      expect(
        results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')),
      ).toHaveLength(0);
    },
    15000,
  );
});

describe('DataTable — one tab stop, arrow/Enter/Esc grid navigation', () => {
  it('exactly one cell is a tab stop (tabIndex 0); the rest are -1', () => {
    render(<DataTable columns={columns} data={makeRows(3)} caption="Tools" />);
    const cell00 = screen.getByTestId('datatable-cell-0-0');
    const others = [
      screen.getByTestId('datatable-cell-0-1'),
      screen.getByTestId('datatable-cell-1-0'),
      screen.getByTestId('datatable-cell-2-1'),
    ];
    expect(cell00.tabIndex).toBe(0);
    for (const cell of others) expect(cell.tabIndex).toBe(-1);
  });

  it('ArrowDown/ArrowRight move the active cell', () => {
    render(<DataTable columns={columns} data={makeRows(3)} caption="Tools" />);
    const scroll = screen.getByTestId('datatable-scroll');
    fireEvent.keyDown(scroll, { key: 'ArrowDown' });
    fireEvent.keyDown(scroll, { key: 'ArrowRight' });
    expect(screen.getByTestId('datatable-cell-1-1').tabIndex).toBe(0);
    expect(screen.getByTestId('datatable-cell-0-0').tabIndex).toBe(-1);
  });

  it('Enter fires onRowOpen with the active row', () => {
    const rows = makeRows(3);
    const onRowOpen = vi.fn();
    render(<DataTable columns={columns} data={rows} caption="Tools" onRowOpen={onRowOpen} />);
    const scroll = screen.getByTestId('datatable-scroll');
    fireEvent.keyDown(scroll, { key: 'ArrowDown' }); // move to row 1
    fireEvent.keyDown(scroll, { key: 'Enter' });
    expect(onRowOpen).toHaveBeenCalledWith(rows[1], 1);
  });

  it('Esc returns focus to the element that had it before entering the grid', () => {
    render(
      <div>
        <button data-testid="outside">Outside</button>
        <DataTable columns={columns} data={makeRows(3)} caption="Tools" />
      </div>,
    );
    const outside = screen.getByTestId('outside');
    outside.focus();
    const cell00 = screen.getByTestId('datatable-cell-0-0');
    // Simulate tabbing in: focus the cell with relatedTarget = outside.
    fireEvent.focus(cell00, { relatedTarget: outside });
    const scroll = screen.getByTestId('datatable-scroll');
    fireEvent.keyDown(scroll, { key: 'Escape' });
    expect(document.activeElement).toBe(outside);
  });
});

describe('DataTable — virtualisation past the threshold', () => {
  // DOCUMENTED LIMITATION: jsdom has no layout engine, so `offsetWidth` /
  // `offsetHeight` are always 0 — and `@tanstack/react-virtual` reads
  // exactly those (not `getBoundingClientRect`, checked against its own
  // source) synchronously on mount to measure the scroll container, which
  // immediately overwrites `initialRect` with a 0x0 result. Left unmocked,
  // the virtualizer believes its viewport is zero-height and renders
  // nothing at all, under or over the threshold, which would make these
  // assertions meaningless. So this suite stubs `offsetWidth`/`offsetHeight`
  // to report a fixed, non-zero viewport — the same class of workaround the
  // TanStack Virtual test suite itself uses under jsdom. This exercises the
  // virtualizer's real windowing math (only a subset of 500 rows renders)
  // but cannot exercise real scroll-driven remeasurement, which jsdom has
  // no layout to drive either way.
  let widthSpy: ReturnType<typeof vi.spyOn>;
  let heightSpy: ReturnType<typeof vi.spyOn>;
  beforeAll(() => {
    widthSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
      .mockReturnValue(800);
    heightSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockReturnValue(300);
  });
  afterAll(() => {
    widthSpy.mockRestore();
    heightSpy.mockRestore();
  });

  it('renders all rows when under the threshold', () => {
    render(<DataTable columns={columns} data={makeRows(10)} caption="Tools" virtualizeThreshold={200} />);
    for (let i = 0; i < 10; i += 1) {
      expect(screen.getByTestId(`datatable-row-${i}`)).not.toBeNull();
    }
  });

  it('renders only a subset of rows when the dataset exceeds the threshold', () => {
    const total = 500;
    render(
      <DataTable columns={columns} data={makeRows(total)} caption="Tools" virtualizeThreshold={200} />,
    );
    const rendered = screen.getAllByTestId(/^datatable-row-/);
    expect(rendered.length).toBeLessThan(total);
    expect(rendered.length).toBeGreaterThan(0);
  });

  it('respects a custom virtualizeThreshold', () => {
    // 50 rows, threshold 10 -> virtualises even a small dataset.
    render(
      <DataTable columns={columns} data={makeRows(50)} caption="Tools" virtualizeThreshold={10} />,
    );
    const rendered = screen.getAllByTestId(/^datatable-row-/);
    expect(rendered.length).toBeLessThan(50);
  });
});

describe('DataTable — result-count announcement', () => {
  it('announces the count once after a loading -> loaded transition, not on every render', () => {
    const { rerender } = render(
      <DataTable columns={columns} data={[]} caption="Tools" isLoading />,
    );
    expect(screen.getByTestId('datatable-announce').textContent).toBe('');

    rerender(<DataTable columns={columns} data={makeRows(47)} caption="Tools" isLoading={false} />);
    expect(screen.getByTestId('datatable-announce').textContent).toBe('47 items.');

    // Re-rendering with the same data/loading state must not re-announce
    // (no new text, no duplicate work) — assert stability, not just presence.
    rerender(<DataTable columns={columns} data={makeRows(47)} caption="Tools" isLoading={false} />);
    expect(screen.getByTestId('datatable-announce').textContent).toBe('47 items.');
  });

  it('uses singular wording for exactly one row', () => {
    const { rerender } = render(<DataTable columns={columns} data={[]} caption="Tools" isLoading />);
    rerender(<DataTable columns={columns} data={makeRows(1)} caption="Tools" isLoading={false} />);
    expect(screen.getByTestId('datatable-announce').textContent).toBe('1 item.');
  });
});
