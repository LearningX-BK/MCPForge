// @vitest-environment jsdom
//
// MCPForge — W0-J17: the enablement backlog groups by owning team.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/environments/enablement' }));

import { EnablementBacklogView } from './backlog-view';
import { loadEnablementBacklog } from '../fixtures';
import { toBacklog } from '../live';

afterEach(cleanup);

function EnablementPage() {
  return <EnablementBacklogView groups={loadEnablementBacklog()} />;
}

describe('EnablementPage', () => {
  it('groups unresolved tools by real owning team, with each shown as a section heading', () => {
    render(<EnablementPage />);
    const groups = loadEnablementBacklog();
    for (const group of groups) {
      expect(screen.getByRole('heading', { name: new RegExp(group.owningTeam) })).not.toBeNull();
    }
  });

  it('names the failing check and remediation for every backlog entry', () => {
    render(<EnablementPage />);
    expect(document.body.textContent).toContain('Failing check:');
  });

  it('lists a tool no probe has reported on as "Not probed", never as a probe status', () => {
    const groups = toBacklog({
      asOf: '2026-09-28T00:00:00Z',
      probe: null,
      tools: [
        {
          toolId: 'jde.ap.voucher.search',
          status: null,
          bindingType: 'function',
          failingCheck: null,
          remediation: null,
          owningTeam: null,
        },
        {
          toolId: 'jde.ap.voucher.get',
          status: 'resolved',
          bindingType: 'function',
          failingCheck: null,
          remediation: null,
          owningTeam: 'JDE Finance CoE',
        },
      ],
    });
    render(<EnablementBacklogView groups={groups} />);
    expect(screen.getByTestId('enablement-unprobed-jde.ap.voucher.search').textContent).toBe(
      'Not probed',
    );
    // A resolved tool is not backlog.
    expect(document.body.textContent).not.toContain('jde.ap.voucher.get');
    expect(document.body.textContent).toContain('forge probe');
  });

  it('says "nothing in scope", never "all resolved", when the viewer may see no tools', () => {
    render(<EnablementBacklogView groups={[]} toolsInScope={0} />);
    expect(screen.getByTestId('enablement-no-scope')).toBeTruthy();
    expect(screen.queryByTestId('enablement-empty')).toBeNull();
  });
});
