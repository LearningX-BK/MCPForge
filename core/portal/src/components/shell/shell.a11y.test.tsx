// @vitest-environment jsdom
//
// W0-J6 — accessibility gate for the app shell, same pattern and threshold
// as `../ui/a11y.test.tsx` and `../chips/chips.a11y.test.tsx`: `vitest-axe`
// substituting for the doc-named `jest-axe` (CLAUDE.md — "Tests are
// Vitest"), zero violations at `serious`/`critical` impact (03 §12.7).
import { render, cleanup } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/approvals',
}));

import { AppShell } from './app-shell';

afterEach(cleanup);

function seriousOrAbove(violations: { impact?: string | null }[]) {
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

describe('AppShell — axe (03 §12.7, serious/critical threshold)', () => {
  it('has no serious or critical violations, expanded sidebar, empty change tray', async () => {
    const { container } = render(
      <AppShell title="Approvals" subtitle="Awaiting your review" envClass="local">
        <h2>Page content</h2>
      </AppShell>,
    );
    const results = await axe(container);
    expect(seriousOrAbove(results.violations)).toEqual([]);
  });

  it('has no serious or critical violations with the change tray expanded and populated', async () => {
    const { container } = render(
      <AppShell
        title="Approvals"
        envClass="prod"
        changeTrayItems={[
          { id: '1', label: 'ebs.p2p.invoice.create', state: 'draft' },
          { id: '2', label: 'p2p role widen', state: 'in_review' },
        ]}
      >
        <h2>Page content</h2>
      </AppShell>,
    );
    const results = await axe(container);
    expect(seriousOrAbove(results.violations)).toEqual([]);
  });

  it('has no serious or critical violations with the sidebar collapsed to a rail', async () => {
    const { container, getByRole } = render(
      <AppShell title="Approvals" envClass="local">
        <h2>Page content</h2>
      </AppShell>,
    );
    getByRole('button', { name: 'Collapse sidebar' }).click();
    const results = await axe(container);
    expect(seriousOrAbove(results.violations)).toEqual([]);
  });
});
