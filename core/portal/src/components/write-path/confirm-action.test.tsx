// @vitest-environment jsdom
//
// W0-J8 — `ConfirmAction`'s contract (03 §7.3). Every assertion maps to a
// clause of the task's `done:` criterion, and the derivation tests exist to
// catch the one regression that would be invisible to the eye: a friction
// level that a caller can lower.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

import { ConfirmAction, deriveConfirmVariant, confirmWordMatches } from './index';
import type { ConsequenceView } from './types';

const REVERSIBLE_DEV: ConsequenceView = {
  reversalClass: 'compensating-tool',
  sensitivity: 'internal',
  envClass: 'local',
  entityName: 'voucher',
};

function submit() {
  return screen.getByTestId('confirm-submit') as HTMLButtonElement;
}

describe('deriveConfirmVariant — 03 §7.3’s table, as a pure function', () => {
  it('reversible + non-financial + non-prod is `simple`', () => {
    expect(deriveConfirmVariant(REVERSIBLE_DEV)).toBe('simple');
    expect(deriveConfirmVariant({ ...REVERSIBLE_DEV, envClass: 'staging' })).toBe('simple');
  });

  it('financial sensitivity is `acknowledge`, in any environment', () => {
    expect(deriveConfirmVariant({ ...REVERSIBLE_DEV, sensitivity: 'financial' })).toBe(
      'acknowledge',
    );
  });

  it('any prod environment is `acknowledge`, at any sensitivity', () => {
    expect(deriveConfirmVariant({ ...REVERSIBLE_DEV, envClass: 'prod' })).toBe('acknowledge');
    expect(
      deriveConfirmVariant({ ...REVERSIBLE_DEV, envClass: 'prod', sensitivity: 'public' }),
    ).toBe('acknowledge');
  });

  it('`irreversible` is `type-to-confirm`, outranking financial and prod', () => {
    expect(deriveConfirmVariant({ ...REVERSIBLE_DEV, reversalClass: 'irreversible' })).toBe(
      'type-to-confirm',
    );
    expect(
      deriveConfirmVariant({
        ...REVERSIBLE_DEV,
        reversalClass: 'irreversible',
        sensitivity: 'financial',
        envClass: 'prod',
      }),
    ).toBe('type-to-confirm');
  });

  it('a deployment-wide action is `type-to-confirm` whatever else is true', () => {
    expect(deriveConfirmVariant({ ...REVERSIBLE_DEV, deploymentId: 'ltm-jde-prod' })).toBe(
      'type-to-confirm',
    );
  });
});

describe('ConfirmAction — friction is derived, never supplied', () => {
  // The security property this whole task turns on: a caller holds the FACTS,
  // not the level. There is no `variant` prop to pass, so the only way to
  // attempt a downgrade is to pass one anyway — which TypeScript rejects and
  // which, at runtime, is ignored.
  it('a caller’s attempt to force `simple` on a financial prod write is ignored', () => {
    const props = {
      consequence: { ...REVERSIBLE_DEV, sensitivity: 'financial', envClass: 'prod' },
      onConfirm: () => {},
      // Not part of `ConfirmActionProps`; passed as an extra key on purpose.
      variant: 'simple',
      friction: 'simple',
    } as unknown as Parameters<typeof ConfirmAction>[0];

    render(<ConfirmAction {...props} />);

    expect(screen.getByTestId('confirm-action').dataset['variant']).toBe('acknowledge');
    expect(screen.getByTestId('confirm-acknowledge')).toBeTruthy();
    expect(submit().disabled).toBe(true);
  });

  it('a caller’s attempt to force `simple` on an irreversible write is ignored', () => {
    const props = {
      consequence: { ...REVERSIBLE_DEV, reversalClass: 'irreversible' },
      onConfirm: () => {},
      variant: 'simple',
    } as unknown as Parameters<typeof ConfirmAction>[0];

    render(<ConfirmAction {...props} />);

    expect(screen.getByTestId('confirm-action').dataset['variant']).toBe('type-to-confirm');
    expect(submit().disabled).toBe(true);
  });
});

describe('ConfirmAction — `simple`', () => {
  it('is a single enabled button and fires on one click', () => {
    const onConfirm = vi.fn();
    render(<ConfirmAction consequence={REVERSIBLE_DEV} onConfirm={onConfirm} />);

    expect(screen.queryByTestId('confirm-acknowledge')).toBeNull();
    expect(screen.queryByTestId('confirm-type-to-confirm')).toBeNull();
    expect(submit().disabled).toBe(false);

    fireEvent.click(submit());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('an external lock still disables it, with a visible reason and no tooltip', () => {
    render(
      <ConfirmAction
        consequence={REVERSIBLE_DEV}
        onConfirm={() => {}}
        disabled
        disabledReason="This plan has expired."
      />,
    );
    expect(submit().disabled).toBe(true);
    expect(screen.getByTestId('confirm-disabled-reason').textContent).toContain('expired');
    expect(submit().getAttribute('title')).toBeNull();
  });
});

describe('ConfirmAction — `acknowledge`', () => {
  const FINANCIAL: ConsequenceView = { ...REVERSIBLE_DEV, sensitivity: 'financial' };

  it('the checkbox is unchecked by default and the button is really disabled', () => {
    render(<ConfirmAction consequence={FINANCIAL} onConfirm={() => {}} />);
    const box = screen.getByTestId('confirm-acknowledge');
    expect(box.getAttribute('data-state')).toBe('unchecked');
    // The DOM attribute, not a class that looks disabled.
    expect(submit().hasAttribute('disabled')).toBe(true);
  });

  it('is labelled with 03 §7.3’s exact wording, and the label is focusable to the box', () => {
    render(<ConfirmAction consequence={FINANCIAL} onConfirm={() => {}} />);
    const label = screen.getByText('I have read the plan above') as HTMLLabelElement;
    expect(label.htmlFor).toBe(screen.getByTestId('confirm-acknowledge').id);
  });

  it('checking the box enables the button; unchecking disables it again', () => {
    const onConfirm = vi.fn();
    render(<ConfirmAction consequence={FINANCIAL} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId('confirm-acknowledge'));
    expect(submit().disabled).toBe(false);
    fireEvent.click(submit());
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('confirm-acknowledge'));
    expect(submit().disabled).toBe(true);
  });
});

describe('ConfirmAction — `type-to-confirm`', () => {
  const IRREVERSIBLE: ConsequenceView = {
    ...REVERSIBLE_DEV,
    reversalClass: 'irreversible',
    entityName: 'voucher',
  };

  function type(value: string) {
    fireEvent.change(screen.getByTestId('confirm-type-to-confirm'), { target: { value } });
  }

  it('the field is labelled with the word required, and the button starts disabled', () => {
    render(<ConfirmAction consequence={IRREVERSIBLE} onConfirm={() => {}} />);
    const input = screen.getByTestId('confirm-type-to-confirm') as HTMLInputElement;
    const label = screen.getByText('Type voucher to confirm') as HTMLLabelElement;
    expect(label.htmlFor).toBe(input.id);
    expect(submit().hasAttribute('disabled')).toBe(true);
  });

  it('a partial, wrong or differently-cased word does not unlock it', () => {
    render(<ConfirmAction consequence={IRREVERSIBLE} onConfirm={() => {}} />);
    for (const wrong of ['vouch', 'voucher!', 'invoice', 'Voucher', 'VOUCHER']) {
      type(wrong);
      expect(submit().disabled).toBe(true);
    }
  });

  it('an exact match unlocks it; surrounding whitespace is trimmed', () => {
    const onConfirm = vi.fn();
    render(<ConfirmAction consequence={IRREVERSIBLE} onConfirm={onConfirm} />);

    type('voucher');
    expect(submit().disabled).toBe(false);
    fireEvent.click(submit());
    expect(onConfirm).toHaveBeenCalledTimes(1);

    type('  voucher  ');
    expect(submit().disabled).toBe(false);
  });

  it('a deployment-wide action asks for the deployment id, not the entity', () => {
    render(
      <ConfirmAction
        consequence={{ ...REVERSIBLE_DEV, deploymentId: 'ltm-jde-prod' }}
        onConfirm={() => {}}
        label="Kill this tool"
      />,
    );
    expect(screen.getByText('Type ltm-jde-prod to confirm')).toBeTruthy();
    type('voucher');
    expect(submit().disabled).toBe(true);
    type('ltm-jde-prod');
    expect(submit().disabled).toBe(false);
  });

  it('fails CLOSED when no word was supplied — it never degrades to a lower variant', () => {
    render(
      <ConfirmAction
        consequence={{ reversalClass: 'irreversible', sensitivity: 'internal', envClass: 'local' }}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByTestId('confirm-action').dataset['variant']).toBe('type-to-confirm');
    expect((screen.getByTestId('confirm-type-to-confirm') as HTMLInputElement).disabled).toBe(true);
    expect(submit().disabled).toBe(true);
  });
});

describe('confirmWordMatches', () => {
  it('is case-sensitive, trim-tolerant, and never matches an absent requirement', () => {
    expect(confirmWordMatches('voucher', 'voucher')).toBe(true);
    expect(confirmWordMatches(' voucher\n', 'voucher')).toBe(true);
    expect(confirmWordMatches('Voucher', 'voucher')).toBe(false);
    expect(confirmWordMatches('', undefined)).toBe(false);
    expect(confirmWordMatches('anything', undefined)).toBe(false);
    expect(confirmWordMatches('', '')).toBe(false);
  });
});
