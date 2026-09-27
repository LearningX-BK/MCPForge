// MCPForge — W0-J21 gate 4, flow 2: approve (03 §12.2's "approver's decision
// panel — approve, decline, and the decline-reason field").
// `ApproverDecisionPanel` labels its region
// `aria-label="Approval decision for <toolId>"` and its outcome on
// `role="status"` (approver-decision-panel.tsx).
//
// W0-P5b: this run has no gateway and so nobody signed in, and a decision
// carries the signed-in viewer's name (W0-P4 §3), never an invented one. So the
// outcome a keyboard user is told about is the refusal, on `role="alert"`, and
// the approval stays pending. The keyboard path being proved is unchanged. The
// signed-in outcome ("Approved by <you>") is covered by
// src/app/approvals/[approvalId]/approval-decision.test.tsx.
import { expect, test } from '@playwright/test';

test('an approval is decidable — approve, decline, and the reason field — without a mouse', async ({
  page,
}) => {
  await page.goto('/approvals');

  // The queue's runtime rows are whole-row links (approval-queue-list.tsx) —
  // their accessible name is the row's own content, not a "Review" label —
  // so target the first runtime row's link directly rather than by name.
  const firstRuntimeRow = page.locator('[data-testid="approval-row"][data-kind="runtime"]').first();
  await firstRuntimeRow.getByRole('link').focus();
  await page.keyboard.press('Enter');

  const panel = page.getByRole('region', { name: /approval decision for/i });
  await expect(panel).toBeVisible();

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
  await expect(page.getByRole('alert')).toContainText(/not signed in/i);
  await expect(panel).toHaveAttribute('data-approval-state', 'pending');

  // Approve path on a second, still-pending item.
  await page.goto('/approvals');
  const runtimeRows = page.locator('[data-testid="approval-row"][data-kind="runtime"]');
  await runtimeRows.nth(1).getByRole('link').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /^approve$/i }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText(/sign in, then decide this approval/i);
});
