// @vitest-environment jsdom
//
// W0-J16: the Calls page renders the business-key search box first-class at
// the top, and the two saved views ship with the product.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import ActivityPage from './page';

afterEach(cleanup);

describe('ActivityPage', () => {
  it('renders the business-key search box above the saved-view tabs', () => {
    render(<ActivityPage />);
    const search = screen.getByTestId('business-key-search');
    const allTab = screen.getByTestId('saved-view-all');
    expect(
      search.compareDocumentPosition(allTab) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('ships both saved views as visible tabs, not user-constructed filters', () => {
    render(<ActivityPage />);
    expect(screen.getByTestId('saved-view-this-week').textContent).toContain(
      'Everything I did this week',
    );
    expect(screen.getByTestId('saved-view-abandoned-intent').textContent).toContain(
      'Planned and never confirmed',
    );
  });

  it('filters to the abandoned-intent view on tab selection', () => {
    render(<ActivityPage />);
    fireEvent.click(screen.getByTestId('saved-view-abandoned-intent'));
    // The abandoned plan's tool is present, and only one data row is rendered.
    expect(screen.getAllByTestId(/^datatable-row-/).length).toBe(1);
    expect(document.body.textContent).toContain('jde.ap.voucher.create');
    // The reversed, executed call's result key must not appear in this view.
    expect(document.body.textContent).not.toContain('00123456');
  });

  it('renders the Integrity panel', () => {
    render(<ActivityPage />);
    expect(screen.getByTestId('integrity-panel')).not.toBeNull();
  });
});
