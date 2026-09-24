// @vitest-environment jsdom
//
// W0-J5 — the chip family: no icon-only status, colour never the sole
// differentiator, every chip carries an accessible name that expands the
// abbreviation (03 §12.5), zero axe violations at `serious`/`critical`
// (03 §12.7's own threshold, same substitution rationale as
// `../ui/a11y.test.tsx`: `vitest-axe` instead of the doc-named `jest-axe`).
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';

import {
  BindingChip,
  ChangeStateChip,
  EnvChip,
  PackageChip,
  ProbeStatusChip,
  StatusChip,
  VerbChip,
  WriteChip,
} from './index';

describe('chip family — colour classes actually resolve to real Tailwind utilities', () => {
  // Regression test for a real bug found during W0-J7's review: `StatusToken`
  // values already carry the `status-` prefix (e.g. `'status-danger'`), so
  // `bg-status-${token}-bg` produced `bg-status-status-danger-bg` — a class
  // Tailwind's JIT scanner never generates. Every chip rendered without its
  // status colour until this was caught. Assert the literal class strings,
  // not just that *some* class is present, so this exact mistake can't
  // silently recur.
  it('the default "soft" treatment emits bg-status-<token>-bg, not a double-prefixed class', () => {
    render(
      <StatusChip entry={{ token: 'status-danger', label: 'SoftX', srLabel: 'x', icon: 'Bug' }} />,
    );
    const chip = screen.getByText('SoftX').closest('span[aria-label]');
    expect(chip?.className).toContain('bg-status-danger-bg');
    expect(chip?.className).not.toContain('status-status');
  });

  it('the "filled" treatment emits bg-status-<token>-strong, not a double-prefixed class', () => {
    render(
      <StatusChip
        entry={{ token: 'status-danger', label: 'FilledX', srLabel: 'x', icon: 'Bug' }}
        treatment="filled"
      />,
    );
    const chip = screen.getByText('FilledX').closest('span[aria-label]');
    expect(chip?.className).toContain('bg-status-danger-strong');
    expect(chip?.className).not.toContain('status-status');
  });
});

describe('chip family — accessible names (03 §12.5)', () => {
  it('BindingChip: PL/SQL expands to the exact 03 §12.5 worked example', () => {
    render(<BindingChip type="plsql" />);
    expect(
      screen.getByLabelText(
        'Binding type: PL/SQL package. Identity does not carry natively; wrapper-schema attribution only. Elevated posture.',
      ),
    ).toBeTruthy();
    // The visible text label is the short form, not the expanded sentence —
    // "colour is never the only differentiator ... by their text ... first".
    expect(screen.getByText('PL/SQL')).toBeTruthy();
  });

  it('ProbeStatusChip: folds an owning team into the accessible name', () => {
    render(<ProbeStatusChip status="disabled_identity_unverified" owningTeam="JDE CNC" />);
    const chip = screen.getByText('Disabled — identity unverified').closest('span[aria-label]');
    expect(chip?.getAttribute('aria-label')).toContain('Owner: JDE CNC.');
  });

  it('ChangeStateChip: folds a proposer and relative time into the accessible name', () => {
    render(<ChangeStateChip state="in_review" proposedBy="Priya" proposedAgo="2 days ago" />);
    const chip = screen.getByText('In review').closest('span[aria-label]');
    expect(chip?.getAttribute('aria-label')).toBe(
      'Change state: in review. A pull request is open. Proposed by Priya, 2 days ago.',
    );
  });

  it('PackageChip: matches the exact 03 §12.5 worked example', () => {
    render(<PackageChip label="JD Edwards Financials" />);
    expect(screen.getByLabelText('Deployment package: JD Edwards Financials.')).toBeTruthy();
  });

  it('WriteChip: matches the exact 03 §12.5 worked example', () => {
    render(<WriteChip />);
    expect(screen.getByLabelText('This tool writes to the target system.')).toBeTruthy();
  });

  it('VerbChip: a read verb and a write verb carry distinct visible text and accessible names', () => {
    render(
      <>
        <VerbChip verb="get" />
        <VerbChip verb="create" />
      </>,
    );
    expect(screen.getByLabelText('Verb: Get. Read.')).toBeTruthy();
    expect(screen.getByLabelText('Verb: Create. Write.')).toBeTruthy();
  });

  it('EnvChip: production is the only filled treatment, the rest are outline', () => {
    render(
      <>
        <EnvChip envClass="local" />
        <EnvChip envClass="prod" />
      </>,
    );
    const local = screen.getByText('Local dev').closest('span[aria-label]');
    const prod = screen.getByText('Production').closest('span[aria-label]');
    expect(local?.className).toContain('bg-transparent');
    expect(prod?.className).not.toContain('bg-transparent');
  });

  it('StatusChip: no chip is rendered as icon-only — every chip has visible text', () => {
    const { container } = render(<StatusChip entry={{ token: 'status-ok', label: 'OK', srLabel: 'ok', icon: 'CircleCheck' }} />);
    expect(container.textContent).toContain('OK');
  });
});

describe('chip family — axe (03 §12.7, serious/critical threshold)', () => {
  it('has no serious or critical violations across one of every chip', async () => {
    const { container } = render(
      <ul>
        <li><StatusChip entry={{ token: 'status-danger', label: 'Timeout', srLabel: 'Call outcome: timeout.', icon: 'Clock' }} /></li>
        <li><BindingChip type="plsql" /></li>
        <li><ProbeStatusChip status="resolved" /></li>
        <li><ChangeStateChip state="approved" /></li>
        <li><VerbChip verb="submit" /></li>
        <li><WriteChip /></li>
        <li><PackageChip label="JD Edwards Financials" /></li>
        <li><EnvChip envClass="prod" /></li>
      </ul>,
    );
    const results = await axe(container);
    const seriousOrWorse = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(seriousOrWorse).toEqual([]);
  });
});
