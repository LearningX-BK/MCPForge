// MCPForge — W0-J21 gate 4, flow 2: approve (03 §12.2's "approver's decision
// panel — approve, decline, and the decline-reason field").
// `ApproverDecisionPanel` labels its region
// `aria-label="Approval decision for <toolId>"` and its outcome on
// `role="status"` (approver-decision-panel.tsx).
//
// W0-P3b/P5b: the queue reads runtime approvals live from the gateway as the
// signed-in viewer, and a decision carries that viewer's name (W0-P4 §3). So this
// spec signs in against the real local gateway (e2e-gateway.ts) which holds two
// pending approvals raised by a different human, and proves the keyboard path
// through to the recorded outcome. It skips, saying why, where no gateway exists.
import { expect, test } from '@playwright/test';
import { e2eCredentials, NO_SIGN_IN_REASON, signIn } from './sign-in';

test('an approval is decidable — approve, decline, and the reason field — without a mouse', async ({
  page,
}) => {
  test.skip(e2eCredentials() === undefined, NO_SIGN_IN_REASON);
  test.setTimeout(240_000);
  await signIn(page, '/approvals');
  await page.goto('/approvals');

  // The queue's runtime rows are whole-row links (approval-queue-list.tsx) —
  // their accessible name is the row's own content, not a "Review" label —
  // so target the first runtime row's link directly rather than by name.
  const firstRuntimeRow = page.locator('[data-testid="approval-row"][data-kind="runtime"]').first();
  await firstRuntimeRow.getByRole('link').focus();
  await page.keyboard.press('Enter');

  const panel = page.getByRole('region', { name: /approval decision for/i });
  // First hit on the dynamic detail route: dev-server compile plus a live gateway read.
  await expect(panel).toBeVisible({ timeout: 60000 });

  // Decline requires a reason FIRST — the button carries a real `disabled`
  // attribute until a non-blank reason is typed (approver-decision-panel.tsx
  // security note 2), so the keyboard path is: reach the reason field, type
  // into it, THEN tab to the now-enabled Decline button and activate it.
  const reason = page.getByRole('textbox', { name: /reason/i });
  await reason.focus();
  await page.keyboard.type('Amount exceeds delegated authority.');
  await page.getByRole('button', { name: /decline/i }).focus();
  await expect(page.locator(':focus')).toHaveAttribute('data-testid', 'approver-decline');
  await page.keyboard.press('Enter');
  // Signed in as a human who is NOT the requester, so the decision is recorded.
  await expect(
    page.getByRole('status').filter({ hasText: /your decision is recorded/i }),
  ).toContainText(/^declined\./i, {
    timeout: 30000,
  });

  // Approve path on the other, still-pending item (the declined one has left the queue).
  await page.goto('/approvals');
  const runtimeRows = page.locator('[data-testid="approval-row"][data-kind="runtime"]');
  await runtimeRows.first().getByRole('link').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /^approve$/i }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('status').filter({ hasText: /your decision is recorded/i }),
  ).toContainText(/^approved\./i, {
    timeout: 30000,
  });
});
