// MCPForge — W0-Q5: ask -> submit -> request detail, keyboard-only (03 §12.2),
// through the real ChangeHost. The request lands as a file on its own branch in
// the change host's sandbox; nothing is written to the working tree.
import { expect, test } from '@playwright/test';
import { e2eCredentials, signIn } from './sign-in';

test('an ask is submitted as a tracked request and opens on its detail page, by keyboard', async ({
  page,
}) => {
  test.setTimeout(240_000);
  // Submit is gated on a signed-in human (W0-P5b, non-negotiable 6), so the full
  // leg needs a running gateway and a local user. Provide MCPFORGE_E2E_USERNAME /
  // MCPFORGE_E2E_PASSWORD (and MCPFORGE_E2E_TOTP) to run it; without them the test
  // proves the ask, the real verdict, the form, and that an unauthenticated Submit
  // is REFUSED with a `next`, which is the gate doing its job.
  const signedIn = e2eCredentials() !== undefined;
  if (signedIn) await signIn(page, '/requests');
  await page.goto('/requests');

  const type = async (label: RegExp, value: string) => {
    await page.getByLabel(label).focus();
    await page.keyboard.type(value);
  };

  await type(/^ask$/i, 'schedule robot firmware maintenance windows');
  // Nothing in the catalogue matches: the real ranker says "new".
  await expect(page.getByText(/No match found/)).toBeVisible();
  await type(/what should it do/i, 'Schedule firmware maintenance windows for robots');
  await type(/^app$/i, 'plant');
  await type(/^module$/i, 'maint');
  await page.getByRole('button', { name: 'Submit request' }).focus();
  await page.keyboard.press('Enter');

  if (!signedIn) {
    const alert = page.getByRole('form', { name: 'Submit as a request' }).getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 45000 });
    await expect(alert).toContainText(/sign/i);
    return;
  }

  await expect(page.getByTestId('request-submitted')).toBeVisible({ timeout: 90000 });
  const link = page.getByRole('link', { name: /^Open req-/ });
  await link.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('request-state')).toHaveText('Submitted', { timeout: 45000 });
  await expect(page.getByText('Schedule firmware maintenance windows for robots')).toBeVisible();
  await expect(page.getByTestId('not-triaged')).toBeVisible();
});
