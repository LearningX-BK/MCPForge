// MCPForge — `forge secrets status | rotate | revoke`. W0-N6, 02 §11.5 rules 5 and 6.
//
// CLAUDE.md §7 names this surface verbatim:
//
//   forge secrets status --json          age and next-due for every ref
//   forge secrets rotate <ref>           dual-key overlap on the HMAC and signing keys
//   forge secrets revoke <ref> --reason  invalidates AND kill-switches every dependent
//
// It is added to `commands.ts` on exactly the precedent W0-N1 set when it added
// the `consumer` surface: an addition the Phase 5 correction (02 §11.5) requires,
// not a re-opening of W0-A5's canonical list.
//
// **The command formats; it does not implement.** `buildRotationReport`,
// `DualKeyRing` and `revokeSecret` live in `core/gateway/secrets/**` — an
// `OPUS_GUARDED_PATHS` tree — and this file is argument handling, the error
// taxonomy and human/JSON rendering, the same split `./kill.ts` and
// `./audit.ts` already use. That matters more here than elsewhere: a CLI that
// re-derived "is this credential overdue" would be a second definition of
// overdue, and the portal's Governance screen reads the first one.
//
// **Nothing in this file resolves a credential value.** `status` walks
// `list()` and `metadata()`, both the safe-to-log half of the seam;
// `rotate` mints inside the store and never sees the result; `revoke`
// destroys. `SecretStore.get()` is not imported, not called, and could not
// legally be called from here anyway (02 §11.5 rule 2, lint rule
// `no-secret-value-escape`).
//
// **Exit codes.** 0 success · 64 usage/INPUT_INVALID, this CLI's established
// convention · 1 for `status` when a ref is past 2x its rotation interval,
// which is the `done:` criterion's own requirement and the shape a CI job or a
// cron wrapper can act on without parsing anything.

import { openRuntimeStore, storeConfigFromEnv, type RuntimeStore } from '@mcpforge/gateway/store/server';
import {
  EncryptedFileStore,
  ROTATION_INTERVAL_DAYS,
  SecretRefError,
  SecretStoreError,
  SecretRevocationError,
  buildRotationReport,
  parseSecretRef,
  revokeSecret,
  type SecretRef,
  type SecretStore,
  type SecretsRotationReport,
} from '@mcpforge/gateway/secrets/server';
import { findRepoRoot } from '@mcpforge/ci';

export type SecretsVerb = 'status' | 'rotate' | 'revoke';

export interface SecretsOptions {
  readonly json: boolean;
  /** The `secretRef://…` positional. Required by `rotate` and `revoke`. */
  readonly target?: string;
  readonly reason?: string;
  readonly by?: string;
  readonly root?: string;
  readonly deployment?: string;
}

export interface SecretsCliError {
  readonly ok: false;
  readonly code: 'INPUT_INVALID';
  readonly verb: SecretsVerb;
  readonly message: string;
  readonly next: string;
}

export interface SecretsStatusEnvelope extends SecretsRotationReport {
  readonly ok: true;
  readonly verb: 'status';
}

export interface SecretsRotateEnvelope {
  readonly ok: true;
  readonly verb: 'rotate';
  readonly ref: string;
  readonly version: number;
  readonly rotatedAt: string | null;
  readonly nextDueAt: string;
  readonly intervalDays: number;
  /**
   * Set for the two gateway signing refs, so the operator is told — in the
   * output of the act itself — that in-flight tokens keep verifying. Null for
   * every other ref, because claiming an overlap window for a credential that
   * has none would be worse than saying nothing.
   */
  readonly overlapNote: string | null;
}

export interface SecretsRevokeEnvelope {
  readonly ok: true;
  readonly verb: 'revoke';
  readonly ref: string;
  readonly reason: string;
  readonly by: string;
  readonly valueInvalidated: boolean;
  readonly killed: readonly {
    readonly kind: 'tool' | 'consumer';
    readonly id: string;
    readonly killTarget: string;
    readonly file: string;
    readonly flagId: string;
    readonly auditCallId: string;
  }[];
}

export interface SecretsRevokeFailureEnvelope {
  readonly ok: false;
  readonly code: 'REVOCATION_REFUSED';
  readonly verb: 'revoke';
  readonly ref: string;
  readonly message: string;
  readonly next: string;
  readonly valueInvalidated: false;
  readonly killed: readonly string[];
}

const USAGE_EXIT_CODE = 64;
const OVERDUE_EXIT_CODE = 1;
const DEFAULT_DEPLOYMENT_ID = 'default';

/**
 * The two gateway signing refs that rotate with a dual-key overlap window
 * (02 §11.5 rule 5). Duplicated as strings rather than imported as parsed refs
 * only so the note below can be a pure lookup; the refs themselves are defined
 * once, in `core/gateway/secrets/rotation.ts`.
 */
const OVERLAP_NOTES: Readonly<Record<string, string>> = {
  'secretRef://gateway/confirm-token/hmac':
    "Dual-key overlap: the retired key VERIFIES but no longer SIGNS, for one plan TTL plus a margin. Confirm tokens already in a human's hands still execute; every token minted from now on carries the new kid.",
  'secretRef://gateway/local-issuer/jwt-signing':
    'Dual-key overlap (JWKS-style): the retired key VERIFIES but no longer SIGNS, for one token TTL plus a margin. Sessions already holding a token stay valid; every token issued from now on carries the new kid.',
};

function usageError(verb: SecretsVerb, message: string): SecretsCliError {
  return {
    ok: false,
    code: 'INPUT_INVALID',
    verb,
    message,
    next:
      verb === 'status'
        ? 'Run "forge secrets status [--root <dir>] [--json]".'
        : verb === 'rotate'
          ? 'Run "forge secrets rotate <secretRef://scope/subject/purpose> [--root <dir>] [--json]".'
          : 'Run "forge secrets revoke <secretRef://scope/subject/purpose> --reason \\"...\\" --by <subject> [--deployment <id>] [--json]".',
  };
}

function emitError(error: SecretsCliError, json: boolean): number {
  if (json) {
    process.stdout.write(`${JSON.stringify(error)}\n`);
  } else {
    process.stderr.write(`forge: secrets ${error.verb} — ${error.message}\n`);
    process.stderr.write(`forge: next — ${error.next}\n`);
  }
  return USAGE_EXIT_CODE;
}

function parseRefArgument(verb: SecretsVerb, raw: string | undefined): SecretRef | SecretsCliError {
  if (raw === undefined || raw.trim().length === 0) {
    return usageError(
      verb,
      'A secretRef:// is required — a credential is never addressed by anything but its reference (02 §11.5).',
    );
  }
  try {
    return parseSecretRef(raw.trim());
  } catch (err) {
    if (err instanceof SecretRefError) {
      return { ok: false, code: 'INPUT_INVALID', verb, message: err.message, next: err.next };
    }
    throw err;
  }
}

function isCliError(value: unknown): value is SecretsCliError {
  return typeof value === 'object' && value !== null && (value as SecretsCliError).ok === false;
}

function formatStatusHuman(report: SecretsStatusEnvelope): string {
  const lines = [
    `forge secrets status — ${report.secrets.length} ref(s) in the ${report.storeKind} store`,
    `  ok: ${report.counts.ok}  ·  overdue: ${report.counts.overdue}  ·  past 2x interval: ${report.counts.critical}`,
    '',
  ];
  if (report.secrets.length === 0) {
    lines.push('  (no credentials stored)');
  }
  for (const s of report.secrets) {
    const mark = s.state === 'ok' ? ' ' : s.state === 'overdue' ? '!' : 'X';
    lines.push(
      `  ${mark} ${s.ref}`,
      `      v${s.version} · age ${s.ageDays}d of a ${s.intervalDays}d interval · next due ${s.nextDueAt} (${s.daysUntilDue}d)`,
    );
  }
  if (report.anyCritical) {
    lines.push(
      '',
      '  At least one credential is past TWICE its rotation interval (02 §11.5 rule 5).',
      '  next — rotate each ref marked X with "forge secrets rotate <ref>". Rotation may not be silently skipped;',
      '         this command exits non-zero until every X is cleared.',
    );
  }
  return lines.join('\n');
}

export interface SecretsCommandDeps {
  /** Injected by tests so they run against an isolated vault. */
  readonly secretStore?: SecretStore;
  /** Injected by tests so kill switches land in an isolated runtime store. */
  readonly openStore?: () => Promise<RuntimeStore>;
  readonly repoRoot?: string;
  readonly now?: () => Date;
}

function resolveRoot(opts: SecretsOptions, deps: SecretsCommandDeps): string {
  return deps.repoRoot ?? opts.root ?? findRepoRoot();
}

function resolveSecretStore(repoRoot: string, deps: SecretsCommandDeps): SecretStore {
  return deps.secretStore ?? new EncryptedFileStore({ repoRoot });
}

async function runStatus(opts: SecretsOptions, deps: SecretsCommandDeps): Promise<number> {
  const repoRoot = resolveRoot(opts, deps);
  const store = resolveSecretStore(repoRoot, deps);
  const now = (deps.now ?? (() => new Date()))();
  const report = await buildRotationReport(store, now);
  const envelope: SecretsStatusEnvelope = { ok: true, verb: 'status', ...report };
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
  } else {
    process.stdout.write(`${formatStatusHuman(envelope)}\n`);
  }
  // The `done:` criterion: non-zero when any ref is past 2x its interval.
  return report.anyCritical ? OVERDUE_EXIT_CODE : 0;
}

async function runRotate(opts: SecretsOptions, deps: SecretsCommandDeps): Promise<number> {
  const parsed = parseRefArgument('rotate', opts.target);
  if (isCliError(parsed)) return emitError(parsed, opts.json);
  const ref = parsed;

  const repoRoot = resolveRoot(opts, deps);
  const store = resolveSecretStore(repoRoot, deps);
  const now = (deps.now ?? (() => new Date()))();

  try {
    await store.rotate(ref);
  } catch (err) {
    if (err instanceof SecretStoreError) {
      return emitError(
        { ok: false, code: 'INPUT_INVALID', verb: 'rotate', message: err.message, next: err.next },
        opts.json,
      );
    }
    throw err;
  }

  const metadata = await store.metadata(ref);
  const intervalDays = ROTATION_INTERVAL_DAYS[ref.scope];
  const anchor = Date.parse(metadata.rotatedAt ?? metadata.createdAt);
  const envelope: SecretsRotateEnvelope = {
    ok: true,
    verb: 'rotate',
    ref: ref.uri,
    version: metadata.version,
    rotatedAt: metadata.rotatedAt ?? null,
    nextDueAt: new Date(anchor + intervalDays * 86_400_000).toISOString(),
    intervalDays,
    overlapNote: OVERLAP_NOTES[ref.uri] ?? null,
  };
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
  } else {
    process.stdout.write(
      [
        `forge secrets rotate: OK`,
        `  ref: ${envelope.ref}`,
        `  new version: ${envelope.version} (rotated ${envelope.rotatedAt ?? now.toISOString()})`,
        `  next due: ${envelope.nextDueAt} (${envelope.intervalDays}-day interval)`,
        ...(envelope.overlapNote ? [`  ${envelope.overlapNote}`] : []),
        `  The new value was minted inside the store and was never returned to this process.`,
      ].join('\n') + '\n',
    );
  }
  return 0;
}

async function runRevoke(opts: SecretsOptions, deps: SecretsCommandDeps): Promise<number> {
  const parsed = parseRefArgument('revoke', opts.target);
  if (isCliError(parsed)) return emitError(parsed, opts.json);
  const ref = parsed;

  const reason = opts.reason?.trim();
  if (!reason) {
    return emitError(
      usageError('revoke', '--reason is required and must be non-empty.'),
      opts.json,
    );
  }
  const by = opts.by?.trim();
  if (!by) {
    return emitError(
      usageError(
        'revoke',
        '--by <subject> is required — there is no default acting identity for a bare CLI invocation (CLAUDE.md non-negotiable 1).',
      ),
      opts.json,
    );
  }

  const repoRoot = resolveRoot(opts, deps);
  const store = resolveSecretStore(repoRoot, deps);
  const open = deps.openStore ?? (() => openRuntimeStore(storeConfigFromEnv()));
  const runtime = await open();
  try {
    const now = deps.now?.();
    const result = await revokeSecret({
      store,
      ref,
      reason,
      actorSubject: by,
      repoRoot,
      flags: runtime.runtimeFlags,
      audit: runtime.audit,
      deploymentId: opts.deployment?.trim() || DEFAULT_DEPLOYMENT_ID,
      ...(now === undefined ? {} : { now }),
    });
    const envelope: SecretsRevokeEnvelope = {
      ok: true,
      verb: 'revoke',
      ref: result.ref,
      reason: result.reason,
      by: result.by,
      valueInvalidated: result.valueInvalidated,
      killed: result.killed.map((k) => ({
        kind: k.dependent.kind,
        id: k.dependent.id,
        killTarget: k.dependent.killTarget,
        file: k.dependent.file,
        flagId: k.flagId,
        auditCallId: k.auditCallId,
      })),
    };
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(envelope)}\n`);
    } else {
      process.stdout.write(
        [
          `forge secrets revoke: OK`,
          `  ref: ${envelope.ref}`,
          `  reason: ${envelope.reason}`,
          `  by: ${envelope.by}`,
          `  dependents kill-switched first, then the value destroyed:`,
          ...(envelope.killed.length === 0
            ? ['      (none referenced this credential)']
            : envelope.killed.map(
                (k) => `      ${k.killTarget}  (${k.file}, runtime_flags ${k.flagId})`,
              )),
          `  The stored value is gone. Kill switches stay in force until a human lifts them.`,
        ].join('\n') + '\n',
      );
    }
    return 0;
  } catch (err) {
    if (err instanceof SecretRevocationError) {
      const failure: SecretsRevokeFailureEnvelope = {
        ok: false,
        code: 'REVOCATION_REFUSED',
        verb: 'revoke',
        ref: err.ref,
        message: err.message,
        next: err.next,
        valueInvalidated: false,
        killed: err.killed.map((k) => k.dependent.killTarget),
      };
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(failure)}\n`);
      } else {
        process.stderr.write(`forge: secrets revoke — ${failure.message}\n`);
        process.stderr.write(`forge: next — ${failure.next}\n`);
      }
      return USAGE_EXIT_CODE;
    }
    throw err;
  } finally {
    await runtime.close();
  }
}

/** `forge secrets <status|rotate|revoke>`. */
export async function runSecretsCommand(
  verb: SecretsVerb,
  opts: SecretsOptions,
  deps: SecretsCommandDeps = {},
): Promise<number> {
  switch (verb) {
    case 'status':
      return runStatus(opts, deps);
    case 'rotate':
      return runRotate(opts, deps);
    case 'revoke':
      return runRevoke(opts, deps);
  }
}
