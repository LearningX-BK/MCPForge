// @vitest-environment jsdom
//
// MCPForge — W0-J13: identity carriage never renders "verified" without a
// probe reference (CLAUDE.md non-negotiable #2). Three visually distinct
// states, driven by real `carries` values.
import type * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { IdentityCarriage } from './identity-carriage';

afterEach(cleanup);

describe('IdentityCarriage', () => {
  it('renders "Verified" only when a real probeRef is present and carries is verified', () => {
    render(
      <IdentityCarriage
        identity={{ subject: 'p.rao', bindingType: 'function', carries: 'verified', probeRef: 'probe-report-2026-09-08#jde-ap', probedAt: '2026-09-08T06:00:00Z' }}
      />,
    );
    expect(screen.getByText('Verified')).not.toBeNull();
  });

  it('never renders "Verified" when there is no probe reference, even if carries were verified', () => {
    render(<IdentityCarriage identity={{ subject: 'p.rao', bindingType: 'function', carries: 'verified', probeRef: '' }} />);
    expect(screen.queryByText('Verified')).toBeNull();
    expect(screen.getByText('No probe run')).not.toBeNull();
  });

  it('renders the declared/unverified amber state distinctly', () => {
    render(<IdentityCarriage identity={{ subject: 'p.rao', bindingType: 'rest', carries: 'unverified', probeRef: 'probe-report-1' }} />);
    expect(screen.getByText('Declared — unverified')).not.toBeNull();
  });

  it('renders the no-carriage state with its compensating control named', () => {
    render(
      <IdentityCarriage
        identity={{
          subject: 'p.rao',
          bindingType: 'plsql',
          carries: 'no',
          probeRef: 'probe-report-1',
          compensatingControl: 'Wrapper schema records p_requested_by.',
        }}
      />,
    );
    expect(screen.getByText('No native carriage')).not.toBeNull();
    expect(screen.getByTestId('compensating-control').textContent).toContain('Wrapper schema records p_requested_by.');
  });

  it('the three states render three distinct status tokens (colour is not the only signal, but it is present)', () => {
    const badgeClass = (identity: React.ComponentProps<typeof IdentityCarriage>['identity']) => {
      const { container, unmount } = render(<IdentityCarriage identity={identity} />);
      const badge = container.querySelector('[data-testid="identity-carriage"] [aria-label]');
      const className = badge?.className ?? '';
      unmount();
      return className;
    };

    const verifiedClass = badgeClass({ subject: 's', bindingType: 'function', carries: 'verified', probeRef: 'p1' });
    const unverifiedClass = badgeClass({ subject: 's', bindingType: 'function', carries: 'unverified', probeRef: 'p1' });
    const noClass = badgeClass({ subject: 's', bindingType: 'database', carries: 'no', probeRef: 'p1' });

    expect(verifiedClass).not.toBe('');
    expect(unverifiedClass).not.toBe('');
    expect(noClass).not.toBe('');
    expect(verifiedClass).not.toBe(unverifiedClass);
    expect(unverifiedClass).not.toBe(noClass);
    expect(verifiedClass).not.toBe(noClass);
  });
});
