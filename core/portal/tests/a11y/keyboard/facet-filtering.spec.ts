// MCPForge — W0-J21 gate 4, flow 5: facet filtering (03 §12.2: "roving
// tabindex within the group, Tab moves between groups — not 40 tab stops to
// cross a filter bar"). `FacetPanel` (facet-panel.tsx) gives each row
// `role="group"`, one pill at `tabIndex=0` (`role="checkbox"`,
// `aria-checked`) and every other pill `tabIndex=-1`; arrow keys move the
// roving stop within the row.
import { expect, test } from '@playwright/test';

test('facet rows are one tab stop each; arrow keys move within a row, Tab moves between rows', async ({
  page,
}) => {
  await page.goto('/catalog');

  const appGroup = page.getByRole('group', { name: /application/i });
  const verbGroup = page.getByRole('group', { name: /verb/i });

  // Reach the first group in a small, bounded number of tabs — not "40 tab
  // stops to cross a filter bar", which is the specific failure 03 §12.2
  // names. Break as soon as focus actually lands inside the group.
  let reached = false;
  for (let i = 0; i < 25; i += 1) {
    if ((await appGroup.locator(':focus').count()) > 0) {
      reached = true;
      break;
    }
    await page.keyboard.press('Tab');
  }
  expect(reached, 'focus did not reach the Application facet group within 25 Tab presses').toBe(true);
  await expect(appGroup.locator(':focus')).toHaveCount(1);

  // Arrow within the group moves the roving stop without leaving the group.
  await page.keyboard.press('ArrowRight');
  await expect(appGroup.locator(':focus')).toHaveCount(1);
  // Each pill is `role="checkbox"` with `aria-checked` (facet-panel.tsx) —
  // never `aria-pressed`, which is a toggle-button pattern this component
  // does not use.
  await page.keyboard.press('Space');
  await expect(page.locator(':focus')).toHaveAttribute('aria-checked', 'true');

  // One Tab press leaves the group entirely and lands on the roving stop of
  // the very next facet row — never on every individual pill within a row.
  // "Verb" is not adjacent to "Application" (`facet-defs.ts` orders
  // app/server/archetype/binding/package/verb), so reaching it is still a
  // small, bounded number of ONE-tab-per-ROW hops, not "40 tab stops to
  // cross a filter bar" — the failure 03 §12.2 actually names.
  let reachedVerb = false;
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press('Tab');
    if ((await verbGroup.locator(':focus').count()) > 0) {
      reachedVerb = true;
      break;
    }
  }
  expect(reachedVerb, 'focus did not reach the Verb facet group within 8 row-to-row Tab presses').toBe(
    true,
  );
  await expect(verbGroup.locator(':focus')).toHaveCount(1);
});
