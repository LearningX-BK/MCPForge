// @vitest-environment jsdom
//
// MCPForge — W0-J12: the Propose flow, the three diffs, and the eight change
// states (03 §6.1, §6.2, §6.5, §11.3).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CHANGE_STATES } from '@mcpforge/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChangeStateDetail } from './change-state-detail';
import { ProposeButton } from './propose-button';
import { ProposeDialog, NO_REMOTE_NOTE } from './propose-dialog';
import { ThreeDiffs } from './diff-view';
import { BranchChip, NO_REMOTE_LABEL } from '../shell';
import { TooltipProvider } from '../ui/tooltip';
import { ChangeHostProvider } from '@/lib/change-host';
import { fixtureDiff, fixtureProposal, stubHost } from './test-fixtures';

// No global auto-cleanup configured for this package's Vitest runner.
afterEach(cleanup);

function click(element: Element) {
  fireEvent.click(element);
}

describe('ProposeButton — the only path to a change proposal, diff first (03 §6.2)', () => {
  it('loads the diff through the ChangeHost before the dialog can open', async () => {
    const diff = vi.fn(() => Promise.resolve(fixtureDiff()));
    const host = { ...stubHost(), diff };
    render(<ProposeButton proposal={fixtureProposal()} host={host} />);

    expect(screen.queryByTestId('propose-dialog')).toBeNull();
    click(screen.getByRole('button', { name: 'Propose' }));

    await waitFor(() => expect(screen.getByTestId('propose-dialog')).toBeTruthy());
    expect(diff).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('three-diffs')).toBeTruthy();
  });

  it('proposes through the interface and reports the updated proposal', async () => {
    const onProposed = vi.fn();
    const host = stubHost();
    render(<ProposeButton proposal={fixtureProposal()} host={host} onProposed={onProposed} />);
    click(screen.getByRole('button', { name: 'Propose' }));
    await waitFor(() => expect(screen.getByTestId('propose-dialog')).toBeTruthy());

    const buttons = screen.getAllByRole('button', { name: 'Propose' });
    click(buttons[buttons.length - 1] as Element);

    await waitFor(() => expect(onProposed).toHaveBeenCalledTimes(1));
    expect(onProposed.mock.calls[0]?.[0]).toMatchObject({ state: 'in_review' });
  });

  it('a failure names an action, never a dead end (non-negotiable 5)', async () => {
    render(<ProposeButton proposal={fixtureProposal()} host={stubHost({ failDiff: true })} />);
    click(screen.getByRole('button', { name: 'Propose' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent ?? '').toContain('Propose again');
    expect((alert.textContent ?? '').toLowerCase()).not.toContain('try again');
    expect(screen.queryByTestId('propose-dialog')).toBeNull();
  });
});

describe('The three diffs (03 §6.5)', () => {
  it('renders all three together', () => {
    render(<ThreeDiffs diff={fixtureDiff()} />);
    expect(screen.getByTestId('diff-manifest')).toBeTruthy();
    expect(screen.getByTestId('diff-generated-toggle')).toBeTruthy();
    expect(screen.getByTestId('diff-role-scope')).toBeTruthy();
  });

  it('the generated diff is collapsed by default but present', () => {
    render(<ThreeDiffs diff={fixtureDiff()} />);
    const toggle = screen.getByTestId('diff-generated-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('diff-generated-panel')?.hasAttribute('hidden')).toBe(true);
    click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('generated/tools/jde.ap.voucher.create/schema.json')).toBeTruthy();
  });

  it('the compiled role scope diff has no disclosure control at all — never collapsed', () => {
    render(<ThreeDiffs diff={fixtureDiff()} />);
    const section = screen.getByTestId('diff-role-scope');
    expect(section.querySelectorAll('[aria-expanded]')).toHaveLength(0);
    expect(screen.getByTestId('role-scope-p2p').textContent).toContain('jde.ap.voucher.create');
  });

  it('the manifest diff is expanded — no toggle stands between the reviewer and it', () => {
    render(<ThreeDiffs diff={fixtureDiff()} />);
    const section = screen.getByTestId('diff-manifest');
    expect(section.querySelectorAll('[aria-expanded]')).toHaveLength(0);
    expect(screen.getByText('manifests/jde/ap/voucher.create.tool.yaml')).toBeTruthy();
  });

  it('an empty role scope says so rather than disappearing', () => {
    render(<ThreeDiffs diff={{ ...fixtureDiff(), roleScope: [] }} />);
    expect(screen.getByTestId('diff-role-scope').textContent).toContain('No role scope changes');
  });
});

describe('No remote configured (03 §11.3)', () => {
  it('the Propose dialog carries the exact note', () => {
    render(
      <ProposeDialog
        open
        onOpenChange={() => {}}
        proposal={fixtureProposal()}
        diff={fixtureDiff()}
        remote={{ configured: false }}
        onPropose={() => {}}
      />,
    );
    expect(screen.getByTestId('no-remote-note').textContent).toBe(NO_REMOTE_NOTE);
    expect(screen.queryByTestId('review-link')).toBeNull();
  });

  it('with a remote and a review url the note disappears and the link takes its place', () => {
    render(
      <ProposeDialog
        open
        onOpenChange={() => {}}
        proposal={fixtureProposal({ url: 'https://example.invalid/change/1' })}
        diff={fixtureDiff()}
        remote={{ configured: true, name: 'origin' }}
        onPropose={() => {}}
      />,
    );
    expect(screen.queryByTestId('no-remote-note')).toBeNull();
    expect(screen.getByTestId('review-link').textContent).toContain(
      'https://example.invalid/change/1',
    );
  });

  it('the branch chip reads "local only — no remote configured" from ChangeHost data', async () => {
    render(
      <TooltipProvider>
        <ChangeHostProvider host={stubHost()}>
          <BranchChip />
        </ChangeHostProvider>
      </TooltipProvider>,
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText(
          `Previewing definitional data on branch forge/W0-J12-add-create. Remote: ${NO_REMOTE_LABEL}.`,
        ),
      ).toBeTruthy(),
    );
  });

  it('the branch chip takes the branch from the host, not from a hard-coded default', async () => {
    render(
      <TooltipProvider>
        <ChangeHostProvider host={stubHost()}>
          <BranchChip />
        </ChangeHostProvider>
      </TooltipProvider>,
    );
    await waitFor(() => expect(screen.getByText('forge/W0-J12-add-create')).toBeTruthy());
  });
});

describe('The eight change states render distinctly (03 §6.1)', () => {
  it('every state produces a distinct label and a distinct meaning', () => {
    const labels = new Set<string>();
    const meanings = new Set<string>();
    for (const state of CHANGE_STATES) {
      const { unmount } = render(<ChangeStateDetail state={state} />);
      const node = screen.getByTestId(`change-state-${state}`);
      const chip = node.querySelector('span[aria-label]');
      labels.add(chip?.textContent ?? '');
      meanings.add(node.querySelector('p')?.textContent ?? '');
      unmount();
    }
    expect(labels.size).toBe(CHANGE_STATES.length);
    expect(meanings.size).toBe(CHANGE_STATES.length);
  });

  it('MERGED and DEPLOYED are never conflated', () => {
    const { unmount } = render(<ChangeStateDetail state="merged" />);
    const merged = screen.getByTestId('change-state-merged').textContent ?? '';
    unmount();
    render(<ChangeStateDetail state="deployed" probeStatus="resolved" />);
    const deployed = screen.getByTestId('change-state-deployed').textContent ?? '';

    expect(merged).not.toBe(deployed);
    expect(merged.toLowerCase()).toContain('not yet in the running catalogue');
    expect(merged.toLowerCase()).not.toContain('deployed');
    expect(deployed).toContain('running catalogue artefact');
  });

  it('only DEPLOYED carries a probe status chip beside it', () => {
    const { unmount } = render(<ChangeStateDetail state="merged" probeStatus="resolved" />);
    expect(screen.getByTestId('change-state-merged').textContent).not.toContain('Resolved');
    unmount();
    render(<ChangeStateDetail state="deployed" probeStatus="resolved" />);
    expect(screen.getByTestId('change-state-deployed').textContent).toContain('Resolved');
  });

  it('INVALID names the failing rule and CHANGES REQUESTED names the reviewer', () => {
    const { unmount } = render(
      <ChangeStateDetail state="invalid" invalidRule="role-scope-token-budget" />,
    );
    expect(screen.getByTestId('change-state-invalid').textContent).toContain(
      'role-scope-token-budget',
    );
    unmount();
    render(<ChangeStateDetail state="changes_requested" reviewer="Ade" />);
    expect(screen.getByTestId('change-state-changes_requested').textContent).toContain('Ade');
  });

  it("VALIDATING's dot animates only under motion-safe (03 §6.1)", () => {
    render(<ChangeStateDetail state="validating" />);
    const dot = screen.getByTestId('validating-dot');
    expect(dot.className).toContain('motion-safe:animate-pulse');
    expect(dot.className).not.toContain(' animate-pulse');
  });

  it('every state says where it lives, so a user knows who changes it next', () => {
    render(<ChangeStateDetail state="validating" />);
    expect(screen.getByTestId('change-state-validating').textContent).toContain('CI');
  });
});
