// @vitest-environment jsdom
//
// W0-P3c / W0-Q5: `/requests` ranks over this repository's committed discovery
// index. The tracked-request half (reading `requests/` and the change host) is
// covered by `_lib/requests-lib.test.ts` with injected ports, so this suite
// never starts a change host.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/change-host/local-git-actions', () => ({
  changeHostSubmitRequest: vi.fn(),
}));

import { RequestsView } from './requests-view';
import { loadRequestCatalog } from './source';

afterEach(cleanup);

describe('RequestsPage', () => {
  it('ranks over the committed index: every indexed tool has its manifest title', () => {
    const catalog = loadRequestCatalog();
    const ids = catalog.index.tools.map((t) => t.id);
    expect(ids).toContain('jde.ap.voucher.search');
    for (const id of ids) expect(catalog.tools[id]?.title.length).toBeGreaterThan(0);
  });

  it('with no request files, says how a request is recorded rather than showing a seeded list', () => {
    render(<RequestsView catalog={loadRequestCatalog()} requests={[]} />);
    expect(screen.queryByTestId('request-list')).toBeNull();
    expect(screen.getByTestId('request-list-empty').textContent).toContain('change proposal');
  });

  it('answers an ask with a real verdict and score from the committed index', () => {
    render(<RequestsView catalog={loadRequestCatalog()} requests={[]} />);
    fireEvent.change(screen.getByLabelText('Ask'), {
      target: { value: 'search AP vouchers for a supplier' },
    });
    expect(screen.getAllByTestId('verdict-score')[0]?.textContent).toMatch(/score \d+\.\d{3}/);
  });
});
