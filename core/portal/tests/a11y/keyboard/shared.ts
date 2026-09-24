// MCPForge — W0-J21 gate 4 shared helpers. 03 §12.7 row 4: "any step
// unreachable" fails the gate — these specs never fall back to `page.click`
// or `page.fill`; every interaction is `Tab` / `Shift+Tab` / arrow keys /
// `Enter` / `Escape` / typed text into whatever element already has focus,
// exactly as a keyboard-only user (or NVDA in browse/forms mode) would work
// the page.
import { expect, type Page } from '@playwright/test';

/** Tab forward until an element matching `locator` is the active element, or fail after `maxTabs`. */
export async function tabUntilFocused(
  page: Page,
  locator: { toString(): string },
  maxTabs = 40,
): Promise<void> {
  for (let i = 0; i < maxTabs; i += 1) {
    const activeMatches = await page.evaluate((sel) => {
      const active = document.activeElement;
      if (!active) return false;
      return active.matches(sel as string);
    }, locator.toString());
    if (activeMatches) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Could not reach ${locator.toString()} within ${maxTabs} Tab presses.`);
}

export async function expectFocusRingVisible(page: Page): Promise<void> {
  // 03 §12.2: 2px --focus-ring, 2px offset, never removed. Checked as an
  // outline present on the active element rather than a specific colour —
  // colour correctness in both themes is the token-contrast gate's job.
  const outline = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return null;
    return getComputedStyle(active).outlineStyle;
  });
  expect(outline).not.toBe('none');
}
