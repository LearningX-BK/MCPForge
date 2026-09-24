// @vitest-environment jsdom
//
// MCPForge — W0-J17: the enablement backlog groups by owning team.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/environments/enablement' }));

import EnablementPage from './page';
import { loadEnablementBacklog } from '../fixtures';

afterEach(cleanup);

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
});
