// MCPForge — W0-J21 gate 3 (03 §12.7 row 3): `@axe-core/playwright` on
// every route, in both themes. Fails on any violation — this suite is not
// allowed to only check `serious`/`critical` the way the component-level
// vitest-axe gate does; 03 §12.7's row for this gate says "any violation".
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { ROUTES } from './routes';

const THEMES = ['light', 'dark'] as const;

for (const route of ROUTES) {
  for (const theme of THEMES) {
    test(`${route} — axe, ${theme} theme`, async ({ page }) => {
      // Stamp the theme the same way a real explicit choice does (topbar.tsx
      // writes `mcpforge-theme` to localStorage; theme-init.ts reads it
      // before paint and sets `data-theme` on <html>). Setting it via
      // addInitScript rather than after navigation means the very first
      // paint is already in the target theme — no flash, and no risk of an
      // axe run racing a theme-driven re-render.
      await page.addInitScript((t) => {
        window.localStorage.setItem('mcpforge-theme', t);
      }, theme);

      const response = await page.goto(route);
      expect(response?.ok(), `${route} did not respond 2xx`).toBeTruthy();

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });
  }
}
