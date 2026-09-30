// @vitest-environment jsdom
//
// W0-P3c: `/requests` ranks over this repository's committed discovery index
// and shows no invented tracked requests.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import RequestsPage from './page';
import { loadRequestCatalog } from './source';

afterEach(cleanup);

describe('RequestsPage', () => {
  it('ranks over the committed index: every indexed tool has its manifest title', () => {
    const catalog = loadRequestCatalog();
    const ids = catalog.index.tools.map((t) => t.id);
    expect(ids).toContain('jde.ap.voucher.search');
    for (const id of ids) expect(catalog.tools[id]?.title.length).toBeGreaterThan(0);
  });

  it('shows no tracked requests, and says why, rather than a seeded list', () => {
    render(<RequestsPage />);
    expect(screen.queryByTestId('request-list')).toBeNull();
    expect(screen.getByTestId('request-list-empty').textContent).toContain('W0-Q4');
  });

  it('answers an ask with a real verdict and score from the committed index', () => {
    render(<RequestsPage />);
    fireEvent.change(screen.getByLabelText('Ask'), {
      target: { value: 'search AP vouchers for a supplier' },
    });
    expect(screen.getAllByTestId('verdict-score')[0]?.textContent).toMatch(/score \d+\.\d{3}/);
  });
});
