// Unit test for the pre-paint theme script (03 §13.2 rule 4). Runs the
// exact production script text (THEME_INIT_SCRIPT, also inlined verbatim
// into layout.tsx's <head>) inside a sandbox with a mocked window/document,
// so this asserts the real script's try/catch behaviour rather than a
// reimplementation of it. Not a browser/E2E test — see W0-J2's report for
// what remains structurally-verified only (no live prefers-color-scheme,
// no actual paint timing).

import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { THEME_INIT_SCRIPT } from './theme-init';

function run(getItem: (key: string) => string | null): { attr: string | null } {
  let attr: string | null = null;
  const sandbox = {
    window: {
      localStorage: { getItem },
    },
    document: {
      documentElement: {
        setAttribute: (name: string, value: string) => {
          if (name === 'data-theme') attr = value;
        },
      },
    },
  };
  runInNewContext(THEME_INIT_SCRIPT, sandbox);
  return { attr };
}

describe('THEME_INIT_SCRIPT', () => {
  it('stamps data-theme="dark" when localStorage holds "dark"', () => {
    expect(run(() => 'dark').attr).toBe('dark');
  });

  it('stamps data-theme="light" when localStorage holds "light"', () => {
    expect(run(() => 'light').attr).toBe('light');
  });

  it('stamps nothing when there is no stored value (system theme)', () => {
    expect(run(() => null).attr).toBeNull();
  });

  it('stamps nothing for a value that is not "light" or "dark"', () => {
    expect(run(() => 'sepia').attr).toBeNull();
  });

  it('does not throw, and stamps nothing, when localStorage.getItem throws', () => {
    expect(() =>
      run(() => {
        throw new Error('SecurityError: storage is disabled');
      }),
    ).not.toThrow();
    expect(
      run(() => {
        throw new Error('SecurityError: storage is disabled');
      }).attr,
    ).toBeNull();
  });

  it('does not throw when window.localStorage itself is unavailable', () => {
    let attr: string | null = null;
    const sandbox = {
      window: {},
      document: {
        documentElement: {
          setAttribute: (name: string, value: string) => {
            if (name === 'data-theme') attr = value;
          },
        },
      },
    };
    expect(() => runInNewContext(THEME_INIT_SCRIPT, sandbox)).not.toThrow();
    expect(attr).toBeNull();
  });
});
