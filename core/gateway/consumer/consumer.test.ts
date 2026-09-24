// MCPForge — W0-N1. The consumer record model, the registry, the
// change-proposal path (no direct write), and credential issuance.

import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  DirectWriteRefusedError,
  LocalVerifierFile,
  addDays,
  consumerCredentialRef,
  consumerRecordPath,
  consumerRecordSchema,
  effectiveStatus,
  findConsumer,
  issueConsumerCredential,
  loadConsumerRegistry,
  proposeCredentialRotation,
  proposeRegistration,
  proposeRetirement,
  proposeSuspension,
  refuseIssuance,
  renderConsumerRecord,
  scaffoldConsumerRecord,
  verifyConsumerCredential,
  writeChangeProposal,
  type ConsumerVerifierStore,
  type CredentialVerifier,
} from './index.js';

/** 02 §11.2's worked example, field for field. */
const WORKED_EXAMPLE = {
  apiVersion: 'mcpforge/v1',
  kind: 'Consumer',
  id: 'claude-desktop-coe',
  label: 'Claude Desktop (LTM CoE)',
  class: 'interactive-client',
  owner: 'LTM Oracle AI Practice',
  steward: 'A. Named Person',
  status: 'active',
  expiresAt: '2027-08-27',
  credential: {
    method: 'private-key-jwt',
    ref: 'secretRef://consumer/claude-desktop-coe/client',
    // W0-N2 / 05 §A.4 — the corrected credential block. 02 §11.2's inline
    // example predates the Addendum and shows `ref` alone; 05 §A.5 states the
    // refinement explicitly: "for `private-key-jwt` the record must also carry
    // a `credential.publicKeys[]` array, and validation must require at least
    // one entry". Note the asymmetry 05 §A.4 warns about — `ref` names the
    // consumer's PRIVATE key and the gateway resolves it never; verification
    // is against these PUBLIC keys, which are safe to commit.
    publicKeys: [
      {
        kid: '2026-08-a',
        kty: 'OKP',
        crv: 'Ed25519',
        x: 'O3QTUQQYGH5QTYDE1OwtAT2EvrDums2PzEiiW7I4l50',
        addedAt: '2026-08-27',
      },
    ],
    boundIssuers: ['ltm-ad', 'local'],
    rotation: { intervalDays: 90, lastRotatedAt: '2026-08-27' },
  },
  authorizations: {
    bindingTypes: ['rest', 'wrapped-vendor'],
    maxSensitivity: 'internal',
    writeAllowed: false,
    roles: ['p2p'],
    packages: ['jde-fin'],
  },
  limits: {
    callsPerMinute: 60,
    writesPerDay: 20,
    concurrentSessions: 4,
    operatingWindow: 'Mon-Fri 07:00-20:00 Europe/London',
  },
  attestation: { networkOrigins: ['10.20.0.0/16'], humanInTheLoop: true },
} as const;

function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'forge-consumer-'));
  mkdirSync(join(root, 'consumers'), { recursive: true });
  mkdirSync(join(root, 'approvals'), { recursive: true });
  return root;
}

function writeWorkedExample(root: string, overrides: Record<string, unknown> = {}): void {
  const doc = { ...WORKED_EXAMPLE, ...overrides };
  writeFileSync(
    join(root, consumerRecordPath(String(doc.id))),
    renderConsumerRecord(consumerRecordSchema.parse(doc)),
    'utf8',
  );
}

class MemoryVerifierStore implements ConsumerVerifierStore {
  readonly entries: CredentialVerifier[] = [];
  put(entry: CredentialVerifier): void {
    this.entries.push(entry);
  }
  find(secretRef: string): CredentialVerifier | undefined {
    return this.entries
      .filter((e) => e.secretRef === secretRef)
      .sort((a, b) => b.version - a.version)[0];
  }
}

describe('the record model — 02 §11.2 field for field', () => {
  it('parses the worked example unchanged', () => {
    expect(consumerRecordSchema.parse(WORKED_EXAMPLE)).toMatchObject(WORKED_EXAMPLE);
  });

  it('rejects a credential.ref that is not a secretRef:// URI (CLAUDE.md #8)', () => {
    for (const bad of [
      'sk-live-9f3a2b7c',
      'vault://consumer/x/client',
      'secretRef://consumer',
      '',
    ]) {
      const doc = { ...WORKED_EXAMPLE, credential: { ...WORKED_EXAMPLE.credential, ref: bad } };
      expect(consumerRecordSchema.safeParse(doc).success, bad).toBe(false);
    }
  });

  it('rejects a record lacking owner, steward, expiresAt or humanInTheLoop', () => {
    for (const missing of ['owner', 'steward', 'expiresAt'] as const) {
      const doc: Record<string, unknown> = { ...WORKED_EXAMPLE };
      delete doc[missing];
      expect(consumerRecordSchema.safeParse(doc).success, missing).toBe(false);
    }
    expect(consumerRecordSchema.safeParse({ ...WORKED_EXAMPLE, attestation: {} }).success).toBe(
      false,
    );
  });

  it('treats an active registration past its expiresAt as expired, and never widens', () => {
    expect(effectiveStatus({ status: 'active', expiresAt: '2027-08-27' }, '2026-09-06')).toBe(
      'active',
    );
    expect(effectiveStatus({ status: 'active', expiresAt: '2026-09-05' }, '2026-09-06')).toBe(
      'expired',
    );
    expect(effectiveStatus({ status: 'suspended', expiresAt: '2099-01-01' }, '2026-09-06')).toBe(
      'suspended',
    );
    expect(effectiveStatus({ status: 'retired', expiresAt: '2099-01-01' }, '2026-09-06')).toBe(
      'retired',
    );
  });
});

describe('the registry', () => {
  it('loads a record with its file, its sha and its effective status', () => {
    const root = tempRepo();
    writeWorkedExample(root);
    const registry = loadConsumerRegistry(root, '2026-09-06');
    expect(registry.failures).toEqual([]);
    const found = findConsumer(registry, 'claude-desktop-coe');
    expect(found?.file).toBe('consumers/claude-desktop-coe.consumer.yaml');
    expect(found?.recordSha).toMatch(/^[0-9a-f]{64}$/);
    expect(found?.effectiveStatus).toBe('active');
  });

  it('reports a malformed record as a failure rather than silently skipping it', () => {
    const root = tempRepo();
    writeFileSync(
      join(root, 'consumers/broken.consumer.yaml'),
      'kind: Consumer\nid: broken\n',
      'utf8',
    );
    const registry = loadConsumerRegistry(root, '2026-09-06');
    expect(registry.consumers).toEqual([]);
    expect(registry.failures[0]?.file).toBe('consumers/broken.consumer.yaml');
  });

  it('refuses a record whose id does not match its filename — the id is immutable', () => {
    const root = tempRepo();
    writeFileSync(
      join(root, 'consumers/other-name.consumer.yaml'),
      renderConsumerRecord(consumerRecordSchema.parse(WORKED_EXAMPLE)),
      'utf8',
    );
    const registry = loadConsumerRegistry(root, '2026-09-06');
    expect(registry.consumers).toEqual([]);
    expect(registry.failures[0]?.message).toMatch(/immutable/);
  });
});

describe('the scaffold', () => {
  it('grants nothing by default — every authorization starts empty and narrowest', () => {
    const record = scaffoldConsumerRecord({
      id: 'agent-x',
      consumerClass: 'autonomous-agent',
      label: 'Agent X',
      owner: 'A Team',
      steward: 'A Person',
      humanInTheLoop: false,
      today: '2026-09-06',
    });
    expect(record.authorizations).toEqual({
      bindingTypes: [],
      maxSensitivity: 'public',
      writeAllowed: false,
      roles: [],
      packages: [],
    });
    expect(record.credential.ref).toBe(consumerCredentialRef('agent-x'));
    expect(record.expiresAt).toBe(addDays('2026-09-06', 365));
    expect(record.attestation.humanInTheLoop).toBe(false);
  });

  it('renders deterministically and round-trips through YAML', () => {
    const record = scaffoldConsumerRecord({
      id: 'agent-x',
      consumerClass: 'portal',
      label: 'Agent X',
      owner: 'A Team',
      steward: 'A Person',
      humanInTheLoop: true,
      today: '2026-09-06',
    });
    const yaml = renderConsumerRecord(record);
    expect(renderConsumerRecord(record)).toBe(yaml);
    expect(parseYaml(yaml)).toEqual(record);
    expect(yaml).not.toMatch(/password|client_secret/i);
  });
});

describe('there is no direct-write path (02 §11.2)', () => {
  const actor = { requestedBy: 'u:builder', today: '2026-09-06', now: '2026-09-06T09:00:00.000Z' };

  function snapshot(root: string): string[] {
    return ['consumers', 'approvals'].flatMap((d) =>
      existsSync(join(root, d)) ? readdirSync(join(root, d)).map((f) => `${d}/${f}`) : [],
    );
  }

  it('every lifecycle verb leaves consumers/ and approvals/ untouched', () => {
    const root = tempRepo();
    writeWorkedExample(root);
    const before = snapshot(root);
    const beforeBytes = readFileSync(join(root, consumerRecordPath('claude-desktop-coe')), 'utf8');
    const record = consumerRecordSchema.parse(WORKED_EXAMPLE);

    for (const proposal of [
      proposeRegistration(
        scaffoldConsumerRecord({
          id: 'agent-x',
          consumerClass: 'autonomous-agent',
          label: 'Agent X',
          owner: 'A Team',
          steward: 'A Person',
          humanInTheLoop: false,
          today: '2026-09-06',
        }),
        actor,
      ),
      proposeSuspension(record, { ...actor, reason: 'anomalous burst' }),
      proposeRetirement(record, { ...actor, reason: 'decommissioned' }),
      proposeCredentialRotation(record, actor),
    ]) {
      const written = writeChangeProposal(root, proposal);
      // Every staged path is inside the proposal directory, and nowhere else.
      for (const file of written.files) {
        expect(file.stagedPath.startsWith(written.directory)).toBe(true);
      }
      // Each proposal proposes the record AND its approval record.
      expect(written.files.map((f) => f.targetPath).some((p) => p.startsWith('approvals/'))).toBe(
        true,
      );
      expect(written.files.map((f) => f.targetPath).some((p) => p.startsWith('consumers/'))).toBe(
        true,
      );
    }

    expect(snapshot(root)).toEqual(before);
    expect(readFileSync(join(root, consumerRecordPath('claude-desktop-coe')), 'utf8')).toBe(
      beforeBytes,
    );
  });

  it('refuses to stage a file outside consumers/ or approvals/, and refuses path traversal', () => {
    const root = tempRepo();
    for (const path of [
      'overlays/x.yaml',
      '../escape.yaml',
      'consumers/../../escape.yaml',
      '/etc/passwd',
    ]) {
      expect(() =>
        writeChangeProposal(root, {
          id: 'p1',
          kind: 'consumer-registration',
          consumerId: 'x',
          summary: 's',
          requestedBy: 'u:builder',
          requestedAt: '2026-09-06T09:00:00.000Z',
          files: [{ path, content: 'x' }],
        }),
      ).toThrow(DirectWriteRefusedError);
    }
  });

  it('stages an approval record that is PENDING and names no approver', () => {
    const root = tempRepo();
    const proposal = proposeSuspension(consumerRecordSchema.parse(WORKED_EXAMPLE), {
      ...actor,
      reason: 'anomalous burst',
    });
    const written = writeChangeProposal(root, proposal);
    const approval = written.files.find((f) => f.targetPath.startsWith('approvals/'))!;
    const doc = parseYaml(readFileSync(approval.stagedPath, 'utf8')) as Record<string, unknown>;
    expect(doc['status']).toBe('pending');
    expect(doc['approver']).toBeUndefined();
    expect(doc['approvedAt']).toBeUndefined();
    expect(doc['requestedBy']).toBe('u:builder');
    expect(doc['subject']).toEqual({ kind: 'Consumer', id: 'claude-desktop-coe' });
  });

  it('a suspension proposal proposes status: suspended without changing the record on disk', () => {
    const root = tempRepo();
    writeWorkedExample(root);
    const proposal = proposeSuspension(consumerRecordSchema.parse(WORKED_EXAMPLE), {
      ...actor,
      reason: 'anomalous burst',
    });
    const written = writeChangeProposal(root, proposal);
    const staged = written.files.find((f) => f.targetPath.startsWith('consumers/'))!;
    expect((parseYaml(readFileSync(staged.stagedPath, 'utf8')) as { status: string }).status).toBe(
      'suspended',
    );
    expect(loadConsumerRegistry(root, '2026-09-06').consumers[0]?.record.status).toBe('active');
  });
});

describe('issue-credential (02 §11.2)', () => {
  it('is refused when CI=true', () => {
    expect(refuseIssuance('local', { CI: 'true' })?.reason).toBe('ci');
    expect(() =>
      issueConsumerCredential({
        consumerId: 'agent-x',
        environmentClass: 'local',
        issuedBy: 'u:builder',
        store: new MemoryVerifierStore(),
        env: { CI: 'true' },
      }),
    ).toThrow(/CI=true/);
  });

  it('is refused when the environment class is staging or prod', () => {
    for (const env of ['staging', 'prod'] as const) {
      expect(refuseIssuance(env, {})?.reason).toBe('environment-class');
      expect(() =>
        issueConsumerCredential({
          consumerId: 'agent-x',
          environmentClass: env,
          issuedBy: 'u:builder',
          store: new MemoryVerifierStore(),
          env: {},
        }),
      ).toThrow(new RegExp(env));
    }
  });

  it('mints nothing at all when refused', () => {
    const store = new MemoryVerifierStore();
    expect(() =>
      issueConsumerCredential({
        consumerId: 'agent-x',
        environmentClass: 'prod',
        issuedBy: 'u:builder',
        store,
        env: {},
      }),
    ).toThrow();
    expect(store.entries).toEqual([]);
  });

  it('is allowed in local and probe, and persists a VERIFIER, never the value', () => {
    const store = new MemoryVerifierStore();
    const issued = issueConsumerCredential({
      consumerId: 'agent-x',
      environmentClass: 'local',
      issuedBy: 'u:builder',
      store,
      env: {},
      today: '2026-09-06',
    });
    expect(issued.secretRef).toBe('secretRef://consumer/agent-x/client');
    expect(issued.value.length).toBeGreaterThanOrEqual(32);
    const persisted = JSON.stringify(store.entries);
    expect(persisted).not.toContain(issued.value);
    expect(verifyConsumerCredential(store.entries[0]!, issued.value)).toBe(true);
    expect(verifyConsumerCredential(store.entries[0]!, `${issued.value}x`)).toBe(false);
  });

  it('cannot re-print an issued value: a second issue mints a new one and supersedes the first', () => {
    const root = tempRepo();
    const store = new LocalVerifierFile(root);
    const first = issueConsumerCredential({
      consumerId: 'agent-x',
      environmentClass: 'local',
      issuedBy: 'u:builder',
      store,
      env: {},
    });
    const second = issueConsumerCredential({
      consumerId: 'agent-x',
      environmentClass: 'local',
      issuedBy: 'u:builder',
      store,
      env: {},
    });
    expect(second.value).not.toBe(first.value);
    expect(second.version).toBe(first.version + 1);
    const onDisk = readFileSync(store.path, 'utf8');
    expect(onDisk).not.toContain(first.value);
    expect(onDisk).not.toContain(second.value);
    // Only the newest verifier is kept, and it verifies only the newest value.
    expect(verifyConsumerCredential(store.find(second.secretRef)!, first.value)).toBe(false);
    expect(verifyConsumerCredential(store.find(second.secretRef)!, second.value)).toBe(true);
  });
});
