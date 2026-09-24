// MCPForge — W0-J21 gate 4, flow 4: palette search (03 §12.2, §9.2's
// grammar). `CommandPalette` (command-palette.tsx) opens on `⌘K`, is
// `role="dialog"` with `aria-label="Command palette"`, its input is
// `aria-label="Search tools, drafts and pages"` (rendered by cmdk as
// `role="combobox"`, not `textbox`), and it must return focus to the
// trigger on close (03 §12.2's explicit requirement for this flow).
//
// Composed globally (W0-J22) via `components/shell/app-chrome.tsx`, mounted
// once in `app/layout.tsx` around every route: Topbar's trigger, this
// dialog, and the ⌘K/Ctrl+K shortcut, backed by a fixture `FindClient`
// (`components/palette/find-fixture.ts`) — see that file's own header for
// why it is a fixture, not `/api/find`. Exercised here against `/home`
// specifically, but the wiring is identical on every route.
import { expect, test } from '@playwright/test';

test('the command palette opens, filters, activates a result and returns focus on close', async ({
  page,
}) => {
  await page.goto('/home');

  const trigger = page.getByRole('button', { name: /search|palette/i }).first();
  // Under heavy `--workers` fan-out on a shared dev server (the same
  // known compile-queue variance `playwright.config.ts`'s own header
  // documents), the route can render before `HomePalette`'s `⌘K` listener
  // effect has attached — wait for the trigger to be genuinely interactive
  // first, same reasoning as the widened compile/git waits in
  // `role-edit.spec.ts`.
  await expect(trigger).toBeEnabled();
  await trigger.focus();
  await page.keyboard.press('Meta+k').catch(() => page.keyboard.press('Control+k'));

  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await expect(dialog).toBeVisible({ timeout: 15000 });
  // cmdk's own `CommandInput` renders its `<input>` as `role="combobox"`
  // (an editable combobox pattern — arrow keys move a listbox highlight
  // without leaving the input), not the plain `role="textbox"` the file's
  // own header once assumed; the accessible NAME is still exactly
  // "Search tools, drafts and pages" (`command-palette.tsx`'s `aria-label`).
  await expect(page.getByRole('combobox', { name: 'Search tools, drafts and pages' })).toBeFocused();

  await page.keyboard.type('voucher create');
  // Arrow down moves the cmdk highlight without leaving the input (a
  // combobox pattern) — Enter then activates the highlighted result.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  await expect(dialog).toBeHidden();

  // Escape-close path returns focus to the trigger (03 §12.2).
  await page.keyboard.press('Meta+k').catch(() => page.keyboard.press('Control+k'));
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible({ timeout: 15000 });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});
