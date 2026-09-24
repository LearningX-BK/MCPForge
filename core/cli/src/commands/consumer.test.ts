// MCPForge — W0-N1. `forge consumer` and the `forge validate` clauses of its
// `done:` criterion.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { validateRepo } from '@mcpforge/codegen/validate';
import { runConsumerCommand, type ConsumerCommandOptions } from './consumer.js';
import { CANONICAL_COMMANDS, commandLabel } from '../commands.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** 02 §11.2's worked example, verbatim, as YAML. */
const WORKED_EXAMPLE_YAML = `apiVersion: mcpforge/v1
kind: Consumer
id: claude-desktop-coe
label: Claude Desktop (LTM CoE)
class: interactive-client
owner: LTM Oracle AI Practice
steward: A. Named Person
status: active
expiresAt: 2027-08-27

credential:
  method: private-key-jwt
  ref: secretRef://consumer/claude-desktop-coe/client
  # W0-N2 / 05 §A.4 — gateway-side verification material. PUBLIC by design:
  # the private half never leaves the consumer's machine, and the gateway
  # resolves the ref above never. 05 §A.5 requires at least one entry for
  # method: private-key-jwt.
  publicKeys:
    - kid: 2026-08-a
      kty: OKP
      crv: Ed25519
      x: O3QTUQQYGH5QTYDE1OwtAT2EvrDums2PzEiiW7I4l50
      addedAt: 2026-08-27
  boundIssuers: [ltm-ad, local]
  rotation: { intervalDays: 90, lastRotatedAt: 2026-08-27 }

authorizations:
  bindingTypes: [rest, wrapped-vendor]
  maxSensitivity: internal
  writeAllowed: false
  roles:    [p2p]
  packages: [jde-fin]

limits:
  callsPerMinute: 60
  writesPerDay: 20
  concurrentSessions: 4
  operatingWindow: "Mon-Fri 07:00-20:00 Europe/London"

attestation:
  networkOrigins: [10.20.0.0/16]
  humanInTheLoop: true
`;

function tempRepo(consumerYaml?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'forge-consumer-cli-'));
  mkdirSync(join(root, 'consumers'), { recursive: true });
  mkdirSync(join(root, 'approvals'), { recursive: true });
  // The real roles/ and packages/ so the Consumer's referential rules resolve.
  cpSync(join(repoRoot, 'roles'), join(root, 'roles'), { recursive: true });
  cpSync(join(repoRoot, 'packages'), join(root, 'packages'), { recursive: true });
  if (consumerYaml !== undefined) {
    writeFileSync(
      join(root, 'consumers', 'claude-desktop-coe.consumer.yaml'),
      consumerYaml,
      'utf8',
    );
  }
  return root;
}

/** Failures `forge validate` reports against the consumer record itself. */
function consumerFailures(root: string): { path: string; ruleId: string; message: string }[] {
  return validateRepo(root)
    .failures.filter((f) => f.file.startsWith('consumers/'))
    .map((f) => ({ path: f.path, ruleId: f.ruleId, message: f.message }));
}

function capture(): {
  out: string[];
  err: string[];
  deps: { stdout: (t: string) => void; stderr: (t: string) => void };
} {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, deps: { stdout: (t) => out.push(t), stderr: (t) => err.push(t) } };
}

function opts(overrides: Partial<ConsumerCommandOptions> = {}): ConsumerCommandOptions {
  return { json: true, ...overrides };
}

// -----------------------------------------------------------------------------

describe('forge validate and the kind: Consumer record (02 §11.2)', () => {
  it('accepts the 02 §11.2 worked example field for field', () => {
    expect(consumerFailures(tempRepo(WORKED_EXAMPLE_YAML))).toEqual([]);
  });

  it('rejects a credential.ref that is not a secretRef:// URI', () => {
    for (const bad of ['sk-live-9f3a2b7c', 'vault://consumer/claude-desktop-coe/client', '""']) {
      const yaml = WORKED_EXAMPLE_YAML.replace(
        'ref: secretRef://consumer/claude-desktop-coe/client',
        `ref: ${bad}`,
      );
      const failures = consumerFailures(tempRepo(yaml));
      expect(
        failures.map((f) => f.path),
        bad,
      ).toContain('/credential/ref');
      expect(
        failures.map((f) => f.ruleId),
        bad,
      ).toContain('policy.consumer-credential-ref');
    }
  });

  it('rejects a record that lacks an owner', () => {
    const yaml = WORKED_EXAMPLE_YAML.replace('owner: LTM Oracle AI Practice\n', '');
    const failures = consumerFailures(tempRepo(yaml));
    expect(failures.length).toBeGreaterThan(0);
    expect(JSON.stringify(failures)).toMatch(/owner/);
  });

  it('rejects a record that lacks an expiresAt — registrations EXPIRE', () => {
    const yaml = WORKED_EXAMPLE_YAML.replace('expiresAt: 2027-08-27\n', '');
    const failures = consumerFailures(tempRepo(yaml));
    expect(failures.length).toBeGreaterThan(0);
    expect(JSON.stringify(failures)).toMatch(/expiresAt/);
  });
});

describe('the command surface', () => {
  it('names all seven consumer verbs CLAUDE.md §7 lists', () => {
    const labels = CANONICAL_COMMANDS.map(commandLabel);
    for (const verb of ['new', 'list', 'show', 'suspend', 'rotate', 'retire', 'issue-credential']) {
      expect(labels).toContain(`consumer ${verb}`);
    }
  });
});

describe('forge consumer list | show', () => {
  it('lists nothing on a fresh repo and exits 0', () => {
    const { out, deps } = capture();
    expect(runConsumerCommand('list', opts(), { repoRoot: tempRepo(), ...deps })).toBe(0);
    expect(JSON.parse(out.join(''))).toEqual({ ok: true, consumers: [], failures: [] });
  });

  it('shows the record with its credential REFERENCE and no value anywhere', () => {
    const { out, deps } = capture();
    const root = tempRepo(WORKED_EXAMPLE_YAML);
    expect(
      runConsumerCommand('show', opts({ target: 'claude-desktop-coe' }), {
        repoRoot: root,
        ...deps,
      }),
    ).toBe(0);
    const payload = JSON.parse(out.join('')) as {
      consumer: { credential: { ref: string }; effectiveStatus: string };
    };
    expect(payload.consumer.credential.ref).toBe('secretRef://consumer/claude-desktop-coe/client');
    expect(payload.consumer['effectiveStatus']).toBe('active');
    expect(JSON.stringify(payload)).not.toMatch(/secret['"]?\s*:\s*['"][A-Za-z0-9_-]{16,}/);
  });

  it('refuses an unregistered id with CONSUMER_UNREGISTERED and an actionable next', () => {
    const { out, deps } = capture();
    const code = runConsumerCommand('show', opts({ target: 'nobody' }), {
      repoRoot: tempRepo(),
      ...deps,
    });
    expect(code).toBe(1);
    const err = JSON.parse(out.join('')) as { code: string; next: string };
    expect(err.code).toBe('CONSUMER_UNREGISTERED');
    expect(err.next).toMatch(/forge consumer new|Dynamic Client Registration/);
    expect(err.next).not.toMatch(/try again/i);
  });
});

describe('forge consumer new — a change proposal, never a write', () => {
  const base = {
    class: 'autonomous-agent',
    owner: 'LTM Oracle AI Practice',
    steward: 'A. Named Person',
    humanInTheLoop: 'false',
    by: 'u:builder',
  };

  it('requires --by, --class, --owner, --steward and an explicit --human-in-the-loop', () => {
    const root = tempRepo();
    for (const missing of ['by', 'class', 'owner', 'steward', 'humanInTheLoop'] as const) {
      const { out, deps } = capture();
      const o: Record<string, unknown> = { ...base, target: 'agent-x', json: true };
      delete o[missing];
      expect(
        runConsumerCommand('new', o as unknown as ConsumerCommandOptions, {
          repoRoot: root,
          ...deps,
        }),
        missing,
      ).toBe(64);
      const err = JSON.parse(out.join('')) as { code: string; next: string };
      expect(err.code).toBe('INPUT_INVALID');
      expect(err.next.length).toBeGreaterThan(0);
    }
  });

  it('stages the record and its pending approval record, writing nothing to consumers/ or approvals/', () => {
    const root = tempRepo();
    const { out, deps } = capture();
    const code = runConsumerCommand('new', opts({ ...base, target: 'agent-x' }), {
      repoRoot: root,
      today: '2026-09-06',
      now: '2026-09-06T09:00:00.000Z',
      ...deps,
    });
    expect(code).toBe(0);
    const payload = JSON.parse(out.join('')) as {
      files: { target: string; staged: string }[];
      state: string;
    };
    expect(payload.state).toBe('draft');
    expect(payload.files.map((f) => f.target)).toEqual([
      'consumers/agent-x.consumer.yaml',
      'approvals/2026-09-06-consumer-agent-x-register.yaml',
    ]);
    // Staged, not applied.
    expect(readdirSync(join(root, 'consumers'))).toEqual([]);
    expect(readdirSync(join(root, 'approvals'))).toEqual([]);
    for (const f of payload.files) expect(existsSync(f.staged)).toBe(true);

    // And the staged record passes `forge validate` once a reviewer applies it
    // — with ONE outstanding requirement, which is 05 §A.4's ordering and not
    // a defect (W0-N2). The runbook is: (1) `forge consumer new` scaffolds,
    // (2) `forge consumer issue-credential` generates the Ed25519 keypair on
    // the consumer's own machine and writes the PUBLIC half into the record,
    // (3) the record is proposed. Between (1) and (2) a `private-key-jwt`
    // registration has no public key, and `forge validate` says so by name:
    // the gateway verifies against `credential.publicKeys[]` and resolves
    // `credential.ref` never (05 §A.4/§A.5). A scaffold that validated clean
    // here would be a registration that can never authenticate, merged.
    const applied = tempRepo();
    const staged = payload.files.find((f) => f.target.startsWith('consumers/'))!;
    const scaffolded = readFileSync(staged.staged, 'utf8');
    writeFileSync(join(applied, staged.target), scaffolded, 'utf8');
    const beforeIssue = validateRepo(applied).failures.filter((f) =>
      f.file.startsWith('consumers/'),
    );
    expect(beforeIssue.length).toBeGreaterThan(0);
    expect(beforeIssue.every((f) => f.path === '/credential')).toBe(true);
    expect(beforeIssue.map((f) => f.message).join(' ')).toMatch(/publicKeys/);

    // Step (2) done: the same record, now carrying the public key that
    // `issue-credential` emits, validates clean.
    writeFileSync(
      join(applied, staged.target),
      scaffolded.replace(
        /^(\s*)ref: (secretRef:\/\/\S+)$/m,
        [
          '$1ref: $2',
          '$1publicKeys:',
          '$1  - kid: 2026-09-a',
          '$1    kty: OKP',
          '$1    crv: Ed25519',
          '$1    x: O3QTUQQYGH5QTYDE1OwtAT2EvrDums2PzEiiW7I4l50',
          '$1    addedAt: "2026-09-06"',
        ].join('\n'),
      ),
      'utf8',
    );
    expect(validateRepo(applied).failures.filter((f) => f.file.startsWith('consumers/'))).toEqual(
      [],
    );
  });

  it('refuses to register an id that already exists — ids are immutable', () => {
    const { out, deps } = capture();
    const code = runConsumerCommand('new', opts({ ...base, target: 'claude-desktop-coe' }), {
      repoRoot: tempRepo(WORKED_EXAMPLE_YAML),
      ...deps,
    });
    expect(code).toBe(64);
    expect(JSON.parse(out.join(''))['next']).toMatch(/immutable/);
  });
});

describe('forge consumer suspend | retire | rotate', () => {
  it.each([
    ['suspend', 'suspended'],
    ['retire', 'retired'],
  ] as const)(
    '%s stages the status change and leaves the record on disk untouched',
    (verb, status) => {
      const root = tempRepo(WORKED_EXAMPLE_YAML);
      const before = readFileSync(join(root, 'consumers/claude-desktop-coe.consumer.yaml'), 'utf8');
      const { out, deps } = capture();
      const code = runConsumerCommand(
        verb,
        opts({ target: 'claude-desktop-coe', by: 'u:builder', reason: 'anomalous burst' }),
        { repoRoot: root, today: '2026-09-06', ...deps },
      );
      expect(code).toBe(0);
      const payload = JSON.parse(out.join('')) as { files: { target: string; staged: string }[] };
      const staged = payload.files.find((f) => f.target.startsWith('consumers/'))!;
      expect((parseYaml(readFileSync(staged.staged, 'utf8')) as { status: string }).status).toBe(
        status,
      );
      expect(readFileSync(join(root, 'consumers/claude-desktop-coe.consumer.yaml'), 'utf8')).toBe(
        before,
      );
      expect(readdirSync(join(root, 'approvals'))).toEqual([]);
    },
  );

  it('suspend and retire require a stated reason', () => {
    const root = tempRepo(WORKED_EXAMPLE_YAML);
    for (const verb of ['suspend', 'retire'] as const) {
      const { out, deps } = capture();
      expect(
        runConsumerCommand(verb, opts({ target: 'claude-desktop-coe', by: 'u:builder' }), {
          repoRoot: root,
          ...deps,
        }),
      ).toBe(64);
      expect(JSON.parse(out.join(''))['message']).toMatch(/--reason/);
    }
  });

  it('rotate moves only the schedule, and never carries a value', () => {
    const root = tempRepo(WORKED_EXAMPLE_YAML);
    const { out, deps } = capture();
    expect(
      runConsumerCommand('rotate', opts({ target: 'claude-desktop-coe', by: 'u:builder' }), {
        repoRoot: root,
        today: '2026-09-06',
        ...deps,
      }),
    ).toBe(0);
    const payload = JSON.parse(out.join('')) as { files: { target: string; staged: string }[] };
    const staged = payload.files.find((f) => f.target.startsWith('consumers/'))!;
    const doc = parseYaml(readFileSync(staged.staged, 'utf8')) as {
      credential: { ref: string; rotation: { lastRotatedAt: string } };
    };
    expect(doc.credential.rotation.lastRotatedAt).toBe('2026-09-06');
    expect(doc.credential.ref).toBe('secretRef://consumer/claude-desktop-coe/client');
  });
});

describe('forge consumer issue-credential', () => {
  const args = { target: 'claude-desktop-coe', by: 'u:builder' };

  it('prints the value exactly once, and never a second time', () => {
    const root = tempRepo(WORKED_EXAMPLE_YAML);
    const first = capture();
    expect(
      runConsumerCommand('issue-credential', opts(args), {
        repoRoot: root,
        env: {},
        today: '2026-09-06',
        ...first.deps,
      }),
    ).toBe(0);
    const payload = JSON.parse(first.out.join('')) as {
      value: string;
      secretRef: string;
      version: number;
    };
    expect(payload.secretRef).toBe('secretRef://consumer/claude-desktop-coe/client');

    // Exactly once: the value appears in that one emission and in no other
    // output, and nothing on disk contains it.
    const occurrences = first.out.join('').split(payload.value).length - 1;
    expect(occurrences).toBe(1);
    const verifiers = readFileSync(
      join(root, '.mcpforge', 'consumer-credential-verifiers.json'),
      'utf8',
    );
    expect(verifiers).not.toContain(payload.value);

    // `show` and `list` cannot re-print it.
    const after = capture();
    runConsumerCommand('show', opts(args), { repoRoot: root, ...after.deps });
    runConsumerCommand('list', opts(), { repoRoot: root, ...after.deps });
    expect(after.out.join('')).not.toContain(payload.value);

    // Re-issuing mints a different value, it does not reveal the old one.
    const second = capture();
    runConsumerCommand('issue-credential', opts(args), {
      repoRoot: root,
      env: {},
      today: '2026-09-06',
      ...second.deps,
    });
    const reissued = JSON.parse(second.out.join('')) as { value: string; version: number };
    expect(reissued.value).not.toBe(payload.value);
    expect(reissued.version).toBe(payload.version + 1);
    expect(second.out.join('')).not.toContain(payload.value);
  });

  it('is refused when CI=true, and mints nothing', () => {
    const root = tempRepo(WORKED_EXAMPLE_YAML);
    const { out, deps } = capture();
    const code = runConsumerCommand('issue-credential', opts(args), {
      repoRoot: root,
      env: { CI: 'true' },
      ...deps,
    });
    expect(code).toBe(64);
    const err = JSON.parse(out.join('')) as { code: string; next: string; message: string };
    expect(err.code).toBe('ISSUE_CREDENTIAL_REFUSED');
    expect(err.message).toMatch(/CI=true/);
    expect(err.next).not.toMatch(/try again/i);
    expect(existsSync(join(root, '.mcpforge', 'consumer-credential-verifiers.json'))).toBe(false);
  });

  it('is refused when the environment class is staging or prod, and mints nothing', () => {
    for (const env of ['staging', 'prod'] as const) {
      const root = tempRepo(WORKED_EXAMPLE_YAML);
      const { out, deps } = capture();
      const code = runConsumerCommand('issue-credential', opts({ ...args, env }), {
        repoRoot: root,
        env: {},
        ...deps,
      });
      expect(code).toBe(64);
      expect(JSON.parse(out.join(''))['message']).toMatch(new RegExp(env));
      expect(existsSync(join(root, '.mcpforge', 'consumer-credential-verifiers.json'))).toBe(false);
    }
  });

  it('is refused for an unregistered consumer, and for one that is not active', () => {
    const { out, deps } = capture();
    expect(
      runConsumerCommand('issue-credential', opts(args), {
        repoRoot: tempRepo(),
        env: {},
        ...deps,
      }),
    ).toBe(1);
    expect(JSON.parse(out.join(''))['code']).toBe('CONSUMER_UNREGISTERED');

    const suspended = tempRepo(WORKED_EXAMPLE_YAML.replace('status: active', 'status: suspended'));
    const second = capture();
    expect(
      runConsumerCommand('issue-credential', opts(args), {
        repoRoot: suspended,
        env: {},
        ...second.deps,
      }),
    ).toBe(1);
    expect(JSON.parse(second.out.join(''))['code']).toBe('CONSUMER_NOT_ACTIVE');

    const expired = tempRepo(
      WORKED_EXAMPLE_YAML.replace('expiresAt: 2027-08-27', 'expiresAt: 2026-01-01'),
    );
    const third = capture();
    expect(
      runConsumerCommand('issue-credential', opts(args), {
        repoRoot: expired,
        env: {},
        today: '2026-09-06',
        ...third.deps,
      }),
    ).toBe(1);
    expect(JSON.parse(third.out.join(''))['next']).toMatch(/re-approval/);
  });
});
