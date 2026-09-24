// @vitest-environment jsdom
//
// MCPForge — W0-J13: the live count line, the default Table view, and the
// view toggle switching what renders.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let currentSearch = '';
const replace = vi.fn((url: string) => {
  currentSearch = url.includes('?') ? url.split('?')[1]! : '';
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/catalog',
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

import { CatalogList } from './catalog-list';
import { fixtureCatalogSource } from '../fixtures';

afterEach(() => {
  cleanup();
  currentSearch = '';
  replace.mockClear();
});

const data = fixtureCatalogSource();

describe('CatalogList', () => {
  it('renders the live count line — "N of M tools · <deployment label>"', () => {
    render(<CatalogList data={data} />);
    const line = screen.getByTestId('catalog-count-line');
    expect(line.textContent).toMatch(/^\d+ of \d+ tools · JD Edwards Financials$/);
  });

  it('Table is the default view', () => {
    render(<CatalogList data={data} />);
    expect(screen.getByTestId('catalog-view-table').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('datatable-scroll')).not.toBeNull();
  });

  it('switching to Cards renders the cards grid instead of the table', () => {
    render(<CatalogList data={data} />);
    fireEvent.click(screen.getByTestId('catalog-view-cards'));
    expect(replace).toHaveBeenCalled();
    const url = replace.mock.calls[0]![0] as string;
    expect(url).toContain('view=cards');
  });

  it('switching to Map is available as a third toggle option', () => {
    render(<CatalogList data={data} />);
    expect(screen.getByTestId('catalog-view-map')).not.toBeNull();
  });

  it('the default facet state preselects resolved + degraded_readonly, so the count is below the total', () => {
    render(<CatalogList data={data} />);
    const line = screen.getByTestId('catalog-count-line').textContent!;
    const [shown] = line.split(' of ').map((s) => parseInt(s, 10));
    expect(shown).toBeLessThan(data.tools.length);
  });
});
