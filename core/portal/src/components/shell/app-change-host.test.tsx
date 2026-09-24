// @vitest-environment jsdom
//
// MCPForge — named follow-up from W0-J21: `AppChangeHostProvider` composes a
// real `ChangeHost` onto the tree, so `useOptionalChangeHost()` is no longer
// `undefined` on every real route (the gap this task closes).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';

import { AppChangeHostProvider } from './app-change-host';
import { useOptionalChangeHost } from '@/lib/change-host';

afterEach(cleanup);

function Probe() {
  const host = useOptionalChangeHost();
  return <span data-testid="probe">{host === undefined ? 'none' : 'present'}</span>;
}

describe('AppChangeHostProvider — the composition root-layout wires in', () => {
  it('supplies a defined ChangeHost to the tree (never `undefined` on a real route)', () => {
    render(
      <AppChangeHostProvider>
        <Probe />
      </AppChangeHostProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('present');
  });

  it('without the provider, useOptionalChangeHost stays undefined — proves the probe is honest', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('none');
  });
});
