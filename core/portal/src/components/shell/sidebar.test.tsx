// @vitest-environment jsdom
//
// W0-J6 — sidebar: group expansion (03 §5.2's `done:`: only the group
// containing the current page is expanded on load; navigating into a
// collapsed group auto-expands it) and rail-icon distinctness at the
// rendered level.
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let mockPathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

import { Sidebar } from './sidebar';

// No global auto-cleanup is configured for this package's Vitest runner
// (`vitest.config.ts` does not set `test.globals`), so each render must be
// torn down explicitly between cases in this file that render more than once.
afterEach(cleanup);

function groupPanel(id: string) {
  return document.getElementById(`nav-group-${id}`);
}

describe('Sidebar — group expansion (03 §5.2)', () => {
  it('only the group containing the current page is expanded on load (Home -> work)', () => {
    mockPathname = '/';
    render(<Sidebar />);
    expect(groupPanel('work')).toBeTruthy();
    expect(groupPanel('control')).toBeNull();
    expect(groupPanel('platform')).toBeNull();
  });

  it('loads with only Platform expanded when current page is Insights', () => {
    mockPathname = '/insights';
    render(<Sidebar />);
    expect(groupPanel('platform')).toBeTruthy();
    expect(groupPanel('work')).toBeNull();
    expect(groupPanel('control')).toBeNull();
  });

  it('navigating into a collapsed group auto-expands it', () => {
    mockPathname = '/';
    const { rerender } = render(<Sidebar />);
    expect(groupPanel('control')).toBeNull();

    mockPathname = '/approvals';
    rerender(<Sidebar />);
    expect(groupPanel('control')).toBeTruthy();
    // The originally-active group stays open too — auto-expand only adds.
    expect(groupPanel('work')).toBeTruthy();
  });

  it('a manually-collapsed group can still be reopened by clicking its header', () => {
    mockPathname = '/';
    render(<Sidebar />);
    const header = screen.getByRole('button', { name: 'Work' });
    fireEvent.click(header);
    expect(groupPanel('work')).toBeNull();
    fireEvent.click(header);
    expect(groupPanel('work')).toBeTruthy();
  });

  it('collapses to an icon rail (~56px) with tooltips, every icon distinct', () => {
    mockPathname = '/';
    render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    const nav = screen.getByTestId('sidebar');
    expect(nav.getAttribute('data-rail')).toBe('true');
    expect(nav.className).toContain('w-14');
    // Every one of the nine destinations still has an accessible link.
    expect(screen.getAllByRole('link')).toHaveLength(9);
  });

  it('shows the Approvals badge in rail mode when approvalsCount > 0', () => {
    mockPathname = '/';
    render(<Sidebar approvalsCount={3} />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByText('3')).toBeTruthy();
  });
});
