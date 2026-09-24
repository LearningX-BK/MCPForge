// @vitest-environment jsdom
//
// MCPForge — W0-J12: accessibility for the change flow (03 §12.7's threshold:
// zero `serious`/`critical` axe violations; `vitest-axe` substitutes for the
// doc-named `jest-axe`, same rationale as `../ui/a11y.test.tsx`).
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { CHANGE_STATES } from '@mcpforge/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { ChangeStateDetail } from './change-state-detail';
import { ProposeDialog } from './propose-dialog';
import { ThreeDiffs } from './diff-view';
import { fixtureDiff, fixtureProposal } from './test-fixtures';

// No global auto-cleanup configured for this package's Vitest runner.
afterEach(cleanup);

interface AxeResult {
  violations: { id: string; impact?: string | null }[];
}

async function serious(container: Element): Promise<string[]> {
  const results = (await axe(container)) as unknown as AxeResult;
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => violation.id);
}

describe('change flow — zero serious/critical axe violations', () => {
  it('ThreeDiffs', async () => {
    const { container } = render(<ThreeDiffs diff={fixtureDiff()} />);
    expect(await serious(container)).toEqual([]);
  });

  it('ChangeStateDetail, every state', async () => {
    for (const state of CHANGE_STATES) {
      const { container, unmount } = render(<ChangeStateDetail state={state} />);
      expect(await serious(container)).toEqual([]);
      unmount();
    }
  });

  it('ProposeDialog', async () => {
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
    const dialog = await screen.findByRole('dialog');
    expect(await serious(dialog)).toEqual([]);
  });

  it('the dialog is a labelled, described dialog and the description textarea has a label', async () => {
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
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('What changed, and why')).toBeTruthy());
  });

  it('every diff patch block carries its own accessible name', () => {
    render(<ThreeDiffs diff={fixtureDiff()} />);
    expect(
      screen.getByLabelText('Diff for manifests/jde/ap/voucher.create.tool.yaml'),
    ).toBeTruthy();
  });
});
