// MCPForge — W0-J21 gate 4, flow 1: plan → confirm → execute (03 §12.2,
// §12.4). The one place in this portal that exercises the live write-path
// state machine end to end today is `SandboxRun`
// (`src/app/build/_components/sandbox-run.tsx`, W0-J14's "the sandbox run
// exercises the full plan/confirm path against mocks") — `/catalog/[toolId]`
// only has static Detail/Agent-view/Role-simulator tabs, no live execute.
// `draft-voucher-create` (`build/fixtures.ts`) is the write-tool draft this
// flow needs.
import { expect, test } from '@playwright/test';

test('a write tool is completable plan -> confirm -> execute without a mouse', async ({ page }) => {
  await page.goto('/build/draft-voucher-create');

  await page.getByTestId('sandbox-plan-button').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sandbox-status')).toContainText(/plan ready/i);

  // Confirm: the acknowledge checkbox (required — financial sensitivity),
  // then Tab to the confirm button, Enter to fire it, entirely by keyboard.
  await page.getByRole('checkbox').first().focus();
  await page.keyboard.press('Space');
  await page.getByTestId('confirm-submit').focus();
  await expect(page.locator(':focus')).toHaveAttribute('type', 'button');
  await page.keyboard.press('Enter');

  // Execute: a second explicit step in the sandbox (mirrors the real
  // ExecutionProgress -> ResultCard transition).
  await page.getByTestId('sandbox-execute-button').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sandbox-status')).toContainText(/executed/i);

  // Result keys are click-to-copy chips, themselves keyboard-operable.
  await expect(page.getByRole('button', { name: /copy/i }).first()).toBeVisible();
});
