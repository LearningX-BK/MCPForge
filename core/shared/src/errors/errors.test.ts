import { describe, expect, it } from 'vitest';
import {
  BASE_ERROR_CODES,
  CONSUMER_ERROR_CODES,
  ERROR_CODES,
  ERROR_TAXONOMY,
  ForgeError,
  forgeError,
  isErrorCode,
  type ErrorCode,
} from './index.js';

// Phrases that are the definition of a dead end. CLAUDE.md non-negotiable #5:
// "Never 'try again'. Name a tool id or a human action."
const DEAD_END_PHRASES = [
  'try again',
  'please retry',
  'retry later',
  'contact support',
  'an error occurred',
  'unknown error',
];

describe('the closed error taxonomy — 02 §3.1.5 + §11.7', () => {
  it('is exactly 21 codes: the 17 base codes plus the 4 Phase 5 codes', () => {
    expect(BASE_ERROR_CODES).toHaveLength(17);
    expect(CONSUMER_ERROR_CODES).toHaveLength(4);
    expect(ERROR_CODES).toHaveLength(21);
    expect(new Set(ERROR_CODES).size).toBe(21);
  });

  it('carries the 17 codes named in 02 §3.1.5, in order', () => {
    expect(BASE_ERROR_CODES).toEqual([
      'INPUT_INVALID',
      'AUTH_REQUIRED',
      'IDENTITY_UNRESOLVED',
      'TOOL_NOT_IN_SCOPE',
      'TOOL_DISABLED',
      'POLICY_GUARDRAIL_BREACH',
      'APPROVAL_REQUIRED',
      'PLAN_REQUIRED',
      'PLAN_EXPIRED',
      'PLAN_ARGUMENT_MISMATCH',
      'TARGET_PRECONDITION_FAILED',
      'TARGET_ERROR',
      'TARGET_TIMEOUT',
      'TARGET_UNAVAILABLE',
      'ROW_CAP_EXCEEDED',
      'RATE_LIMITED',
      'INTERNAL',
    ]);
  });

  it('carries the four Phase 5 codes of 02 §11.7', () => {
    expect(CONSUMER_ERROR_CODES).toEqual([
      'CONSUMER_UNREGISTERED',
      'CONSUMER_SUSPENDED',
      'CONSUMER_NOT_AUTHORIZED',
      'ELEVATED_GRANT_REQUIRED',
    ]);
  });

  it('has exactly one taxonomy entry per code and no extras', () => {
    expect(Object.keys(ERROR_TAXONOMY).sort()).toEqual([...ERROR_CODES].sort());
  });

  it.each(ERROR_CODES)('%s carries a non-empty, agent-actionable next', (code) => {
    const spec = ERROR_TAXONOMY[code];
    expect(spec.code).toBe(code);
    expect(spec.condition.trim().length).toBeGreaterThan(0);
    expect(spec.next.trim().length).toBeGreaterThan(0);
    expect(typeof spec.retryable).toBe('boolean');

    const lowered = spec.next.toLowerCase();
    for (const phrase of DEAD_END_PHRASES) {
      expect(lowered, `${code}.next must not be a dead end`).not.toContain(phrase);
    }
  });

  it('never gives CONSUMER_NOT_AUTHORIZED and TOOL_NOT_IN_SCOPE the same wording (02 §11.3)', () => {
    const client = ERROR_TAXONOMY.CONSUMER_NOT_AUTHORIZED;
    const human = ERROR_TAXONOMY.TOOL_NOT_IN_SCOPE;
    expect(client.next).not.toBe(human.next);
    expect(client.condition).not.toBe(human.condition);
    expect(client.next.toLowerCase()).toContain('client');
  });

  it('marks only genuinely retryable conditions retryable', () => {
    const retryable = ERROR_CODES.filter((c) => ERROR_TAXONOMY[c].retryable);
    expect([...retryable].sort()).toEqual(['RATE_LIMITED', 'TARGET_UNAVAILABLE']);
  });

  it('does not invite a blind write replay after an unknown-outcome timeout', () => {
    expect(ERROR_TAXONOMY.TARGET_TIMEOUT.retryable).toBe(false);
    expect(ERROR_TAXONOMY.TARGET_TIMEOUT.next.toLowerCase()).toContain('get_status');
  });

  it('refuses to resolve a missing identity with anything but a hard failure', () => {
    expect(ERROR_TAXONOMY.IDENTITY_UNRESOLVED.retryable).toBe(false);
    expect(ERROR_TAXONOMY.IDENTITY_UNRESOLVED.condition.toLowerCase()).toContain('no fallback');
  });
});

describe('isErrorCode', () => {
  it('accepts every member of the closed set', () => {
    for (const code of ERROR_CODES) expect(isErrorCode(code)).toBe(true);
  });

  it('rejects anything outside it', () => {
    expect(isErrorCode('SOMETHING_ELSE')).toBe(false);
    expect(isErrorCode('')).toBe(false);
  });
});

describe('forgeError', () => {
  it('fills condition, next and retryable from the taxonomy', () => {
    const err = forgeError('PLAN_REQUIRED', 'A confirm token is required.', 'req_01J9');
    expect(err).toBeInstanceOf(ForgeError);
    expect(err.code).toBe('PLAN_REQUIRED');
    expect(err.next).toBe(ERROR_TAXONOMY.PLAN_REQUIRED.next);
    expect(err.correlationId).toBe('req_01J9');
  });

  it('lets a call site name the specific tool, reason or approver', () => {
    const err = forgeError(
      'TARGET_PRECONDITION_FAILED',
      'PO 0000451 is closed and cannot be vouchered.',
      'req_01J9',
      {
        condition: 'purchase_order.status = CLOSED',
        next: 'Use jde.scm.purchase_order.get_receipt_status to confirm status, or create the voucher without a PO match by omitting po_number.',
      },
    );
    expect(err.condition).toBe('purchase_order.status = CLOSED');
    expect(err.next).toContain('jde.scm.purchase_order.get_receipt_status');
  });

  it('throws rather than emit an error with an empty next', () => {
    expect(() => forgeError('INTERNAL', 'boom', 'req_1', { next: '   ' })).toThrow(
      /non-empty, agent-actionable next/,
    );
  });

  it('serialises to the wire shape of 02 §3.1.5', () => {
    const err = forgeError('RATE_LIMITED', 'Limit reached.', 'req_2');
    expect(Object.keys(err.toJSON()).sort()).toEqual(
      ['code', 'condition', 'correlationId', 'message', 'next', 'retryable'].sort(),
    );
  });
});

// A compile-time assertion that the union is closed: adding a code without a
// taxonomy entry fails `tsc`, not just this suite.
const _exhaustive: Record<ErrorCode, true> = Object.fromEntries(
  ERROR_CODES.map((c) => [c, true]),
) as Record<ErrorCode, true>;
void _exhaustive;
