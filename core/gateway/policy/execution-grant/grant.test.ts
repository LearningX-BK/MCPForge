// MCPForge — W0-P9: the execution grant binds exactly one call.

import { describe, expect, it } from 'vitest';

import { generateConfirmSigningKey, mintConfirmToken, singleKeyKeyring } from '../confirm/token.js';
import {
  DEFAULT_EXECUTION_GRANT_TTL_SECONDS,
  EXECUTION_GRANT_PREFIX,
  executionGrantCheck,
  mintExecutionGrant,
  verifyExecutionGrant,
  type ExecutionGrantBinding,
  type MintExecutionGrantInput,
} from './grant.js';

const NOW = new Date('2026-09-25T10:00:00.000Z');
const KEY = generateConfirmSigningKey('egr-k1');
const KEYRING = singleKeyKeyring(KEY);

const MINT: MintExecutionGrantInput = {
  purpose: 'execute',
  toolId: 'jde.ap.voucher.create',
  bindingRef: 'MCPFORGE_AP_VOUCHER_CREATE_EXECUTE',
  args: { supplier: '4242', amount: 18400, company: '00100' },
  callerSubject: 'user:priya.raman',
  consumerId: 'test-agent-1',
  correlationId: 'req_p9_1',
  now: NOW,
};

const BINDING: ExecutionGrantBinding = {
  toolId: MINT.toolId,
  bindingRef: MINT.bindingRef,
  args: MINT.args,
  callerSubject: MINT.callerSubject,
  correlationId: MINT.correlationId,
};

describe('execution grant — mint and verify', () => {
  it('verifies for exactly the call it was minted for', () => {
    const grant = mintExecutionGrant(MINT, KEYRING);
    expect(grant.startsWith(EXECUTION_GRANT_PREFIX)).toBe(true);
    const result = verifyExecutionGrant(grant, BINDING, KEYRING, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.consumerId).toBe('test-agent-1');
      expect(result.payload.purpose).toBe('execute');
    }
  });

  it('ignores `confirm`, exactly as the confirm path hashes business arguments', () => {
    const grant = mintExecutionGrant(MINT, KEYRING);
    const withConfirm = { ...BINDING, args: { ...MINT.args, confirm: 'cnf_anything' } };
    expect(verifyExecutionGrant(grant, withConfirm, KEYRING, NOW).ok).toBe(true);
  });

  it.each([
    ['toolId', { toolId: 'jde.ap.voucher.cancel' }],
    ['bindingRef', { bindingRef: 'MCPFORGE_AP_VOUCHER_CREATE_EXECUTE_VALIDATE' }],
    ['argsCanonicalHash', { args: { ...MINT.args, amount: 18401 } }],
    ['callerSubject', { callerSubject: 'user:someone.else' }],
    ['correlationId', { correlationId: 'req_p9_other' }],
  ] as const)('refuses a grant presented for a different %s', (field, change) => {
    const grant = mintExecutionGrant(MINT, KEYRING);
    const result = verifyExecutionGrant(grant, { ...BINDING, ...change }, KEYRING, NOW);
    expect(result).toEqual({
      ok: false,
      failure: 'not-bound-to-this-call',
      mismatchedField: field,
    });
  });

  it('refuses a grant presented with NO caller subject (CLAUDE.md #1 — no anonymous dispatch)', () => {
    const grant = mintExecutionGrant(MINT, KEYRING);
    const result = verifyExecutionGrant(
      grant,
      { ...BINDING, callerSubject: undefined },
      KEYRING,
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it('refuses to MINT for an empty caller subject', () => {
    expect(() => mintExecutionGrant({ ...MINT, callerSubject: '' }, KEYRING)).toThrow();
  });

  it('expires after its TTL', () => {
    const grant = mintExecutionGrant(MINT, KEYRING);
    const later = new Date(NOW.getTime() + DEFAULT_EXECUTION_GRANT_TTL_SECONDS * 1000);
    expect(verifyExecutionGrant(grant, BINDING, KEYRING, later)).toEqual({
      ok: false,
      failure: 'expired',
    });
  });

  it('refuses a missing grant, a malformed one and one signed by another key', () => {
    expect(verifyExecutionGrant(undefined, BINDING, KEYRING, NOW)).toEqual({
      ok: false,
      failure: 'missing',
    });
    expect(verifyExecutionGrant('not-a-grant', BINDING, KEYRING, NOW)).toEqual({
      ok: false,
      failure: 'malformed',
    });
    const foreign = mintExecutionGrant(MINT, singleKeyKeyring(generateConfirmSigningKey('egr-k1')));
    expect(verifyExecutionGrant(foreign, BINDING, KEYRING, NOW)).toEqual({
      ok: false,
      failure: 'bad-signature',
    });
  });

  it('refuses an edited payload — the signature covers it', () => {
    const grant = mintExecutionGrant(MINT, KEYRING);
    const [header, body, signature] = grant.slice(EXECUTION_GRANT_PREFIX.length).split('.');
    const payload = JSON.parse(Buffer.from(body as string, 'base64url').toString('utf8'));
    payload.toolId = 'jde.ap.voucher.cancel';
    const edited = `${EXECUTION_GRANT_PREFIX}${header}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`;
    expect(
      verifyExecutionGrant(edited, { ...BINDING, toolId: 'jde.ap.voucher.cancel' }, KEYRING, NOW),
    ).toEqual({ ok: false, failure: 'bad-signature' });
  });

  it('a confirm token can never pass as an execution grant, even under the same key', () => {
    const confirm = mintConfirmToken(
      {
        callerSubject: MINT.callerSubject,
        toolId: MINT.toolId,
        toolVersion: '1.0.0',
        argsCanonicalHash: 'x',
        planHash: 'y',
        nonce: 'n',
        exp: Math.floor(NOW.getTime() / 1000) + 60,
      },
      KEYRING,
    );
    expect(verifyExecutionGrant(confirm, BINDING, KEYRING, NOW).ok).toBe(false);
    // Re-prefixed to look like a grant: the domain-separated signature still fails.
    const disguised = EXECUTION_GRANT_PREFIX + confirm.slice('cnf_'.length);
    expect(verifyExecutionGrant(disguised, BINDING, KEYRING, NOW).ok).toBe(false);
  });

  it('honours the rotation overlap: an accepted old key verifies, a retired one does not', () => {
    const oldKey = generateConfirmSigningKey('egr-old');
    const grant = mintExecutionGrant(MINT, singleKeyKeyring(oldKey));
    const overlap = { active: KEY, accepted: [KEY, oldKey] };
    expect(verifyExecutionGrant(grant, BINDING, overlap, NOW).ok).toBe(true);
    expect(verifyExecutionGrant(grant, BINDING, KEYRING, NOW)).toEqual({
      ok: false,
      failure: 'bad-signature',
    });
  });
});

describe('executionGrantCheck — the executor-facing shape', () => {
  it('passes a valid grant and names the failure otherwise', () => {
    const check = executionGrantCheck(KEYRING, () => NOW);
    const grant = mintExecutionGrant(MINT, KEYRING);
    expect(check.check(grant, BINDING)).toEqual({ ok: true });
    expect(check.check(grant, { ...BINDING, correlationId: 'other' })).toEqual({
      ok: false,
      reason: 'not-bound-to-this-call (correlationId)',
    });
    expect(check.check(undefined, BINDING)).toEqual({ ok: false, reason: 'missing' });
  });
});
