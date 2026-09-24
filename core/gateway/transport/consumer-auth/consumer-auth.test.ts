// MCPForge — W0-N2 proofs at the `[2a]` gate itself.
// The HTTP-level proofs (zero catalogue bytes, 403-not-404) are in
// ./consumer-auth.http.test.ts.

import { describe, expect, it } from 'vitest';
import {
  ConsumerAuthenticator,
  ConsumerPresentation,
  MCPFORGE_CONSUMER_ASSERTION_HEADER,
  MCPFORGE_CONSUMER_ID_HEADER,
  MCPFORGE_CONSUMER_SECRET_HEADER,
  readConsumerPresentation,
  type ConsumerAuthResult,
} from './index.js';
import {
  generateTestConsumerKeypair,
  signTestAssertion,
  testConsumerRecord,
  testRegistry,
  type TestKeypair,
} from './testkit.js';
import {
  LocalVerifierFile,
  issueConsumerCredential,
  type ConsumerVerifierStore,
  type CredentialVerifier,
} from '../../consumer/index.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const AUDIENCE = 'https://mcpforge.local/mcp';
const CID = 'w0n2-correlation';

function expectRefused(result: ConsumerAuthResult, code: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe(code);
  // CLAUDE.md non-negotiable 5 — never a dead end, and never "try again".
  expect(result.error.next.trim().length).toBeGreaterThan(0);
  expect(result.error.next.toLowerCase()).not.toMatch(/\btry again\b/);
}

async function authenticateWith(
  keypair: TestKeypair,
  record = testConsumerRecord({
    publicKeys: [{ kid: keypair.kid, ...keypair.publicJwk, addedAt: '2026-08-27' }],
  }),
): Promise<{ auth: ConsumerAuthenticator; record: ReturnType<typeof testConsumerRecord> }> {
  return {
    auth: new ConsumerAuthenticator({ registry: testRegistry([record]), audience: AUDIENCE }),
    record,
  };
}

describe('W0-N2 [2a] — private-key-jwt, the Wave 0 default (05 §A.2)', () => {
  it('accepts a correctly signed, audience-bound assertion from an active registration', async () => {
    const keypair = await generateTestConsumerKeypair();
    const { auth } = await authenticateWith(keypair);
    const assertion = await signTestAssertion({
      consumerId: 'test-agent',
      audience: AUDIENCE,
      keypair,
    });

    const result = await auth.authenticate(ConsumerPresentation.privateKeyJwt(assertion), CID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.consumer.record.id).toBe('test-agent');
    expect(result.authMethod).toBe('private-key-jwt');
    expect(result.assertionId).toBeDefined();
  });

  it('refuses an assertion minted for a different gateway (wrong aud)', async () => {
    const keypair = await generateTestConsumerKeypair();
    const { auth } = await authenticateWith(keypair);
    const assertion = await signTestAssertion({
      consumerId: 'test-agent',
      audience: 'https://someone-elses-gateway/mcp',
      keypair,
    });

    expectRefused(
      await auth.authenticate(ConsumerPresentation.privateKeyJwt(assertion), CID),
      'CONSUMER_UNREGISTERED',
    );
  });

  it('refuses an assertion signed by a key that is not in the record', async () => {
    const registered = await generateTestConsumerKeypair('registered');
    const attacker = await generateTestConsumerKeypair('registered'); // same kid, different key
    const { auth } = await authenticateWith(registered);

    const assertion = await signTestAssertion({
      consumerId: 'test-agent',
      audience: AUDIENCE,
      keypair: attacker,
    });

    expectRefused(
      await auth.authenticate(ConsumerPresentation.privateKeyJwt(assertion), CID),
      'CONSUMER_UNREGISTERED',
    );
  });

  it('is single-use: the same assertion cannot be replayed (05 §A.4)', async () => {
    const keypair = await generateTestConsumerKeypair();
    const { auth } = await authenticateWith(keypair);
    const assertion = await signTestAssertion({
      consumerId: 'test-agent',
      audience: AUDIENCE,
      keypair,
      jti: 'fixed-jti',
    });

    const first = await auth.authenticate(ConsumerPresentation.privateKeyJwt(assertion), CID);
    expect(first.ok).toBe(true);

    const replay = await auth.authenticate(ConsumerPresentation.privateKeyJwt(assertion), CID);
    expectRefused(replay, 'CONSUMER_UNREGISTERED');
    if (!replay.ok) expect(replay.error.message).toContain('already been used');
  });

  it('refuses an assertion whose lifetime exceeds the 60s ceiling', async () => {
    const keypair = await generateTestConsumerKeypair();
    const { auth } = await authenticateWith(keypair);
    const iat = Math.floor(Date.now() / 1000);
    const assertion = await signTestAssertion({
      consumerId: 'test-agent',
      audience: AUDIENCE,
      keypair,
      issuedAt: iat,
      expiresAt: iat + 3600,
    });

    const result = await auth.authenticate(ConsumerPresentation.privateKeyJwt(assertion), CID);
    expectRefused(result, 'CONSUMER_UNREGISTERED');
    if (!result.ok) expect(result.error.message).toContain('ceiling');
  });

  it('refuses an assertion whose iss and sub disagree — no signing as one id while claiming another', async () => {
    const keypair = await generateTestConsumerKeypair();
    const { auth } = await authenticateWith(keypair);
    const assertion = await signTestAssertion({
      consumerId: 'test-agent',
      audience: AUDIENCE,
      keypair,
      subject: 'some-other-consumer',
    });

    expectRefused(
      await auth.authenticate(ConsumerPresentation.privateKeyJwt(assertion), CID),
      'CONSUMER_UNREGISTERED',
    );
  });

  it('rejects an unexpected signing algorithm rather than trusting the header', async () => {
    const keypair = await generateTestConsumerKeypair();
    const { auth } = await authenticateWith(keypair);
    // Hand-built compact JWS with alg: none over a payload that would
    // otherwise pass every other check.
    const b64 = (o: object): string => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const none = `${b64({ alg: 'none' })}.${b64({
      iss: 'test-agent',
      sub: 'test-agent',
      aud: AUDIENCE,
      jti: 'none-jti',
      iat: now,
      exp: now + 30,
    })}.`;

    const result = await auth.authenticate(ConsumerPresentation.privateKeyJwt(none), CID);
    expectRefused(result, 'CONSUMER_UNREGISTERED');
    if (!result.ok) expect(result.error.message).toContain('unsupported algorithm');
  });

  it('verifies against either key during a rotation overlap window (05 §A.4 step 6)', async () => {
    const oldKey = await generateTestConsumerKeypair('2026-08-a');
    const newKey = await generateTestConsumerKeypair('2026-11-a');
    const record = testConsumerRecord({
      publicKeys: [
        { kid: oldKey.kid, ...oldKey.publicJwk, addedAt: '2026-08-27' },
        { kid: newKey.kid, ...newKey.publicJwk, addedAt: '2026-11-25' },
      ],
    });
    const auth = new ConsumerAuthenticator({
      registry: testRegistry([record]),
      audience: AUDIENCE,
    });

    for (const keypair of [oldKey, newKey]) {
      const assertion = await signTestAssertion({
        consumerId: 'test-agent',
        audience: AUDIENCE,
        keypair,
      });
      const result = await auth.authenticate(ConsumerPresentation.privateKeyJwt(assertion), CID);
      expect(result.ok).toBe(true);
    }
  });
});

describe('W0-N2 [2a] — the registration is the authority', () => {
  it('refuses when no consumer credential is presented at all — there is no human-only path', async () => {
    const keypair = await generateTestConsumerKeypair();
    const { auth } = await authenticateWith(keypair);
    expectRefused(await auth.authenticate(undefined, CID), 'CONSUMER_UNREGISTERED');
  });

  it('refuses a perfectly signed assertion from a consumer with no registration record', async () => {
    const keypair = await generateTestConsumerKeypair();
    // Registry holds a DIFFERENT consumer. The presented assertion is
    // internally flawless — it simply names software nobody registered.
    const auth = new ConsumerAuthenticator({
      registry: testRegistry([
        testConsumerRecord({
          id: 'someone-else',
          publicKeys: [{ kid: keypair.kid, ...keypair.publicJwk, addedAt: '2026-08-27' }],
        }),
      ]),
      audience: AUDIENCE,
    });
    const assertion = await signTestAssertion({
      consumerId: 'unregistered-agent',
      audience: AUDIENCE,
      keypair,
    });

    expectRefused(
      await auth.authenticate(ConsumerPresentation.privateKeyJwt(assertion), CID),
      'CONSUMER_UNREGISTERED',
    );
  });

  it.each([
    ['suspended', testConsumerRecord({ status: 'suspended' })],
    ['retired', testConsumerRecord({ status: 'retired' })],
    ['expired', testConsumerRecord({ expiresAt: '2020-01-01' })],
  ])(
    'refuses a %s registration with CONSUMER_SUSPENDED, naming its steward',
    async (_label, base) => {
      const keypair = await generateTestConsumerKeypair();
      const record = {
        ...base,
        credential: {
          ...base.credential,
          publicKeys: [{ kid: keypair.kid, ...keypair.publicJwk, addedAt: '2026-08-27' as const }],
        },
      };
      const auth = new ConsumerAuthenticator({
        registry: testRegistry([record]),
        audience: AUDIENCE,
      });
      const assertion = await signTestAssertion({
        consumerId: 'test-agent',
        audience: AUDIENCE,
        keypair,
      });

      const result = await auth.authenticate(ConsumerPresentation.privateKeyJwt(assertion), CID);
      expectRefused(result, 'CONSUMER_SUSPENDED');
      if (!result.ok) expect(result.error.next).toContain('test-steward');
    },
  );

  it('refuses a method downgrade: a private-key-jwt registration cannot present a client secret', async () => {
    const keypair = await generateTestConsumerKeypair();
    const { auth } = await authenticateWith(keypair);

    const result = await auth.authenticate(
      ConsumerPresentation.clientSecret('test-agent', 'anything-at-all'),
      CID,
    );
    expectRefused(result, 'CONSUMER_UNREGISTERED');
    if (!result.ok) expect(result.error.message).toContain('registered for credential.method');
  });

  it('refuses an mtls registration in words, rather than as a mysterious mismatch (05 §A.2)', async () => {
    const keypair = await generateTestConsumerKeypair();
    const record = testConsumerRecord({ method: 'mtls' });
    const auth = new ConsumerAuthenticator({
      registry: testRegistry([record]),
      audience: AUDIENCE,
    });
    const assertion = await signTestAssertion({
      consumerId: 'test-agent',
      audience: AUDIENCE,
      keypair,
    });

    const result = await auth.authenticate(ConsumerPresentation.privateKeyJwt(assertion), CID);
    expectRefused(result, 'CONSUMER_UNREGISTERED');
    if (!result.ok) {
      expect(result.error.message).toContain('mtls');
      expect(result.error.next).toContain('private-key-jwt');
    }
  });
});

describe('W0-N2 [2a] — OIDC corroboration narrows, and never substitutes (02 §11.2)', () => {
  it('refuses when the user token client_id/azp does not match the authenticated consumer', async () => {
    const keypair = await generateTestConsumerKeypair();
    const { auth } = await authenticateWith(keypair);
    const assertion = await signTestAssertion({
      consumerId: 'test-agent',
      audience: AUDIENCE,
      keypair,
    });

    const result = await auth.authenticate(ConsumerPresentation.privateKeyJwt(assertion), CID, {
      clientId: 'some-other-client',
    });
    expectRefused(result, 'CONSUMER_UNREGISTERED');
    if (!result.ok) expect(result.error.message).toContain('client_id/azp');
  });

  it('accepts a matching client_id — but the registration is still what produced the consumer', async () => {
    const keypair = await generateTestConsumerKeypair();
    const { auth } = await authenticateWith(keypair);
    const assertion = await signTestAssertion({
      consumerId: 'test-agent',
      audience: AUDIENCE,
      keypair,
    });

    const result = await auth.authenticate(ConsumerPresentation.privateKeyJwt(assertion), CID, {
      clientId: 'test-agent',
      issuer: 'local',
    });
    expect(result.ok).toBe(true);
  });

  it('a plausible client_id claim with NO registration behind it is still refused — the claim alone is never sufficient', async () => {
    // The registry is EMPTY. The corroborating claim names exactly the
    // consumer the caller wants to be. If the claim could ever stand in for a
    // registration, this is the case that would pass.
    const keypair = await generateTestConsumerKeypair();
    const auth = new ConsumerAuthenticator({ registry: testRegistry([]), audience: AUDIENCE });
    const assertion = await signTestAssertion({
      consumerId: 'claude-desktop-coe',
      audience: AUDIENCE,
      keypair,
    });

    const result = await auth.authenticate(ConsumerPresentation.privateKeyJwt(assertion), CID, {
      clientId: 'claude-desktop-coe',
      issuer: 'ltm-ad',
    });

    expectRefused(result, 'CONSUMER_UNREGISTERED');
    if (!result.ok) expect(result.error.message).toContain('No consumer registration exists');
  });

  it('refuses a user token from an issuer the consumer is not bound to', async () => {
    const keypair = await generateTestConsumerKeypair();
    const { auth } = await authenticateWith(keypair);
    const assertion = await signTestAssertion({
      consumerId: 'test-agent',
      audience: AUDIENCE,
      keypair,
    });

    const result = await auth.authenticate(ConsumerPresentation.privateKeyJwt(assertion), CID, {
      issuer: 'some-other-directory',
    });
    expectRefused(result, 'CONSUMER_UNREGISTERED');
    if (!result.ok) expect(result.error.message).toContain('boundIssuers');
  });
});

describe('W0-N2 [2a] — client-secret, permitted only where 05 §A.2 permits it', () => {
  function verifierStoreWith(consumerId: string): {
    store: ConsumerVerifierStore;
    value: string;
  } {
    const dir = mkdtempSync(join(tmpdir(), 'mcpforge-w0n2-'));
    const store = new LocalVerifierFile(dir);
    const issued = issueConsumerCredential({
      consumerId,
      environmentClass: 'local',
      issuedBy: 'local:tester',
      store,
      env: {},
    });
    return { store, value: issued.value };
  }

  it('accepts the issued value for a read-only, at-most-internal consumer', async () => {
    const { store, value } = verifierStoreWith('secret-agent');
    const record = testConsumerRecord({
      id: 'secret-agent',
      method: 'client-secret',
      writeAllowed: false,
      maxSensitivity: 'internal',
    });
    const auth = new ConsumerAuthenticator({
      registry: testRegistry([record]),
      audience: AUDIENCE,
      verifierStore: store,
    });

    const result = await auth.authenticate(
      ConsumerPresentation.clientSecret('secret-agent', value),
      CID,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.authMethod).toBe('client-secret');
  });

  it('refuses a wrong secret without echoing anything the caller presented', async () => {
    const { store } = verifierStoreWith('secret-agent');
    const record = testConsumerRecord({ id: 'secret-agent', method: 'client-secret' });
    const auth = new ConsumerAuthenticator({
      registry: testRegistry([record]),
      audience: AUDIENCE,
      verifierStore: store,
    });

    const presented = 'not-the-real-secret-0123456789';
    const result = await auth.authenticate(
      ConsumerPresentation.clientSecret('secret-agent', presented),
      CID,
    );
    expectRefused(result, 'CONSUMER_UNREGISTERED');
    if (!result.ok) {
      // CLAUDE.md non-negotiable 8 — no presented value anywhere in the refusal.
      expect(JSON.stringify(result.error.toJSON())).not.toContain(presented);
    }
  });

  it('refuses a client-secret consumer that may write, however valid its secret', async () => {
    const { store, value } = verifierStoreWith('too-powerful');
    const record = testConsumerRecord({
      id: 'too-powerful',
      method: 'client-secret',
      writeAllowed: true,
    });
    const auth = new ConsumerAuthenticator({
      registry: testRegistry([record]),
      audience: AUDIENCE,
      verifierStore: store,
    });

    const result = await auth.authenticate(
      ConsumerPresentation.clientSecret('too-powerful', value),
      CID,
    );
    expectRefused(result, 'CONSUMER_UNREGISTERED');
    if (!result.ok) expect(result.error.next).toContain('private-key-jwt');
  });

  it('refuses a client-secret consumer reaching past internal sensitivity', async () => {
    const { store, value } = verifierStoreWith('too-sensitive');
    const record = testConsumerRecord({
      id: 'too-sensitive',
      method: 'client-secret',
      maxSensitivity: 'financial',
    });
    const auth = new ConsumerAuthenticator({
      registry: testRegistry([record]),
      audience: AUDIENCE,
      verifierStore: store,
    });

    expectRefused(
      await auth.authenticate(ConsumerPresentation.clientSecret('too-sensitive', value), CID),
      'CONSUMER_UNREGISTERED',
    );
  });

  it('refuses when the gateway holds no verifier store at all — absence is a refusal, not a bypass', async () => {
    const record = testConsumerRecord({ id: 'secret-agent', method: 'client-secret' });
    const auth = new ConsumerAuthenticator({
      registry: testRegistry([record]),
      audience: AUDIENCE,
    });

    expectRefused(
      await auth.authenticate(ConsumerPresentation.clientSecret('secret-agent', 'x'), CID),
      'CONSUMER_UNREGISTERED',
    );
  });
});

describe('W0-N2 — reading the presentation off the wire', () => {
  it('prefers the signed assertion, and never takes a consumer id from a header for it', () => {
    const presentation = readConsumerPresentation({
      [MCPFORGE_CONSUMER_ASSERTION_HEADER]: 'a.b.c',
      [MCPFORGE_CONSUMER_ID_HEADER]: 'i-say-i-am-this',
    });
    expect(presentation?.method).toBe('private-key-jwt');
    expect(presentation?.claimedConsumerId).toBeUndefined();
  });

  it('returns undefined when nothing was presented', () => {
    expect(readConsumerPresentation({})).toBeUndefined();
    // A secret with no id, or an id with no secret, is not a presentation.
    expect(readConsumerPresentation({ [MCPFORGE_CONSUMER_ID_HEADER]: 'x' })).toBeUndefined();
    expect(readConsumerPresentation({ [MCPFORGE_CONSUMER_SECRET_HEADER]: 'x' })).toBeUndefined();
  });

  it('redacts credential material when stringified', () => {
    const presentation = ConsumerPresentation.clientSecret('id', 'super-secret-value');
    expect(JSON.stringify(presentation)).not.toContain('super-secret-value');
    expect(presentation.revealSecretForVerification()).toBe('super-secret-value');
  });
});

describe('W0-N2 — the verifier store contract this relies on', () => {
  it('stores a verifier, never the value (W0-N1 credential.ts)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcpforge-w0n2-'));
    const store = new LocalVerifierFile(dir);
    const issued = issueConsumerCredential({
      consumerId: 'v',
      environmentClass: 'local',
      issuedBy: 'local:tester',
      store,
      env: {},
    });
    const entry = store.find(issued.secretRef) as CredentialVerifier;
    expect(JSON.stringify(entry)).not.toContain(issued.value);
  });
});
