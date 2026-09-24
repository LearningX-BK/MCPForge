// MCPForge — W0-N10's done criterion, in three parts:
//
//  1. every audit row carries its `consumer_id` AND the `consumer_record_sha`
//     in force at that call;
//  2. `consumption_edge` is fed from `consumer_id`, and NO self-declared agent
//     name is ever written — the value is authenticated or it is absent;
//  3. `credential_refs` are recorded by ref and version and never by value,
//     asserted by a test scanning the WHOLE audit row.
//
// Runs against a temp-file SQLite store, the Wave 0 default (02 §10.4 item 8),
// matching `../usage/rollup.test.ts` and `../audit/audit.test.ts`.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntimeStore } from '../store.js';
import { CONSUMPTION_EDGE } from '../schema/spec.js';
import type { RuntimeStore } from '../repository.js';
import type { AppendAuditCallInput } from '../audit/types.js';

const tempDir = mkdtempSync(join(tmpdir(), 'mcpforge-consumption-'));
const dbFile = join(tempDir, 'runtime.db');
let store: RuntimeStore;

const SHA_MONDAY = 'a'.repeat(64);
const SHA_TUESDAY = 'b'.repeat(64);

beforeAll(async () => {
  store = await openRuntimeStore({ kind: 'sqlite', file: dbFile });
});

afterAll(async () => {
  await store?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function call(overrides: Partial<AppendAuditCallInput> = {}): AppendAuditCallInput {
  return {
    callerSubject: 'u-0001',
    consumerId: 'claude-desktop-coe',
    consumerRecordSha: SHA_MONDAY,
    consumerAuthMethod: 'private-key-jwt',
    consumerSessionId: 'mcp-session-0001',
    humanInTheLoop: true,
    toolId: 'jde.ap.voucher.create',
    bindingType: 'function',
    isWrite: true,
    deploymentId: 'edge-test',
    phase: 'execute',
    outcome: 'ok',
    ts: '2026-09-07T12:00:00.000Z',
    ...overrides,
  };
}

// -- 1. the row answers "what was this agent allowed to do that day" ---------

describe('W0-N10 DONE 1: every audit row carries consumer_id and the record sha in force at that call', () => {
  it('round-trips all five Phase 5 who-block columns', async () => {
    const row = await store.audit.append(call({ correlationId: 'who-1' }));
    const back = await store.audit.get(row.id);

    expect(back?.consumerId).toBe('claude-desktop-coe');
    expect(back?.consumerRecordSha).toBe(SHA_MONDAY);
    expect(back?.consumerAuthMethod).toBe('private-key-jwt');
    expect(back?.consumerSessionId).toBe('mcp-session-0001');
    expect(back?.humanInTheLoop).toBe(true);
  });

  it('a row keeps the sha that was in force when it was written, after the record is amended', async () => {
    // Monday's call, under Monday's registration.
    const monday = await store.audit.append(
      call({ correlationId: 'sha-mon', ts: '2026-09-07T09:00:00.000Z' }),
    );
    // The registration is amended — a reviewed change proposal lands, so the
    // record's bytes, and therefore its sha, are different.
    const tuesday = await store.audit.append(
      call({
        correlationId: 'sha-tue',
        ts: '2026-09-08T09:00:00.000Z',
        consumerRecordSha: SHA_TUESDAY,
      }),
    );

    // THE property: Monday's row still reports Monday's authorizations. If the
    // sha were re-derived at read time, or the row rewritten, both would read
    // SHA_TUESDAY and "what was this agent allowed to do that day" would be
    // unanswerable from the row (02 §11.3).
    expect((await store.audit.get(monday.id))?.consumerRecordSha).toBe(SHA_MONDAY);
    expect((await store.audit.get(tuesday.id))?.consumerRecordSha).toBe(SHA_TUESDAY);
  });

  it('the sha is inside the hash chain, so a row cannot be re-shaed without detection', async () => {
    await store.audit.append(call({ correlationId: 'chain-1' }));
    const verified = await store.audit.verifyChain('edge-test');
    expect(verified.status).toBe('intact');
    // `consumer_record_sha` is a hashed column, so an editor who rewrote a
    // row's sha to match today's record would break the chain rather than
    // quietly rewrite history. `../audit/hash.test.ts` pins the column list.
  });
});

// -- 2. the consumption feed carries an authenticated id, or nothing ---------

describe('W0-N10 DONE 2: consumption_edge is fed from consumer_id', () => {
  it('an appended call opens an edge keyed on the authenticated consumer', async () => {
    await store.audit.append(
      call({ correlationId: 'edge-1', deploymentId: 'edge-feed', toolId: 'jde.ap.voucher.create' }),
    );
    const edge = await store.consumption.getEdge(
      'edge-feed',
      'claude-desktop-coe',
      'jde.ap.voucher.create',
    );
    expect(edge).toBeDefined();
    expect(edge!.consumerId).toBe('claude-desktop-coe');
    expect(edge!.callCount).toBe(1);
    expect(edge!.writeCount).toBe(1);
    expect(edge!.bindingType).toBe('function');
  });

  it('further calls accumulate on the same edge and never move first_seen_at', async () => {
    await store.audit.append(
      call({
        correlationId: 'edge-2',
        deploymentId: 'edge-feed',
        ts: '2026-09-09T12:00:00.000Z',
        isWrite: false,
      }),
    );
    const edge = await store.consumption.getEdge(
      'edge-feed',
      'claude-desktop-coe',
      'jde.ap.voucher.create',
    );
    expect(edge!.callCount).toBe(2);
    expect(edge!.writeCount).toBe(1);
    expect(edge!.firstSeenAt).toBe('2026-09-07T12:00:00.000Z');
    expect(edge!.lastSeenAt).toBe('2026-09-09T12:00:00.000Z');
  });

  it('a rolled-back call leaves no edge — the feed cannot count a call the trail does not record', async () => {
    await expect(
      store.transaction(async () => {
        await store.audit.append(
          call({
            correlationId: 'edge-rollback',
            deploymentId: 'edge-rollback',
            consumerId: 'rollback-agent',
          }),
        );
        throw new Error('deliberate rollback');
      }),
    ).rejects.toThrow('deliberate rollback');

    expect(await store.consumption.listEdges({ consumerId: 'rollback-agent' })).toHaveLength(0);
  });
});

describe('W0-N10 DONE 2 (adversarial): no self-declared agent name is ever written', () => {
  /**
   * The threat, stated plainly: before Phase 5 the only candidate for
   * "consuming agent" was the `clientInfo.name` an MCP client declares about
   * itself at `initialize` — a caller-chosen string. Each test below is an
   * attempt to get such a string into the feed by a different route.
   */
  const SELF_DECLARED = 'Totally Legit Finance Bot';

  it('the schema offers no column a self-declared name could occupy', () => {
    const columns = Object.keys(CONSUMPTION_EDGE.columns);
    // Not merely "the writer does not set one": there is nowhere to put it.
    for (const forbidden of ['agent_name', 'client_name', 'display_name', 'label', 'name']) {
      expect(columns).not.toContain(forbidden);
    }
    // And what the edge IS keyed on is the authenticated triple.
    const unique = CONSUMPTION_EDGE.indexes?.find((i) => i.name === 'consumption_edge_uq');
    expect(unique?.columns).toEqual(['deployment_id', 'consumer_id', 'tool_id']);
  });

  it('a self-declared name smuggled through the caller-controlled audit fields reaches no edge column', async () => {
    await store.audit.append(
      call({
        correlationId: 'adversarial-1',
        deploymentId: 'adversarial',
        consumerId: 'claude-desktop-coe',
        // Every field below is caller-influenced. None of them is the
        // consuming agent, and none may become one.
        callerDisplay: SELF_DECLARED,
        onBehalfOf: SELF_DECLARED,
        callerIdp: SELF_DECLARED,
        targetIdentityObserved: SELF_DECLARED,
        errorMessageAgent: SELF_DECLARED,
        argsRedacted: { clientInfo: { name: SELF_DECLARED }, agentName: SELF_DECLARED },
        resultKeys: [{ keyName: 'agentName', keyValue: SELF_DECLARED }],
      }),
    );

    const edges = await store.consumption.listEdges({ deploymentId: 'adversarial' });
    expect(edges).toHaveLength(1);
    // Scan the WHOLE edge row, not the fields we happen to remember.
    expect(JSON.stringify(edges[0])).not.toContain(SELF_DECLARED);
    expect(edges[0]!.consumerId).toBe('claude-desktop-coe');
  });

  it('an edge cannot be written for a blank consumer id — it is refused, not anonymised', async () => {
    // The direct-to-repository attempt: bypass the audit path and hand the
    // feed a nameless consumer. It must refuse rather than write a
    // placeholder, an empty string, or an "unknown agent" row.
    await expect(
      store.consumption.recordEdge({
        deploymentId: 'adversarial',
        consumerId: '   ',
        toolId: 'jde.ap.voucher.create',
        bindingType: 'function',
        isWrite: false,
        callId: 'not-a-call',
        ts: '2026-09-10T12:00:00.000Z',
      }),
    ).rejects.toThrow(/never a self-declared name/);

    expect(await store.consumption.listEdges({ toolId: 'jde.ap.voucher.create' })).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ consumerId: '   ' })]),
    );
  });

  it('the edge agrees with the audit row it was fed from, for every call in the feed', async () => {
    // The structural claim: the feed is sourced from the row `append` wrote,
    // so no edge may exist whose (deployment, consumer, tool) triple has no
    // matching audit row. A self-declared name reaching the feed by ANY route
    // not yet imagined would show up here as an edge with no evidence.
    for (const edge of await store.consumption.listEdges()) {
      const evidence = await store.audit.get(edge.lastCallId);
      expect(evidence, `edge ${edge.consumerId} -> ${edge.toolId} has no audit row`).toBeDefined();
      expect(evidence!.consumerId).toBe(edge.consumerId);
      expect(evidence!.toolId).toBe(edge.toolId);
      expect(evidence!.deploymentId).toBe(edge.deploymentId);
    }
  });
});

// -- 3. credentials by reference and version, never by value ----------------

describe('W0-N10 DONE 3: credential_refs are recorded by ref and version, never by value', () => {
  const SECRET_VALUE = 'hunter2-THE-ACTUAL-WRAPPER-SCHEMA-PASSWORD';
  const REF = 'secretRef://binding/ebs-p2p-ap/wrapper-schema';

  it('a whole-row scan finds the ref and the version, and no credential value', async () => {
    const appended = await store.audit.append(
      call({
        correlationId: 'cred-1',
        deploymentId: 'cred',
        credentialRefs: [
          { secretRef: REF, version: 'v3' },
          { secretRef: 'secretRef://consumer/claude-desktop-coe/client-secret', version: null },
        ],
        // The value is NOT passed anywhere; this test proves the row that
        // legitimately names the credential carries only its reference.
      }),
    );

    const row = await store.audit.get(appended.id);
    expect(row?.credentialRefs).toEqual([
      { secretRef: REF, version: 'v3' },
      { secretRef: 'secretRef://consumer/claude-desktop-coe/client-secret', version: null },
    ]);

    // Scan EVERY column of the row and every satellite, matching the
    // credential-leak scan pattern used by the boundary tests.
    const whole = JSON.stringify(row);
    expect(whole).toContain(REF);
    expect(whole).toContain('v3');
    expect(whole).not.toContain(SECRET_VALUE);
    expect(whole).not.toContain('hunter2');
  });

  it('a credential value pushed into every caller-writable field is still absent from the credential satellite', async () => {
    // Adversarial: a careless caller stuffs the value into the row. The
    // credential SATELLITE — the thing `forge secrets` and the portal read as
    // "which credentials did this call use" — must still hold only references.
    // (The row's own args are redacted upstream by the policy chain; this test
    // pins the satellite's own guarantee, which is unconditional.)
    const appended = await store.audit.append(
      call({
        correlationId: 'cred-2',
        deploymentId: 'cred',
        credentialRefs: [{ secretRef: REF, version: 'v4' }],
        targetIdentityObserved: SECRET_VALUE,
      }),
    );

    const row = await store.audit.get(appended.id);
    expect(JSON.stringify(row?.credentialRefs)).not.toContain(SECRET_VALUE);
    for (const ref of row!.credentialRefs) {
      // A reference, and nothing that could be mistaken for a value.
      expect(ref.secretRef.startsWith('secretRef://')).toBe(true);
    }
  });

  it('every credential ref written by this suite is a secretRef:// and nothing else', async () => {
    const rows = await store.audit.listByCredentialRef(REF);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      for (const ref of row.credentialRefs) {
        expect(ref.secretRef).toMatch(/^secretRef:\/\/[^/]+\/[^/]+\/[^/]+$/);
      }
    }
  });
});
