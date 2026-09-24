// MCPForge — W0-J21 gate 4, flow 3: reverse (03 §7.5, §7.6, §12.2).
// `ReversalAction` (write-path/reversal-action.tsx) labels its own section
// `aria-label="Reverse this call"`; the actual button inside it is labelled
// with the reversing tool id (03 §7.5: "Reverse — cancel this voucher
// (jde.ap.voucher.cancel)"), never "Undo". `call_ex4402`
// (activity/fixtures.ts) is the one fixture call still within its reversal
// window, not yet reversed — the row `ReversalAction` renders as a live,
// actionable control.
import { expect, test } from '@playwright/test';

test('a reversible call can be reversed — plan, confirm — without a mouse', async ({ page }) => {
  await page.goto('/activity/calls/call_ex4402');

  const section = page.locator('[data-testid="reversal-action"]');
  await section.getByRole('button', { name: /^reverse/i }).focus();
  await page.keyboard.press('Enter');

  // A reversal is itself a write: it opens its OWN plan -> confirm sequence
  // (reversal-action.tsx security note 1), never firing directly.
  const sequence = page.locator('[data-testid="reversal-plan-sequence"]');
  await expect(sequence).toBeVisible();

  await page.getByRole('checkbox').first().focus();
  await page.keyboard.press('Space');
  await page.getByTestId('confirm-submit').focus();
  await expect(page.locator(':focus')).toHaveAttribute('type', 'button');
  await page.keyboard.press('Enter');
});
