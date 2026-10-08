// MCPForge — W0-J21 gate 4: the signed-in leg shared by the specs that need a
// human (approve, role-edit). Same form flow as new-server.spec.ts. Credentials
// come from MCPFORGE_E2E_USERNAME / MCPFORGE_E2E_PASSWORD (playwright.config.ts
// sets them for its own throwaway gateway); without them the caller skips and
// says why, rather than passing on a refusal it did not mean to prove.
import type { Page } from '@playwright/test';

export function e2eCredentials(): { username: string; password: string } | undefined {
  const username = process.env['MCPFORGE_E2E_USERNAME'];
  const password = process.env['MCPFORGE_E2E_PASSWORD'];
  return username !== undefined && password !== undefined ? { username, password } : undefined;
}

export const NO_SIGN_IN_REASON =
  'needs a signed-in human and a gateway: set MCPFORGE_E2E_USERNAME/PASSWORD, or run where .mcpforge/portal/portal-local.private.jwk.json exists so playwright.config.ts starts its own';

export async function signIn(page: Page, returnTo: string): Promise<void> {
  const creds = e2eCredentials();
  if (creds === undefined) throw new Error(NO_SIGN_IN_REASON);
  await page.goto(`/sign-in?returnTo=${returnTo}`);
  await page.getByLabel(/^username/i).fill(creds.username);
  await page.getByLabel(/^password/i).fill(creds.password);
  const totp = process.env['MCPFORGE_E2E_TOTP'];
  if (totp !== undefined) await page.getByLabel(/code/i).fill(totp);
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 60000 });
}
