// MCPForge — W0-P5b: the portal's action gates, W0-P4 §3 and §9 decision 3.
//
// Two things are proved here. First, every refusal is the note's copy, with a
// human-form `next` (non-negotiable 5). Second, the selected pill cannot widen
// a grant: a gate reads HELD personas only.

import { describe, expect, it } from 'vitest';

import {
  gateApproveDefinitional,
  gateDiscard,
  gateKill,
  gateMerge,
  gateSaveOrPropose,
  issueCredentialNext,
  type GateViewer,
} from './gates';
import { PERSONAS, type Persona } from './personas';
import type { Viewer } from './viewer';

const viewer = (subject: string, personas: readonly Persona[]): GateViewer => ({
  subject,
  displayName: subject,
  personas,
});

describe('Save draft / Propose', () => {
  it('any signed-in viewer; signed out is refused with the note’s copy', () => {
    expect(gateSaveOrPropose(viewer('local:a', []))).toEqual({ allowed: true });
    expect(gateSaveOrPropose(null)).toEqual({
      allowed: false,
      message: 'You are not signed in.',
      next: 'Sign in, then propose again; your draft is kept.',
    });
  });
});

describe('Discard', () => {
  it('the author only, whatever persona anyone else holds', () => {
    expect(gateDiscard(viewer('local:priya', []), 'local:priya')).toEqual({ allowed: true });
    expect(gateDiscard(viewer('local:meera', ['admin']), 'local:priya')).toEqual({
      allowed: false,
      message: 'Only the author, local:priya, can discard this change.',
      next: 'Ask local:priya to discard it, or request changes on the proposal instead.',
    });
    expect(gateDiscard(null, 'local:priya').allowed).toBe(false);
  });
});

describe('Approve a definitional change', () => {
  const SELF_REFUSAL = {
    allowed: false,
    message: 'You proposed this change, so you cannot approve it.',
    next: 'Ask another admin to review it, or a super admin (a member of a superAdmins group in the git mapping); the proposal stays open.',
  };

  it('an admin may approve another’s proposal (unchanged), super admin or not', () => {
    for (const superAdmin of [false, true]) {
      expect(
        gateApproveDefinitional(viewer('local:meera', ['admin']), 'local:priya', superAdmin),
      ).toEqual({ allowed: true, selfApproved: false });
    }
  });

  it('W0-P34: an admin who is NOT a super admin is refused approving their own, with a next', () => {
    expect(
      gateApproveDefinitional(viewer('local:meera', ['admin', 'developer', 'business']), 'local:meera', false),
    ).toEqual(SELF_REFUSAL);
  });

  it('W0-P34: a super admin may approve their own, flagged selfApproved, whatever persona', () => {
    for (const personas of [['admin'], []] as const) {
      expect(gateApproveDefinitional(viewer('local:super', personas), 'local:super', true)).toEqual({
        allowed: true,
        selfApproved: true,
      });
    }
  });

  it('a non-admin proposer is refused with the same copy', () => {
    expect(gateApproveDefinitional(viewer('local:priya', ['developer']), 'local:priya', false)).toEqual(
      SELF_REFUSAL,
    );
  });

  it('a non-admin who did not propose is refused too, naming who can', () => {
    const result = gateApproveDefinitional(viewer('local:arjun', ['business']), 'local:priya', false);
    expect(result).toMatchObject({ allowed: false, next: expect.stringMatching(/admin/) });
  });

  it('signed out is refused with a next', () => {
    expect(gateApproveDefinitional(null, 'local:priya', true)).toMatchObject({
      allowed: false,
      next: expect.stringMatching(/Sign in/),
    });
  });
});

describe('Merge (W0-P33b)', () => {
  it('a super admin only, decided by the caller from git — never from a persona', () => {
    expect(gateMerge(viewer('local:super', []), true)).toEqual({ allowed: true });
    const refused = gateMerge(viewer('local:meera', ['admin', 'developer', 'business']), false);
    expect(refused.allowed).toBe(false);
    if (refused.allowed) return;
    expect(refused.message).toContain('super admin');
    expect(refused.next.length).toBeGreaterThan(0);
    expect(gateMerge(null, true).allowed).toBe(false);
  });
});

describe('Kill', () => {
  it('the admin persona; the refusal names `forge kill`', () => {
    expect(gateKill(viewer('local:meera', ['admin']))).toEqual({ allowed: true });
    for (const v of [viewer('local:a', ['developer', 'business']), null]) {
      expect(gateKill(v)).toEqual({
        allowed: false,
        message: 'Kill switches need the admin persona.',
        next: 'Ask an MCPForge admin, or run `forge kill` if you hold the admin role locally.',
      });
    }
  });
});

describe('issue-credential', () => {
  it('is never a portal action: only the CLI command, with the consumer id', () => {
    expect(issueCredentialNext('agent-x')).toBe(
      'Run `forge consumer issue-credential agent-x` on the gateway host; it prints once and is refused when CI=true or in staging/prod.',
    );
  });
});

describe('the selected persona pill cannot widen a grant', () => {
  // Every combination of held personas, with every lens forced on, including
  // lenses not held (a crafted session). The decision must equal the decision
  // for the same held set with no lens at all.
  const subsets: Persona[][] = [[]];
  for (const p of PERSONAS) for (const s of [...subsets]) subsets.push([...s, p]);

  for (const held of subsets) {
    for (const lens of [...PERSONAS, null]) {
      it(`held [${held.join(', ')}] with the pill on ${lens ?? 'none'}`, () => {
        const withLens: Viewer = {
          subject: 'local:x',
          displayName: 'X',
          groups: [],
          personas: held,
          persona: lens,
          sessionExpiresAt: '2099-01-01T00:00:00.000Z',
        };
        const baseline = viewer('local:x', held);
        expect(gateKill(withLens)).toEqual(gateKill(baseline));
        for (const superAdmin of [false, true]) {
          expect(gateApproveDefinitional(withLens, 'local:y', superAdmin)).toEqual(
            gateApproveDefinitional(baseline, 'local:y', superAdmin),
          );
          expect(gateApproveDefinitional(withLens, 'local:x', superAdmin)).toEqual(
            gateApproveDefinitional(baseline, 'local:x', superAdmin),
          );
        }
        expect(gateDiscard(withLens, 'local:y')).toEqual(gateDiscard(baseline, 'local:y'));
        expect(gateSaveOrPropose(withLens)).toEqual(gateSaveOrPropose(baseline));
      });
    }
  }

  it('the admin lens on a viewer who does not hold admin grants nothing', () => {
    const crafted: Viewer = {
      subject: 'local:x',
      displayName: 'X',
      groups: [],
      personas: ['business'],
      persona: 'admin',
      sessionExpiresAt: '2099-01-01T00:00:00.000Z',
    };
    expect(gateKill(crafted).allowed).toBe(false);
    expect(gateApproveDefinitional(crafted, 'local:y', false).allowed).toBe(false);
  });

  it('W0-P34: the admin persona, held and on the pill, does not grant self-approval', () => {
    const adminLens: Viewer = {
      subject: 'local:x',
      displayName: 'X',
      groups: [],
      personas: ['admin', 'developer', 'business'],
      persona: 'admin',
      sessionExpiresAt: '2099-01-01T00:00:00.000Z',
    };
    expect(gateApproveDefinitional(adminLens, 'local:x', false).allowed).toBe(false);
  });
});
