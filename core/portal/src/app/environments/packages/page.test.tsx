// @vitest-environment jsdom
//
// MCPForge — W0-J17: the Packages tab carries the standing D1 note verbatim.
// W0-P3c: the page reads this repository's own `packages/` from git.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/environments/packages' }));

import PackagesPage from './page';
import { D1_PACKAGING_NOTE } from '../types';

afterEach(cleanup);

describe('PackagesPage', () => {
  it('renders the D1_PACKAGING_NOTE constant verbatim — exact string match, not paraphrase', () => {
    render(<PackagesPage />);
    expect(screen.getByTestId('d1-packaging-note').textContent).toBe(D1_PACKAGING_NOTE);
  });

  it('shows what is not included per package — staleness/completeness honesty', () => {
    render(<PackagesPage />);
    expect(document.body.textContent).toContain('Not included');
  });

  it('shows the committed package as git holds it, not a fixture', () => {
    render(<PackagesPage />);
    expect(screen.getByRole('heading', { name: 'JD Edwards Financials' })).toBeTruthy();
    // packages/jde-fin.yaml selects these three servers.
    expect(document.body.textContent).toContain('jde-fin-ap, jde-fin-gl, jde-scm-po');
  });
});
