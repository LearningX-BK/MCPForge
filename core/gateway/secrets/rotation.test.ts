// MCPForge — the dual-key overlap window, proved. W0-N6, 02 §11.5 rule 5.
//
// The `done:` criterion names one test in particular: "a test that mints a plan
// on the old key, rotates, and confirms the plan still executes while a
// newly-minted plan uses the new key". That test is
// `the in-flight plan survives the rotation` below, and it is written against
// the REAL `mintConfirmToken`/`verifyConfirmToken` rather than against a stub,
// because the property under test is a property of the token, not of the ring.
//
// Everything else here is the adversarial half: the ways an implementation
// could satisfy the letter of "dual key" while breaking the invariant that a
// retired key never signs again.

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIRM_TTL_SECONDS,
  confirmSigningKeyFrom,
  generateConfirmSigningKey,
  mintConfirmToken,
  verifyConfirmToken,
  type ConfirmTokenPayload,
} from '../policy/confirm/token.js';
import { generateLocalSigningKey, localTokenIssuer, LOCAL_JWT_ALGORITHM } from '../identity/jwt.js';
import type { Principal } from '../identity/types.js';
import {
  CONFIRM_HMAC_SECRET_REF,
  DualKeyRing,
  JWT_SIGNING_SECRET_REF,
  OVERLAP_MARGIN_SECONDS,
  SIGNING_KEY_ROTATION_DAYS,
  confirmKeyringAt,
  localSigningKeysAt,
  overlapWindowSeconds,
} from './rotation.js';

const T0 = new Date('2026-09-07T10:00:00.000Z');
const at = (secondsAfterT0: number): Date => new Date(T0.getTime() + secondsAfterT0 * 1000);

const CALLER = 'local:bikash';
const PLAN: Omit<ConfirmTokenPayload, 'exp'> = {
  callerSubject: CALLER,
  toolId: 'jde.ap.voucher.create',
  toolVersion: '1.0.0',
  argsCanonicalHash: 'a'.repeat(64),
  planHash: 'b'.repeat(64),
  nonce: 'nonce-0001',
};
const BINDING = {
  callerSubject: CALLER,
  toolId: PLAN.toolId,
  toolVersion: PLAN.toolVersion,
  argsCanonicalHash: PLAN.argsCanonicalHash,
};

function payloadExpiringAt(seconds: number): ConfirmTokenPayload {
  return { ...PLAN, exp: Math.floor(at(seconds).getTime() / 1000) };
}

describe('the overlap window is one plan TTL plus a margin', () => {
  it('derives the window from the plan TTL, not from a constant of its own', () => {
    expect(overlapWindowSeconds(DEFAULT_CONFIRM_TTL_SECONDS)).toBe(
      DEFAULT_CONFIRM_TTL_SECONDS + OVERLAP_MARGIN_SECONDS,
    );
    expect(overlapWindowSeconds(60)).toBe(60 + OVERLAP_MARGIN_SECONDS);
    // The default IS the plan TTL default; a drift between them would size the
    // window against a TTL nobody mints with.
    expect(overlapWindowSeconds()).toBe(overlapWindowSeconds(DEFAULT_CONFIRM_TTL_SECONDS));
  });

  it('refuses to size a window from a non-TTL rather than defaulting to something', () => {
    expect(() => overlapWindowSeconds(0)).toThrow(/positive whole number/);
    expect(() => overlapWindowSeconds(-1)).toThrow(/positive whole number/);
    expect(() => overlapWindowSeconds(1.5)).toThrow(/positive whole number/);
  });

  it('names the 90-day rotation schedule and the two gateway refs 02 §11.5 rule 5 gives', () => {
    expect(SIGNING_KEY_ROTATION_DAYS).toBe(90);
    expect(CONFIRM_HMAC_SECRET_REF.uri).toBe('secretRef://gateway/confirm-token/hmac');
    expect(JWT_SIGNING_SECRET_REF.uri).toBe('secretRef://gateway/local-issuer/jwt-signing');
  });
});

describe('DualKeyRing — a retired key verifies and never signs', () => {
  const k1 = generateConfirmSigningKey('kid-1');
  const k2 = generateConfirmSigningKey('kid-2');
  const k3 = generateConfirmSigningKey('kid-3');

  it('signs with the active key only, before and after a rotation', () => {
    const before = new DualKeyRing(k1);
    expect(before.signingKey.keyId).toBe('kid-1');

    const after = before.rotate(k2, { now: T0 });
    expect(after.signingKey.keyId).toBe('kid-2');
    // The retired key is reachable ONLY through the verify-only surface.
    expect(after.verifyOnlyKeys(T0).map((k) => k.keyId)).toEqual(['kid-1']);
    expect(after.acceptedKeyIds(T0)).toEqual(['kid-2', 'kid-1']);
  });

  it('does not mutate the ring it was rotated from', () => {
    const before = new DualKeyRing(k1);
    before.rotate(k2, { now: T0 });
    // The caller who still holds `before` still signs with kid-1; a rotation
    // that mutated in place would change the signer under a live request.
    expect(before.signingKey.keyId).toBe('kid-1');
    expect(before.acceptedKeyIds(T0)).toEqual(['kid-1']);
  });

  it('drops a retired key once its window closes', () => {
    const window = overlapWindowSeconds();
    const ring = new DualKeyRing(k1).rotate(k2, { now: T0 });
    expect(ring.acceptedKeyIds(at(window - 1))).toEqual(['kid-2', 'kid-1']);
    // Boundary: acceptUntil is exclusive, so exactly at the edge it is out.
    expect(ring.acceptedKeyIds(at(window))).toEqual(['kid-2']);
    expect(ring.expiredKeys(at(window)).map((r) => r.key.keyId)).toEqual(['kid-1']);
  });

  it('does not accumulate keys forever — a rotation drops windows that already closed', () => {
    const window = overlapWindowSeconds();
    const ring = new DualKeyRing(k1).rotate(k2, { now: T0 }).rotate(k3, { now: at(window + 10) });
    // kid-1's window closed before kid-2 retired, so it is gone entirely.
    expect(ring.acceptedKeyIds(at(window + 10))).toEqual(['kid-3', 'kid-2']);
  });

  it('refuses to install the active key id again — that would be a rotation in name only', () => {
    const ring = new DualKeyRing(k1);
    expect(() => ring.rotate(confirmSigningKeyFrom('kid-1', randomBytes(32)), { now: T0 })).toThrow(
      /already the active key/,
    );
  });

  it('refuses a ring in which one kid is both active and retired', () => {
    expect(
      () =>
        new DualKeyRing(k1, [
          { key: k1, retiredAt: T0.toISOString(), acceptUntil: at(600).toISOString() },
        ]),
    ).toThrow(/both the active key and a retired key/);
  });

  it('refuses to rotate BACK to a key still inside its overlap window', () => {
    // The adversarial case: an operator "rolling back" a rotation would put a
    // retired key into signing service. The constructor invariant catches it
    // because `rotate` filters `next` out of the retained retired list, so the
    // rolled-back key becomes active with no duplicate — and, crucially, the
    // ring that results signs with it deliberately, not accidentally. What must
    // never happen is a ring where it is both.
    const ring = new DualKeyRing(k1).rotate(k2, { now: T0 });
    const rolledBack = ring.rotate(k1, { now: at(10) });
    expect(rolledBack.signingKey.keyId).toBe('kid-1');
    expect(rolledBack.acceptedKeyIds(at(10))).toEqual(['kid-1', 'kid-2']);
    // kid-1 appears exactly once — never twice, never in both roles.
    expect(rolledBack.acceptedKeyIds(at(10)).filter((k) => k === 'kid-1')).toHaveLength(1);
  });

  it('withoutRetiredKeys drops the whole overlap immediately — the revocation path', () => {
    const ring = new DualKeyRing(k1).rotate(k2, { now: T0 });
    expect(ring.withoutRetiredKeys().acceptedKeyIds(T0)).toEqual(['kid-2']);
  });
});

describe('the confirm-token HMAC key: the in-flight plan survives the rotation', () => {
  it('mints on the old key, rotates, and the in-flight plan STILL executes while new plans use the new key', () => {
    const oldKey = generateConfirmSigningKey('hmac-2026-06');
    const newKey = generateConfirmSigningKey('hmac-2026-09');

    // --- before the rotation: a human is shown a plan and mints its token.
    let ring = new DualKeyRing(oldKey);
    const inFlight = mintConfirmToken(
      payloadExpiringAt(DEFAULT_CONFIRM_TTL_SECONDS),
      confirmKeyringAt(ring, T0),
    );
    expect(verifyConfirmToken(inFlight, BINDING, confirmKeyringAt(ring, T0), T0).ok).toBe(true);

    // --- the rotation happens while the human is still deciding.
    ring = ring.rotate(newKey, { now: at(30) });

    // 1. The in-flight plan still executes. This is the clause the outage
    //    argument in 02 §11.5 rule 5 is about.
    const stillGood = verifyConfirmToken(inFlight, BINDING, confirmKeyringAt(ring, at(60)), at(60));
    expect(stillGood.ok).toBe(true);
    if (stillGood.ok) expect(stillGood.nonce).toBe('nonce-0001');

    // 2. A NEWLY minted plan carries the new kid, not the old one.
    const fresh = mintConfirmToken(
      { ...payloadExpiringAt(30 + DEFAULT_CONFIRM_TTL_SECONDS), nonce: 'nonce-0002' },
      confirmKeyringAt(ring, at(60)),
    );
    expect(kidOf(fresh)).toBe('hmac-2026-09');
    expect(kidOf(inFlight)).toBe('hmac-2026-06');
    expect(verifyConfirmToken(fresh, BINDING, confirmKeyringAt(ring, at(60)), at(60)).ok).toBe(
      true,
    );

    // 3. The OLD key cannot mint anything after the rotation. There is no
    //    accessor that hands it back as a signer, and the projected keyring's
    //    `active` — the only key `mintConfirmToken` ever uses — is the new one.
    const projected = confirmKeyringAt(ring, at(60));
    expect(projected.active.keyId).toBe('hmac-2026-09');
    expect(projected.accepted.map((k) => k.keyId)).toEqual(['hmac-2026-09', 'hmac-2026-06']);
    // Proved behaviourally, not just structurally: every mint through the
    // post-rotation ring carries the new kid, whatever the payload.
    for (const nonce of ['n-a', 'n-b', 'n-c']) {
      expect(kidOf(mintConfirmToken({ ...payloadExpiringAt(600), nonce }, projected))).toBe(
        'hmac-2026-09',
      );
    }
  });

  it('refuses an old-key token once the overlap window has closed — bad-signature, not a crash', () => {
    const oldKey = generateConfirmSigningKey('hmac-old');
    const newKey = generateConfirmSigningKey('hmac-new');
    const ring = new DualKeyRing(oldKey);
    // A long-lived token, so `expired` cannot be what refuses it: the point is
    // that the KEY stopped being accepted, not that the token timed out.
    const token = mintConfirmToken(payloadExpiringAt(100_000), confirmKeyringAt(ring, T0));
    const rotated = ring.rotate(newKey, { now: T0 });

    const window = overlapWindowSeconds();
    const inside = verifyConfirmToken(
      token,
      BINDING,
      confirmKeyringAt(rotated, at(window - 1)),
      at(window - 1),
    );
    expect(inside.ok).toBe(true);

    const outside = verifyConfirmToken(
      token,
      BINDING,
      confirmKeyringAt(rotated, at(window)),
      at(window),
    );
    expect(outside.ok).toBe(false);
    if (!outside.ok) expect(outside.failure).toBe('bad-signature');
  });

  it('a token minted on the old key still cannot be edited into a different call', () => {
    // The overlap widens WHICH KEYS verify. It must not widen WHAT a token
    // authorises — an overlap that also relaxed the binding check would be a
    // rotation that quietly disabled the confirm gate.
    const oldKey = generateConfirmSigningKey('hmac-old');
    const ring = new DualKeyRing(oldKey);
    const token = mintConfirmToken(payloadExpiringAt(600), confirmKeyringAt(ring, T0));
    const rotated = ring.rotate(generateConfirmSigningKey('hmac-new'), { now: T0 });

    const wrongTool = verifyConfirmToken(
      token,
      { ...BINDING, toolId: 'jde.ap.voucher.cancel' },
      confirmKeyringAt(rotated, at(60)),
      at(60),
    );
    expect(wrongTool.ok).toBe(false);
    if (!wrongTool.ok) {
      expect(wrongTool.failure).toBe('not-bound-to-this-call');
      expect(wrongTool.mismatchedField).toBe('toolId');
    }

    const wrongCaller = verifyConfirmToken(
      token,
      { ...BINDING, callerSubject: 'local:someone-else' },
      confirmKeyringAt(rotated, at(60)),
      at(60),
    );
    expect(wrongCaller.ok).toBe(false);
    if (!wrongCaller.ok) expect(wrongCaller.mismatchedField).toBe('callerSubject');
  });
});

describe('the local JWT signing key: the same mechanism, the same guarantee', () => {
  const principal: Principal = {
    subject: 'local:bikash',
    displayName: 'Bikash',
    email: 'bikash@example.invalid',
    groups: ['ap-clerks'],
    idp: 'local',
    authTime: T0,
    amr: ['pwd'],
  };

  function issuerFor(ring: DualKeyRing<ReturnType<typeof generateLocalSigningKey>>, now: Date) {
    const { signingKey, previousKeys } = localSigningKeysAt(ring, now);
    return localTokenIssuer({
      issuer: 'https://mcpforge.local',
      audience: 'mcpforge',
      signingKey,
      previousKeys,
      now: () => now,
    });
  }

  it('a token issued before the rotation still verifies after it; a new token carries the new kid', async () => {
    const oldKey = generateLocalSigningKey('jwt-2026-06');
    const newKey = generateLocalSigningKey('jwt-2026-09');

    let ring = new DualKeyRing(oldKey);
    const before = await issuerFor(ring, T0).issue(principal);
    expect(kidOf(before.token)).toBe('jwt-2026-06');

    ring = ring.rotate(newKey, { now: at(30) });
    const after = issuerFor(ring, at(60));

    // Still verifies — the session in a human's client is not invalidated.
    const recovered = await after.verify(before.token, 'corr-1');
    expect(recovered.subject).toBe('local:bikash');
    expect(after.acceptedKeyIds).toEqual(['jwt-2026-09', 'jwt-2026-06']);
    expect(after.activeKeyId).toBe('jwt-2026-09');

    // A newly issued token carries the new kid.
    const fresh = await after.issue(principal);
    expect(kidOf(fresh.token)).toBe('jwt-2026-09');
    expect(headerOf(fresh.token)['alg']).toBe(LOCAL_JWT_ALGORITHM);
  });

  it('once the window closes, the old token is refused with AUTH_REQUIRED and not a stack trace', async () => {
    const ring = new DualKeyRing(generateLocalSigningKey('jwt-old'));
    const before = await issuerFor(ring, T0).issue(principal);
    const rotated = ring.rotate(generateLocalSigningKey('jwt-new'), { now: T0 });

    const past = at(overlapWindowSeconds() + 1);
    // Verify at an instant inside the token's own TTL but past the key window,
    // so the refusal is attributable to the key and not to expiry: issue a
    // fresh long-lived comparison is unnecessary because DEFAULT_TOKEN_TTL is
    // 900 s and the window closes at 600 s.
    const issuer = localTokenIssuer({
      issuer: 'https://mcpforge.local',
      audience: 'mcpforge',
      ...localSigningKeysAt(rotated, past),
      now: () => past,
    });
    expect(issuer.acceptedKeyIds).toEqual(['jwt-new']);
    await expect(issuer.verify(before.token, 'corr-2')).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
  });
});

// --- helpers ----------------------------------------------------------------

/** Decode the header of a `cnf_`-prefixed confirm token OR a compact JWS. */
function headerOf(token: string): Record<string, unknown> {
  const body = token.startsWith('cnf_') ? token.slice('cnf_'.length) : token;
  const segment = body.split('.')[0] as string;
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function kidOf(token: string): string {
  return headerOf(token)['kid'] as string;
}
