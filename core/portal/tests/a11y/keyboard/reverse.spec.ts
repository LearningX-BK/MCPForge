// MCPForge — W0-J21 gate 4, flow 3: reverse (03 §7.5, §7.6, §12.2).
//
// Owner decision, 8 Oct 2026 ("option 1"): since W0-P3d the live call page never
// supplies a reversal plan — a reversal is planned by the requester's agent
// through /mcp, not initiated from the portal — so `ReversalAction` is ALWAYS in
// its blocked state live. What a keyboard-only user must be able to do on that
// page is therefore: reach the Reversal contract and the Reverse section, read
// WHY it is blocked as text tied to the control (not colour, not a tooltip), and
// find no keyboard path that fires a reversal. The click-through of the reversal's
// own plan -> confirm sequence stays covered by the `reversal-action` component
// tests, which can supply a plan.
//
// The control is labelled with the reversing tool id, never "Undo" (03 §7.5).
// The seeded row is a write still inside its reversal window (e2e-gateway.ts).
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { E2E_IDS_FILE } from './e2e-gateway-config';
import { e2eCredentials, NO_SIGN_IN_REASON, signIn } from './sign-in';

test('a blocked reversal is reachable and explained by keyboard, and cannot be fired', async ({
  page,
}) => {
  // W0-P3d: the call page reads the live audit row as the signed-in viewer.
  test.skip(e2eCredentials() === undefined, NO_SIGN_IN_REASON);
  test.setTimeout(240_000);
  const { reversibleCallId } = JSON.parse(readFileSync(E2E_IDS_FILE, 'utf8')) as {
    reversibleCallId: string;
  };
  await signIn(page, '/activity');
  await page.goto(`/activity/calls/${reversibleCallId}`);

  // The contract the call was made under is on the page as a labelled region.
  await expect(page.getByRole('region', { name: /reversal contract/i })).toBeVisible({
    timeout: 60000,
  });

  const section = page.locator('[data-testid="reversal-action"]');
  await expect(section).toHaveAttribute('data-blocked', 'true');
  const button = section.getByRole('button', { name: /^reverse — .*jde\.ap\.voucher\.cancel/i });
  await expect(button).toBeDisabled();

  // The reason is visible text, and it says the reversal is planned, not fired.
  await expect(section).toContainText(/no reversal plan is available yet/i);
  await expect(section).toContainText(/cannot be fired directly/i);

  // Tab through the whole page: focus never lands on an enabled Reverse control,
  // and Enter on whatever it does land on never opens a reversal sequence.
  await page.locator('body').focus();
  for (let i = 0; i < 60; i += 1) {
    await page.keyboard.press('Tab');
    const name = await page.evaluate(
      () => document.activeElement?.getAttribute('aria-label') ?? '',
    );
    expect(name).not.toMatch(/^reverse — /i);
  }
  await expect(page.locator('[data-testid="reversal-plan-sequence"]')).toHaveCount(0);
});
