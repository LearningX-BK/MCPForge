// @vitest-environment jsdom
//
// W0-J6 — the app shell: skip link is the first tab stop, the 3px
// top-of-viewport rule for local/prod (03 §11.1), and topbar chrome
// presence (env chip, branch chip, persona pill, density toggle, theme
// toggle, account).
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

import { AppShell } from './app-shell';

// No global auto-cleanup configured for this package's Vitest runner.
afterEach(cleanup);

describe('AppShell — skip link (accessibility)', () => {
  it('the skip link is the first focusable element and becomes visible on focus', () => {
    render(
      <AppShell title="Home">
        <button>Somewhere in the page</button>
      </AppShell>,
    );
    const focusables = Array.from(
      document.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
    );
    const first = focusables[0]!;
    expect(first.textContent).toBe('Skip to main content');
    expect(first.className).toContain('sr-only');
    expect(first.className).toContain('focus:not-sr-only');
    expect(first.getAttribute('href')).toBe('#main-content');
    expect(document.getElementById('main-content')).toBeTruthy();
  });
});

describe('AppShell — top-of-viewport environment rule (03 §11.1)', () => {
  it('renders a 3px --status-platform rule for local', () => {
    const { container } = render(
      <AppShell title="Home" envClass="local">
        <div />
      </AppShell>,
    );
    const rule = container.querySelector('[aria-hidden="true"].h-\\[3px\\]');
    expect(rule).toBeTruthy();
    expect(rule?.className).toContain('bg-status-platform-strong');
  });

  it('renders a 3px --status-danger rule for prod', () => {
    const { container } = render(
      <AppShell title="Home" envClass="prod">
        <div />
      </AppShell>,
    );
    const rule = container.querySelector('[aria-hidden="true"].h-\\[3px\\]');
    expect(rule).toBeTruthy();
    expect(rule?.className).toContain('bg-status-danger-strong');
  });

  it('renders no rule for staging or probe', () => {
    const { container: staging } = render(
      <AppShell title="Home" envClass="staging">
        <div />
      </AppShell>,
    );
    expect(staging.querySelector('.h-\\[3px\\]')).toBeNull();

    const { container: probe } = render(
      <AppShell title="Home" envClass="probe">
        <div />
      </AppShell>,
    );
    expect(probe.querySelector('.h-\\[3px\\]')).toBeNull();
  });
});

describe('AppShell — topbar chrome', () => {
  it('carries env chip, branch chip, persona pill, density toggle, theme toggle and account', () => {
    render(
      <AppShell title="Home" subtitle="Your worklist" envClass="local" personaName="Priya">
        <div />
      </AppShell>,
    );
    expect(screen.getByText('Local dev')).toBeTruthy(); // env chip
    expect(screen.getByText('main')).toBeTruthy(); // branch chip
    expect(screen.getByText('Priya')).toBeTruthy(); // persona pill
    expect(screen.getByRole('switch', { name: /Density/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Theme:/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Account:/ })).toBeTruthy();
  });

  it('renders the page content passed as children inside <main>', () => {
    render(
      <AppShell title="Home">
        <p>Page body</p>
      </AppShell>,
    );
    const main = document.getElementById('main-content');
    expect(main?.textContent).toContain('Page body');
  });
});
