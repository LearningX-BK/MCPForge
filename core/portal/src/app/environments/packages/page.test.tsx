// @vitest-environment jsdom
//
// MCPForge — W0-J17: the Packages tab carries the standing D1 note verbatim.
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
});
