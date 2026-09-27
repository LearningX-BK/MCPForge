// W0-P24. The portal's `private-key-jwt` assertion, checked by the gateway's
// REAL `[2a]` gate rather than by a restatement of it: the key is minted and
// written by the same functions `forge consumer issue-credential` uses, the
// record is the committed `portal-local` record with the staged proposal
// applied, and the verdict is `ConsumerAuthenticator`'s own.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  mintConsumerKeypair,
  proposePrivateKeyJwtKey,
  writeConsumerPrivateKeyFile,
  PORTAL_CONSUMER_KEY_FILE as GATEWAY_PORTAL_KEY_FILE,
} from '@mcpforge/gateway/consumer';
import { loadConsumerRegistry } from '@mcpforge/gateway/consumer/records';
import {
  ConsumerAuthenticator,
  ConsumerPresentation,
  MCPFORGE_CONSUMER_ASSERTION_HEADER,
} from '@mcpforge/gateway/transport';
import { resolveRepoRoot } from '../../app/build/_lib/repo-root';
import {
  ASSERTION_LIFETIME_SECONDS,
  CONSUMER_ASSERTION_HEADER,
  ConsumerCredentialError,
  PORTAL_CONSUMER_ID,
  PORTAL_CONSUMER_KEY_FILE,
  consumerAssertionHeaders,
  loadPortalConsumerKey,
} from './consumer-assertion';

const AUDIENCE = 'https://mcpforge.local/mcp';
const TODAY = '2026-09-27';
const REPO = resolveRepoRoot();

/** A scratch repo holding the committed portal-local record, with the key proposal applied or not. */
function world(options: { applyProposal: boolean }) {
  const root = mkdtempSync(path.join(tmpdir(), 'mcpforge-p24-'));
  const committed = loadConsumerRegistry(REPO, TODAY).consumers.find(
    (c) => c.record.id === PORTAL_CONSUMER_ID,
  );
  if (committed === undefined) throw new Error('consumers/portal-local.consumer.yaml is missing');

  const minted = mintConsumerKeypair({ consumerId: PORTAL_CONSUMER_ID, today: TODAY });
  writeConsumerPrivateKeyFile(root, PORTAL_CONSUMER_KEY_FILE, minted.privateKey);

  const proposal = proposePrivateKeyJwtKey(committed.record, minted.publicKey, {
    requestedBy: 'test-proposer',
    today: TODAY,
    now: `${TODAY}T00:00:00.000Z`,
  });
  const recordFile = proposal.files.find((f) => f.path.startsWith('consumers/'))!;
  mkdirSync(path.join(root, 'consumers'), { recursive: true });
  writeFileSync(
    path.join(root, recordFile.path),
    options.applyProposal
      ? recordFile.content
      : readFileSync(path.join(REPO, committed.file), 'utf8'),
    'utf8',
  );
  const registry = loadConsumerRegistry(root, TODAY);
  return { root, minted, proposal, registry };
}

async function present(root: string, registry: ReturnType<typeof loadConsumerRegistry>) {
  const headers = await consumerAssertionHeaders({ repoRoot: root, audience: AUDIENCE, env: {} });
  const authenticator = new ConsumerAuthenticator({ registry, audience: AUDIENCE });
  const assertion = headers[CONSUMER_ASSERTION_HEADER]!;
  return { assertion, authenticator };
}

describe('the portal consumer assertion (W0-P24)', () => {
  it('names the header and the key file exactly as the gateway and the CLI do', () => {
    expect(CONSUMER_ASSERTION_HEADER).toBe(MCPFORGE_CONSUMER_ASSERTION_HEADER);
    expect(PORTAL_CONSUMER_KEY_FILE).toBe(GATEWAY_PORTAL_KEY_FILE);
  });

  it('authenticates as portal-local at the gateway once the key proposal is merged', async () => {
    const { root, registry } = world({ applyProposal: true });
    expect(registry.failures).toEqual([]);
    const { assertion, authenticator } = await present(root, registry);

    const result = await authenticator.authenticate(
      ConsumerPresentation.privateKeyJwt(assertion),
      'corr-p24',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.consumer.record.id).toBe(PORTAL_CONSUMER_ID);
    expect(result.authMethod).toBe('private-key-jwt');
  });

  it('is refused by the gateway before the proposal is merged: the committed record is client-secret', async () => {
    const { root, registry } = world({ applyProposal: false });
    const { assertion, authenticator } = await present(root, registry);
    const result = await authenticator.authenticate(
      ConsumerPresentation.privateKeyJwt(assertion),
      'corr-p24',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONSUMER_UNREGISTERED');
    expect(result.error.next).toMatch(/change proposal against consumers\/portal-local/);
  });

  it('mints a fresh, single-use, 60-second assertion per call; a replay is refused', async () => {
    const { root, registry, minted } = world({ applyProposal: true });
    const { assertion, authenticator } = await present(root, registry);
    const second = (
      await consumerAssertionHeaders({ repoRoot: root, audience: AUDIENCE, env: {} })
    )[CONSUMER_ASSERTION_HEADER]!;

    const claims = decodeJwt(assertion);
    expect(decodeProtectedHeader(assertion).kid).toBe(minted.publicKey.kid);
    expect(claims.iss).toBe(PORTAL_CONSUMER_ID);
    expect(claims.sub).toBe(PORTAL_CONSUMER_ID);
    expect(claims.aud).toBe(AUDIENCE);
    expect(claims.exp! - claims.iat!).toBe(ASSERTION_LIFETIME_SECONDS);
    expect(decodeJwt(second).jti).not.toBe(claims.jti);

    const first = await authenticator.authenticate(
      ConsumerPresentation.privateKeyJwt(assertion),
      'c1',
    );
    const replay = await authenticator.authenticate(
      ConsumerPresentation.privateKeyJwt(assertion),
      'c2',
    );
    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(false);
  });

  it('an assertion for another gateway does not verify here', async () => {
    const { root, registry } = world({ applyProposal: true });
    const headers = await consumerAssertionHeaders({
      repoRoot: root,
      audience: 'https://some-other-gateway/mcp',
      env: {},
    });
    const result = await new ConsumerAuthenticator({ registry, audience: AUDIENCE }).authenticate(
      ConsumerPresentation.privateKeyJwt(headers[CONSUMER_ASSERTION_HEADER]!),
      'corr-p24',
    );
    expect(result.ok).toBe(false);
  });

  it('with no key file, refuses with CONSUMER_KEY_MISSING and names the issue command', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mcpforge-p24-empty-'));
    const err = await loadPortalConsumerKey({ repoRoot: root, env: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConsumerCredentialError);
    expect((err as ConsumerCredentialError).code).toBe('CONSUMER_KEY_MISSING');
    expect((err as ConsumerCredentialError).next).toMatch(
      /forge consumer issue-credential portal-local --method private-key-jwt/,
    );
  });

  it('refuses a key issued to a different consumer, and never echoes key material', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mcpforge-p24-other-'));
    const other = mintConsumerKeypair({ consumerId: 'test-agent-1', today: TODAY });
    writeConsumerPrivateKeyFile(root, PORTAL_CONSUMER_KEY_FILE, other.privateKey);
    const err = (await loadPortalConsumerKey({ repoRoot: root, env: {} }).catch(
      (e: unknown) => e,
    )) as ConsumerCredentialError;
    expect(err.code).toBe('CONSUMER_KEY_INVALID');
    expect(`${err.message} ${err.next}`).not.toContain(other.privateKey.privateJwk.d);
  });

  it('holds no secret store: the module imports nothing from the gateway at runtime', () => {
    const code = readFileSync(path.join(__dirname, 'consumer-assertion.ts'), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');
    expect(code).toMatch(/from 'jose'/); // control: the scan sees the real imports
    expect(code).not.toMatch(/from '@mcpforge\/gateway/);
    expect(code).not.toMatch(/SecretStore|secretRef:\/\//);
  });
});
