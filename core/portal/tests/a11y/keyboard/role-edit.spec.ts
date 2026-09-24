// MCPForge — W0-J21 gate 4, flow 6: role edit (03 §12.2 keyboard rules,
// applied to W0-J18's Governance role editor). `RoleEditor`
// (governance/_components/role-editor.tsx) labels the glob source
// `aria-label="YAML source for role <id>"`, the compiled scope is a
// `role-labelledby`'d section rather than a hidden diff, and any
// out-of-budget or SoD state renders on `role="alert"`.
//
// `/governance` IS the Roles page (`gov-nav.tsx`: five REAL, independently
// linkable routes with `aria-current`, deliberately not a `role="tablist"` —
// "same reasoning as `environments/_components/env-nav.tsx`"), so there is
// no tab to switch to — the nav's own entry is a plain link.
import { expect, test } from '@playwright/test';

test('editing role globs and producing a change proposal is completable without a mouse', async ({
  page,
}) => {
  // The real compile (a sandboxed `forge codegen` run) and the real
  // `ChangeHost` (real `git` subprocesses, including a one-time sandbox
  // seed on first use per server process) both run live in this flow — see
  // the waits below. Wider than the file's own default so those two real
  // round trips are never mistaken for a hang.
  test.setTimeout(240_000);
  await page.goto('/governance');

  await expect(page.getByRole('link', { name: /^roles$/i })).toBeVisible();

  const source = page.getByLabel(/yaml source for role/i);
  await source.focus();
  // Editing by keyboard only: move to end, type an additional glob line.
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n  - jde.gl.*.get');

  // The compiled scope panel is live and reachable by Tab, not only by
  // mouse-scrolling a diff view (03 §5.3 Governance / 02 §8.1 item 4).
  await page.keyboard.press('Tab');
  const compiledSection = page.locator('section[aria-labelledby="compiled-scope-heading"]');
  await expect(compiledSection).toBeVisible();

  // The compile is real (a sandboxed `forge codegen` run, `compile-role.ts`'s
  // own header), not instant — `Save draft` stays disabled (`canProposeEdit`
  // requires a clean compile) until it resolves. Wait for that here, rather
  // than assuming the debounce+round-trip has already finished by the time
  // the earlier keyboard actions above land, the way a real keyboard-only
  // user would (watching the pane settle before reaching for Save draft).
  // Wide timeout: this is also routinely the FIRST Server Action call of the
  // whole test run, and Next.js dev mode compiles a Server Action route
  // on-demand on its first invocation — a real, one-time cold-start cost
  // (`playwright.config.ts`'s own header names this class of dev-server
  // compile-queue delay), not a hang.
  await expect(page.getByTestId('save-draft')).toBeEnabled({ timeout: 45000 });

  // Nothing saves directly — the terminal action produces a change
  // proposal (CLAUDE.md §1 "Save draft · Propose · Discard"): Save draft
  // first (the only outward action available before a draft exists),
  // which reveals the Propose control.
  await page.getByTestId('save-draft').focus();
  await page.keyboard.press('Enter');
  // `onSaveDraft()` fires the FIRST real `ChangeHost` call of the flow —
  // often the one that seeds the persistent sandbox working tree (`git
  // init` + `git add` across the whole copied repo, one time per server
  // process) — same cold-start reasoning as the widened waits below.
  await expect(page.getByTestId('role-editor-status')).toContainText(/draft saved/i, {
    timeout: 45000,
  });

  // Propose opens the required diff-first dialog (03 §6.2); its own
  // footer button, also labelled "Propose", fires the real proposal. Its
  // trigger loads the diff through the real `ChangeHost` first (a `git
  // diff` subprocess against the sandboxed working tree, `ProposeButton`'s
  // own `openWithDiff()`) and disables itself meanwhile — wait for that
  // round trip rather than assuming it is instant, same reasoning as the
  // Save draft wait above.
  const proposeTrigger = page.getByRole('button', { name: /^propose$/i });
  await expect(proposeTrigger).toBeEnabled({ timeout: 20000 });
  await proposeTrigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  // `openWithDiff()` also seeds the change-host's one persistent sandbox
  // working tree on its very first use per server process (a `git init` +
  // `git add` across the whole copied repo) — a real, one-time cold-start
  // cost this wait must survive, not a hang.
  await expect(dialog).toBeVisible({ timeout: 45000 });
  await dialog.getByRole('button', { name: /^propose$/i }).focus();
  await page.keyboard.press('Enter');

  // `propose()` is a third real `ChangeHost` round trip (another `git`
  // subprocess) — same reasoning as the two waits above.
  await expect(page.getByTestId('role-editor-status')).toContainText(/proposed|change/i, {
    timeout: 20000,
  });
});
