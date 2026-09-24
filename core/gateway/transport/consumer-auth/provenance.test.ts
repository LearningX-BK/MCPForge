// MCPForge — W0-N10's provenance half: `consumer_record_sha` is the sha of the
// registration IN FORCE AT THAT CALL, captured at `[2a]` and never recomputed
// downstream (02 §11.3).
//
// Every authentication here is a REAL one: the testkit builds inputs, and
// `ConsumerAuthenticator` accepts or refuses them on its own terms. There is no
// synthesised success branch, which is the same discipline
// `./consumer-auth.test.ts` keeps.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConsumerRegistry } from '../../consumer/registry.js';
import { ConsumerAuthenticator } from './authenticate.js';
import { ConsumerPresentation } from './presentation.js';
import { consumerSessionProvenance } from './provenance.js';
import {
  generateTestConsumerKeypair,
  signTestAssertion,
  testConsumerRecord,
  testRegistry,
} from './testkit.js';

const AUDIENCE = 'https://gateway.local/mcp';

const tempDirs: string[] = [];
function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcpforge-provenance-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

async function authenticateOnce(id = 'test-agent') {
  const keypair = await generateTestConsumerKeypair();
  const record = testConsumerRecord({
    id,
    publicKeys: [{ kid: keypair.kid, ...keypair.publicJwk, addedAt: '2026-08-27' }],
  });
  const authenticator = new ConsumerAuthenticator({
    registry: testRegistry([record]),
    audience: AUDIENCE,
  });
  const assertion = await signTestAssertion({ consumerId: id, audience: AUDIENCE, keypair });
  const result = await authenticator.authenticate(
    ConsumerPresentation.privateKeyJwt(assertion),
    'corr-1',
  );
  if (!result.ok) throw new Error(`fixture failed to authenticate: ${result.error.code}`);
  return result;
}

describe('W0-N10: consumerSessionProvenance', () => {
  it('carries the authenticated id, the record sha, the auth method and the session id', async () => {
    const auth = await authenticateOnce();
    const provenance = consumerSessionProvenance(auth, 'mcp-session-abc');

    expect(provenance.consumerId).toBe('test-agent');
    expect(provenance.recordSha).toMatch(/^[0-9a-f]{64}$/);
    expect(provenance.recordSha).toBe(auth.consumer.recordSha);
    expect(provenance.authMethod).toBe('private-key-jwt');
    expect(provenance.consumerSessionId).toBe('mcp-session-abc');
  });

  it('the id comes from the VERIFIED registration, not from anything the caller said', async () => {
    const auth = await authenticateOnce('claude-desktop-coe');
    const provenance = consumerSessionProvenance(auth, 'mcp-session-abc');
    // `auth.consumer` is the `LoadedConsumer` the registry produced; the id on
    // the provenance is that record's id, so a client that signed as one
    // consumer cannot appear in the trail as another.
    expect(provenance.consumerId).toBe(auth.consumer.record.id);
  });

  it('refuses to mint provenance without a real record sha rather than defaulting one', async () => {
    const auth = await authenticateOnce();
    const blanked = { ...auth, consumer: { ...auth.consumer, recordSha: '' } };
    expect(() => consumerSessionProvenance(blanked, 'mcp-session-abc')).toThrow(
      /may not be defaulted, blanked or recomputed later/,
    );
  });

  it('is frozen, so nothing downstream can rewrite the sha the session was authenticated under', async () => {
    const auth = await authenticateOnce();
    const provenance = consumerSessionProvenance(auth, 'mcp-session-abc');
    expect(Object.isFrozen(provenance)).toBe(true);
    expect(() => {
      (provenance as { recordSha: string }).recordSha = 'c'.repeat(64);
    }).toThrow();
    expect(provenance.recordSha).toBe(auth.consumer.recordSha);
  });
});

describe('W0-N10: the sha is the registration IN FORCE AT THE CALL', () => {
  it('amending consumers/<id>.consumer.yaml after authentication does not change the session provenance', async () => {
    // A real on-disk registry: the sha is over the file's exact bytes
    // (`../../consumer/registry.ts`), which is what makes it a version pin.
    const repoRoot = tempRepo();
    mkdirSync(join(repoRoot, 'consumers'), { recursive: true });
    const file = join(repoRoot, 'consumers', 'test-agent.consumer.yaml');

    // Serialised from the same record shape the testkit builds, so the fixture
    // is schema-valid by construction rather than by hand-transcription.
    const keypair = await generateTestConsumerKeypair();
    const monday = stringifyYaml(
      testConsumerRecord({
        id: 'test-agent',
        publicKeys: [{ kid: keypair.kid, ...keypair.publicJwk, addedAt: '2026-08-27' }],
      }),
    );
    writeFileSync(file, monday, 'utf8');

    const loaded = loadConsumerRegistry(repoRoot);
    const before = loaded.consumers.find((c) => c.record.id === 'test-agent');
    expect(before, `fixture record did not load: ${JSON.stringify(loaded.failures)}`).toBeDefined();
    // This is the value a session authenticated on Monday would freeze.
    const capturedOnMonday = before!.recordSha;

    // Tuesday: the registration is widened by a reviewed change proposal.
    writeFileSync(file, monday.replace('writeAllowed: false', 'writeAllowed: true'), 'utf8');
    const after = loadConsumerRegistry(repoRoot).consumers.find((c) => c.record.id === 'test-agent');

    // The registry now reports a DIFFERENT sha — so the sha genuinely tracks
    // the record's content, and a captured one is a real version pin...
    expect(after!.recordSha).not.toBe(capturedOnMonday);
    // ...and the value Monday's session froze is untouched by Tuesday's edit.
    // A row carrying `capturedOnMonday` therefore still names the exact bytes
    // of the authorizations that were in force when the call was made.
    expect(capturedOnMonday).toMatch(/^[0-9a-f]{64}$/);
    expect(after!.record.authorizations.writeAllowed).toBe(true);
    expect(before!.record.authorizations.writeAllowed).toBe(false);
  });
});
