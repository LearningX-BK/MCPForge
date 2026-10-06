// MCPForge — W0-Q3: drives "New module server" from the Build landing page,
// keyboard-only (03 §12.2), through the real `ChangeHost`: fill the form, see the
// split rule and a duplicate-boundary warning, run the real `forge validate`,
// Save draft, Propose. Nothing is written to the working tree: the manifest lands
// on a branch in the change host's own sandbox.
import { expect, test } from '@playwright/test';

test('a new module server is drafted and proposed from the Build landing page, by keyboard', async ({
  page,
}) => {
  // Real validate (a sandbox copy of the repo) and real git subprocesses; the
  // first Server Action and the first ChangeHost call each pay a dev-server
  // compile / sandbox-seed cost (see role-edit.spec.ts for the same reasoning).
  test.setTimeout(240_000);
  // Save draft and Propose are gated on a signed-in human (W0-P5b, non-negotiable 6),
  // so the full write leg needs a running gateway and a local user. Provide
  // MCPFORGE_E2E_USERNAME / MCPFORGE_E2E_PASSWORD (and MCPFORGE_E2E_TOTP if the user
  // has one) to run it; without them the test still proves the form, the split rule,
  // the duplicate warning and the real validate, and that an unauthenticated Save
  // draft is REFUSED with a `next`, which is the gate doing its job.
  const username = process.env['MCPFORGE_E2E_USERNAME'];
  const password = process.env['MCPFORGE_E2E_PASSWORD'];
  const signedIn = username !== undefined && password !== undefined;
  if (signedIn) {
    await page.goto('/sign-in?returnTo=/build');
    await page.getByLabel(/^username/i).fill(username);
    await page.getByLabel(/^password/i).fill(password);
    const totp = process.env['MCPFORGE_E2E_TOTP'];
    if (totp !== undefined) await page.getByLabel(/code/i).fill(totp);
    await page.keyboard.press('Enter');
  }
  await page.goto('/build');

  const entry = page.getByRole('link', { name: /new module server/i });
  await expect(entry).toBeVisible();
  await entry.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: /new module server/i })).toBeVisible({
    timeout: 45000,
  });
  await expect(page.getByTestId('split-rule')).toContainText('15–20 tools');

  const type = async (label: RegExp, value: string) => {
    await page.getByLabel(label).focus();
    await page.keyboard.type(value);
  };
  await type(/^server id$/i, 'jde-hr-pay');
  await type(/^label$/i, 'JD Edwards — Payroll');
  await type(/^app$/i, 'jde');
  // `fin` is already served by jde-fin-ap and jde-fin-gl: the duplicate-boundary warning.
  await type(/^module$/i, 'fin');
  await expect(page.getByTestId('boundary-warnings')).toContainText(/already serves jde · fin/i);
  await page.getByLabel(/^module$/i).focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('hr');
  await expect(page.getByTestId('boundary-clear')).toBeVisible();
  await page.getByLabel(/^version$/i).focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('1.0.0');
  await type(/^owning team$/i, 'HR Engineering');
  await type(/^steward/i, 'A. Person');

  await expect(page.getByTestId('server-yaml')).toContainText('id: jde-hr-pay');

  // The real `forge validate`, on a sandbox copy with this manifest added.
  await page.getByTestId('run-checks-button').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('checks-verdict')).toContainText(/no failures in this manifest/i, {
    timeout: 90000,
  });

  await page.getByTestId('save-draft').focus();
  await page.keyboard.press('Enter');
  if (!signedIn) {
    await expect(page.getByTestId('save-error')).toContainText(/not signed in/i, {
      timeout: 60000,
    });
    await expect(page.getByTestId('save-error')).toContainText(/next:/i);
    await expect(page.getByTestId('draft-editor-status')).toHaveCount(0);
    return;
  }
  await expect(page.getByTestId('draft-editor-status')).toContainText(
    /draft saved on forge\/build-server-jde-hr-pay/i,
    {
      timeout: 60000,
    },
  );

  const proposeTrigger = page.getByRole('button', { name: /^propose$/i });
  await expect(proposeTrigger).toBeEnabled({ timeout: 30000 });
  await proposeTrigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 45000 });
  await dialog.getByRole('button', { name: /^propose$/i }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('draft-editor-status')).toContainText(/in review/i, {
    timeout: 30000,
  });
});
