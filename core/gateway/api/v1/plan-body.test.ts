// W0-P3f — a stored plan body is shown only when it re-hashes to the
// approval's planHash (owner decision, 30 Sep 2026).
import { describe, expect, it } from 'vitest';
import { buildPlanBody } from '../../policy/confirm/plan.js';
import { planCanonicalHash } from '../../policy/confirm/hash.js';
import { verifiedPlanBody } from './plan-body.js';

const BODY = buildPlanBody({
  template:
    'Create an AP voucher for supplier {supplier} for {amount} GBP. This creates an OPEN PAYABLE in JD Edwards.',
  args: { supplier: '4242', amount: 18400 },
  dryRun: { warnings: ['PO 0000451 is only 60% receipted.'] },
  defaultEffect: { system: 'jde-fin-ap', object: 'voucher', action: 'create', reversible: true },
  reversal: { class: 'compensating-tool', tool: 'jde.ap.voucher.cancel', windowHours: 720 },
});
const HASH = planCanonicalHash(BODY);
/** What the store hands back: the body after a JSON round trip. */
const stored = (body: unknown) => JSON.parse(JSON.stringify(body)) as unknown;

describe('verifiedPlanBody', () => {
  it('verifies the body the gate hashed, after the store round trip', () => {
    const checked = verifiedPlanBody({ planBody: stored(BODY), planHash: HASH });
    expect(checked).toEqual({ status: 'verified', body: stored(BODY) });
  });

  it('withholds a body whose amount was edited in the store', () => {
    const edited = { ...BODY, plan: BODY.plan.replace('18400', '184') };
    expect(verifiedPlanBody({ planBody: stored(edited), planHash: HASH })).toEqual({
      status: 'mismatch',
    });
  });

  it('withholds a body with a warning removed, or a field added', () => {
    expect(
      verifiedPlanBody({ planBody: stored({ ...BODY, warnings: [] }), planHash: HASH }).status,
    ).toBe('mismatch');
    expect(
      verifiedPlanBody({ planBody: stored({ ...BODY, note: 'x' }), planHash: HASH }).status,
    ).toBe('mismatch');
  });

  it('withholds a value that is not JSON (the store returns it raw)', () => {
    expect(verifiedPlanBody({ planBody: '{not json', planHash: HASH }).status).toBe('mismatch');
  });

  it('reports absent for a request raised before bodies were stored', () => {
    expect(verifiedPlanBody({ planBody: null, planHash: HASH })).toEqual({ status: 'absent' });
  });
});
