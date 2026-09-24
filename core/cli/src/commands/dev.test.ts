// MCPForge — W0-N11. `forge dev`'s local bootstrap self-registration.
//
// The failure mode under test is 04 §1.1 Test 2 exactly: a SILENT
// self-registration in an environment that is not local. So the refusal cases
// are the point of this file, and each one asserts two things — a non-zero
// exit with an actionable `next`, AND that nothing was written: no
// consumers/**, no approvals/**, no credential verifier file. A refusal that
// refuses loudly after registering is not a refusal.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { validateRepo } from '@mcpforge/codegen/validate';
import {
  consumerRecordPath,
  effectiveStatus,
  loadConsumerRegistry,
} from '@mcpforge/gateway/consumer';
import {
  BOOTSTRAP_MARKER,
  BOOTSTRAP_REGISTRATION_DAYS,
  PORTAL_LOCAL_CONSUMER_ID,
  resolveEnvironmentClass,
  runDevCommand,
  type DevCommandDeps,
  type DevCommandOptions,
} from './dev.js';

// NEVER process.cwd() — the W0-N3 bug. This suite's own location is the only
// anchor it uses, and every write it makes lands in a fresh temp directory.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

const RECORD_PATH = consumerRecordPath(PORTAL_LOCAL_CONSUMER_ID);
const VERIFIER_FILE = join('.mcpforge', 'consumer-credential-verifiers.json');

function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'forge-dev-cli-'));
  mkdirSync(join(root, 'consumers'), { recursive: true });
  mkdirSync(join(root, 'approvals'), { recursive: true });
  return root;
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

/** A deliberately clean environment: no CI, no MCPFORGE_ENV, nothing inherited. */
function cleanEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...overrides };
}

function run(
  root: string,
  opts: Partial<DevCommandOptions> = {},
  deps: Partial<DevCommandDeps> = {},
): { status: number; out: string; err: string } {
  const c = capture();
  const status = runDevCommand(
    { json: true, ...opts },
    {
      repoRoot: root,
      env: cleanEnv(),
      today: '2026-09-07',
      ...deps,
      stdout: c.deps.stdout,
      stderr: c.deps.stderr,
    },
  );
  return { status, out: c.out.join(''), err: c.err.join('') };
}

function wroteNothing(root: string): void {
  expect(readdirSync(join(root, 'consumers'))).toEqual([]);
  expect(readdirSync(join(root, 'approvals'))).toEqual([]);
  expect(existsSync(join(root, VERIFIER_FILE))).toBe(false);
}

describe('the environment-class gate refuses everything that is not local', () => {
  for (const envClass of ['probe', 'staging', 'prod'] as const) {
    it(`refuses --env ${envClass}, exits non-zero, and writes nothing`, () => {
      const root = tempRepo();
      const { status, out } = run(root, { env: envClass });
      expect(status).not.toBe(0);
      const parsed = JSON.parse(out.trim());
      expect(parsed.ok).toBe(false);
      expect(parsed.code).toBe('DEV_BOOTSTRAP_REFUSED');
      expect(parsed.reason).toBe('environment-class');
      expect(parsed.message).toContain(envClass);
      expect(parsed.next.length).toBeGreaterThan(0);
      expect(parsed.next).not.toMatch(/try again/i);
      wroteNothing(root);
    });

    it(`refuses MCPFORGE_ENV=${envClass} with no --env flag at all`, () => {
      const root = tempRepo();
      const { status, out } = run(root, {}, { env: cleanEnv({ MCPFORGE_ENV: envClass }) });
      expect(status).not.toBe(0);
      expect(JSON.parse(out.trim()).reason).toBe('environment-class');
      wroteNothing(root);
    });
  }

  it('refuses when CI=true even though the environment class is local', () => {
    const root = tempRepo();
    const { status, out } = run(root, { env: 'local' }, { env: cleanEnv({ CI: 'true' }) });
    expect(status).not.toBe(0);
    const parsed = JSON.parse(out.trim());
    expect(parsed.code).toBe('DEV_BOOTSTRAP_REFUSED');
    expect(parsed.reason).toBe('ci');
    expect(parsed.message).toContain('CI=true');
    wroteNothing(root);
  });

  it('checks CI before the environment class, so CI=true in prod is still refused', () => {
    const root = tempRepo();
    const { status, out } = run(root, { env: 'prod' }, { env: cleanEnv({ CI: 'true' }) });
    expect(status).not.toBe(0);
    expect(JSON.parse(out.trim()).code).toBe('DEV_BOOTSTRAP_REFUSED');
    wroteNothing(root);
  });

  // The fail-OPEN cases. Each of these is a value that a naive
  // `(opts.env || 'local')` would silently treat as local.
  // Surrounding whitespace IS trimmed, deliberately and safely: trimming can
  // only ever map a value onto itself minus padding, so it cannot turn a
  // non-local value into `local`. Case is NOT normalised and no prefix,
  // suffix or near-miss is accepted.
  for (const bad of ['', '   ', 'Local', 'LOCAL', 'production', 'localhost', 'dev', 'local,prod']) {
    it(`refuses the unrecognised environment class ${JSON.stringify(bad)} rather than defaulting to local`, () => {
      const root = tempRepo();
      const { status, out } = run(root, { env: bad });
      expect(status).not.toBe(0);
      const parsed = JSON.parse(out.trim());
      expect(parsed.ok).toBe(false);
      expect(parsed.code).toBe('INPUT_INVALID');
      expect(parsed.next.length).toBeGreaterThan(0);
      wroteNothing(root);
    });
  }

  it('resolveEnvironmentClass returns local only for an absent or exactly-spelled value', () => {
    expect(resolveEnvironmentClass(undefined, {})).toBe('local');
    expect(resolveEnvironmentClass('local', {})).toBe('local');
    expect(resolveEnvironmentClass(undefined, { MCPFORGE_ENV: 'local' })).toBe('local');
    // --env beats MCPFORGE_ENV, and the stricter of the two never widens.
    expect(resolveEnvironmentClass('prod', { MCPFORGE_ENV: 'local' })).toBe('prod');
    for (const bad of ['Local', 'staging;', 'x', '']) {
      const r = resolveEnvironmentClass(bad, {});
      expect(typeof r === 'object' && r.ok === false).toBe(true);
    }
    // Whitespace is trimmed, and trimming is direction-safe: padding a
    // non-local class never yields `local`.
    expect(resolveEnvironmentClass(' local ', {})).toBe('local');
    expect(resolveEnvironmentClass(' prod ', {})).toBe('prod');
  });
});

describe('the local case actually registers portal-local', () => {
  it('writes an ordinary consumers/ artefact on a clean clone', () => {
    const root = tempRepo();
    const { status, out } = run(root, { env: 'local' });
    expect(status).toBe(0);
    const parsed = JSON.parse(out.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.consumerId).toBe(PORTAL_LOCAL_CONSUMER_ID);
    expect(parsed.created).toBe(true);
    expect(parsed.file).toBe(RECORD_PATH);
    expect(existsSync(join(root, ...RECORD_PATH.split('/')))).toBe(true);
  });

  it('with neither --env nor MCPFORGE_ENV set — the clean-clone path — it registers', () => {
    const root = tempRepo();
    const { status } = run(root, {});
    expect(status).toBe(0);
    expect(existsSync(join(root, ...RECORD_PATH.split('/')))).toBe(true);
  });

  it('the record loads through the ORDINARY registry read path, as an active registration', () => {
    const root = tempRepo();
    run(root, { env: 'local' });
    const registry = loadConsumerRegistry(root, '2026-09-07');
    expect(registry.failures).toEqual([]);
    expect(registry.consumers).toHaveLength(1);
    const loaded = registry.consumers[0]!;
    expect(loaded.record.id).toBe(PORTAL_LOCAL_CONSUMER_ID);
    expect(loaded.record.kind).toBe('Consumer');
    expect(loaded.record.class).toBe('portal');
    expect(loaded.file).toBe(RECORD_PATH);
    expect(loaded.effectiveStatus).toBe('active');
  });

  it('the written record passes forge validate', () => {
    const root = tempRepo();
    run(root, { env: 'local' });
    const failures = validateRepo(root).failures.filter((f) => f.file.startsWith('consumers/'));
    expect(failures).toEqual([]);
  });

  it('grants nothing: no binding type, no role, no package, no write, narrowest sensitivity', () => {
    const root = tempRepo();
    run(root, { env: 'local' });
    const doc = parseYaml(readFileSync(join(root, ...RECORD_PATH.split('/')), 'utf8'));
    expect(doc.authorizations.bindingTypes).toEqual([]);
    expect(doc.authorizations.roles).toEqual([]);
    expect(doc.authorizations.packages).toEqual([]);
    expect(doc.authorizations.writeAllowed).toBe(false);
    expect(doc.authorizations.maxSensitivity).toBe('public');
    expect(doc.limits.writesPerDay).toBe(0);
  });

  it('carries only a secretRef, never a credential value, in the git artefact', () => {
    const root = tempRepo();
    const { out } = run(root, { env: 'local' });
    const text = readFileSync(join(root, ...RECORD_PATH.split('/')), 'utf8');
    expect(text).toContain(`secretRef://consumer/${PORTAL_LOCAL_CONSUMER_ID}/client`);
    const value = JSON.parse(out.trim()).credentialValue as string;
    expect(typeof value).toBe('string');
    expect(value.length).toBeGreaterThan(0);
    expect(text).not.toContain(value);
    // Nor anywhere else under the repo root that git would see.
    expect(readFileSync(join(root, VERIFIER_FILE), 'utf8')).not.toContain(value);
  });
});

describe('the expiry is genuinely short and genuinely visible', () => {
  it('expires one day out, not the 365-day registration default', () => {
    const root = tempRepo();
    const { out } = run(root, { env: 'local' }, { today: '2026-09-07' });
    const parsed = JSON.parse(out.trim());
    expect(BOOTSTRAP_REGISTRATION_DAYS).toBe(1);
    expect(parsed.expiresInDays).toBe(1);
    expect(parsed.expiresAt).toBe('2026-09-08');
    const doc = parseYaml(readFileSync(join(root, ...RECORD_PATH.split('/')), 'utf8'));
    expect(doc.expiresAt).toBe('2026-09-08');
    // Not the 365-day default and not the 90-day rotation interval.
    expect(doc.expiresAt).not.toBe('2027-09-07');
    expect(doc.expiresAt).not.toBe('2026-12-06');
  });

  it('the expiry is enforced, not decorative: the record is expired the day after next', () => {
    const root = tempRepo();
    run(root, { env: 'local' }, { today: '2026-09-07' });
    expect(loadConsumerRegistry(root, '2026-09-08').consumers[0]!.effectiveStatus).toBe('active');
    expect(loadConsumerRegistry(root, '2026-09-09').consumers[0]!.effectiveStatus).toBe('expired');
    const doc = parseYaml(readFileSync(join(root, ...RECORD_PATH.split('/')), 'utf8'));
    expect(effectiveStatus(doc, '2026-09-09')).toBe('expired');
  });

  it('the expiry and the reason for it are visible in the file a human reads', () => {
    const root = tempRepo();
    run(root, { env: 'local' }, { today: '2026-09-07' });
    const text = readFileSync(join(root, ...RECORD_PATH.split('/')), 'utf8');
    expect(text).toContain(BOOTSTRAP_MARKER);
    expect(text).toContain('expiresAt: 2026-09-08');
    expect(text).toContain('no human approved');
  });

  it('a later boot refreshes the expiry rather than letting it run out under a working developer', () => {
    const root = tempRepo();
    run(root, { env: 'local' }, { today: '2026-09-07' });
    const second = run(root, { env: 'local' }, { today: '2026-09-20' });
    const parsed = JSON.parse(second.out.trim());
    expect(second.status).toBe(0);
    expect(parsed.created).toBe(false);
    expect(parsed.expiresAt).toBe('2026-09-21');
    // The credential is minted once, not re-minted on every boot.
    expect(parsed.credentialValue).toBeUndefined();
  });
});

describe('it will not clobber a reviewed grant', () => {
  it('refuses when consumers/portal-local.consumer.yaml exists without the bootstrap marker', () => {
    const root = tempRepo();
    run(root, { env: 'local' });
    const abs = join(root, ...RECORD_PATH.split('/'));
    const reviewed = readFileSync(abs, 'utf8').split(BOOTSTRAP_MARKER).join('# reviewed grant');
    writeFileSync(abs, reviewed, 'utf8');

    const { status, out } = run(root, { env: 'local' }, { today: '2026-09-20' });
    expect(status).not.toBe(0);
    const parsed = JSON.parse(out.trim());
    expect(parsed.code).toBe('REGISTRY_CONFLICT');
    expect(parsed.next.length).toBeGreaterThan(0);
    // Untouched, byte for byte.
    expect(readFileSync(abs, 'utf8')).toBe(reviewed);
  });
});

describe('the command surface', () => {
  it('does not claim to have started any server process', () => {
    const root = tempRepo();
    const { out } = run(root, { env: 'local' });
    expect(JSON.parse(out.trim()).serversStarted).toBe(false);
  });

  it('this suite never writes into the real repository', () => {
    expect(existsSync(join(repoRoot, ...RECORD_PATH.split('/')))).toBe(false);
  });
});
