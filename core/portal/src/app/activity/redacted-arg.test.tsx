// @vitest-environment jsdom
//
// W0-J16: the redacted-value hash announcement — exact phrasing
// "Redacted value, hash …" per 03 §5.3 / 02 §4.6.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { RedactedArg } from './redacted-arg';
import { redactedAnnouncement } from './fixtures';

afterEach(cleanup);

describe('RedactedArg', () => {
  it('announces a redacted value as "Redacted value, hash <hash>"', () => {
    render(<RedactedArg entry={{ field: 'remitBankAccount', redacted: true, hash: 'b6f2e19a7c31' }} />);
    expect(screen.getByTestId('arg-value-redacted').textContent).toBe(
      'Redacted value, hash b6f2e19a7c31',
    );
  });

  it('renders the real value in place for a non-redacted argument', () => {
    render(<RedactedArg entry={{ field: 'supplierNumber', redacted: false, value: '4501' }} />);
    expect(screen.getByTestId('arg-value').textContent).toBe('4501');
    expect(screen.queryByTestId('arg-value-redacted')).toBeNull();
  });

  it('redactedAnnouncement builds the exact phrase', () => {
    expect(redactedAnnouncement('abcdef123456')).toBe('Redacted value, hash abcdef123456');
  });
});
