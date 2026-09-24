// @vitest-environment jsdom
//
// W0-J6 — change tray (03 §6.3): hidden entirely at zero, a single pill
// otherwise, "Propose all" batches, and CLAUDE.md's vocabulary rule (never
// "Save"/"commit"/"push" in UI copy).
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChangeTray } from './change-tray';

afterEach(cleanup);

describe('ChangeTray (03 §6.3)', () => {
  it('is hidden entirely at zero', () => {
    render(<ChangeTray items={[]} />);
    expect(screen.queryByTestId('change-tray')).toBeNull();
  });

  it('collapses to a single pill by default, e.g. "3 changes"', () => {
    render(
      <ChangeTray
        items={[
          { id: '1', label: 'ebs.p2p.invoice.create', state: 'draft' },
          { id: '2', label: 'p2p role widen', state: 'draft' },
          { id: '3', label: 'requests copy fix', state: 'draft' },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: /3 uncommitted changes/i })).toBeTruthy();
    expect(screen.queryByText('Propose all')).toBeNull();
  });

  it('expanding shows the list with per-item actions and one "Propose all"', () => {
    const onProposeAll = vi.fn();
    render(
      <ChangeTray
        items={[{ id: '1', label: 'ebs.p2p.invoice.create', state: 'draft' }]}
        onProposeAll={onProposeAll}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /1 uncommitted change\./i }));
    expect(screen.getByText('ebs.p2p.invoice.create')).toBeTruthy();
    const proposeAll = screen.getByRole('button', { name: 'Propose all' });
    fireEvent.click(proposeAll);
    expect(onProposeAll).toHaveBeenCalledOnce();
  });

  it('never uses Save/commit/push vocabulary', () => {
    const { container } = render(
      <ChangeTray items={[{ id: '1', label: 'draft one', state: 'draft' }]} />,
    );
    fireEvent.click(screen.getByRole('button'));
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\bSave\b/);
    expect(text).not.toMatch(/\bcommit\b/i);
    expect(text).not.toMatch(/\bpush\b/i);
  });
});
