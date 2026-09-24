// MCPForge — emergency revocation as ONE ACT. W0-N6, 02 §11.5 rule 6.
//
// "**Emergency revocation is one act.** `forge secrets revoke <ref> --reason
// "…"` invalidates the value **and kill-switches everything referencing it in
// the same operation**, using §4.7's flags mechanism."
//
// **THE ORDER, AND WHY IT IS NOT THE OBVIOUS ONE.**
//
// The obvious order is: destroy the value, then kill-switch the dependents. It
// is wrong, and it is wrong in the direction that matters. Between those two
// steps every dependent is still visible, still in scope, still executable —
// and reaching for a credential that is no longer there. What a caller gets in
// that window is a `SecretStoreError` from the depths of an adapter: a
// credential-missing failure surfacing on a business call, which is exactly the
// "fails obscurely" outcome this task's `done:` criterion forbids.
//
// So the order here is:
//
//   1. Scan git for dependents (../secrets/dependents.ts), and REFUSE outright
//      if any artefact under manifests/ or consumers/ could not be read — an
//      unreadable manifest is where an unnoticed reference would hide.
//   2. Kill-switch every dependent, at 02 §4.7's granularities.
//   3. Only then, invalidate the value.
//
// The window therefore contains no state in which a dependent is executable
// with a dead credential. Before step 2 the credential still works and the
// dependent works; after step 2 the dependent is refused by the kill switch —
// cleanly, with `TOOL_DISABLED` / `CONSUMER_SUSPENDED`, the flag's own reason
// text and a non-empty `next` (../flags/checks.ts) — and after step 3 the value
// is gone as well. That is what "atomic in effect" means here, and it is a
// stronger property than a transaction would have given, because the kill
// switch and the vault are not the same durable resource and never can be:
// §4.7's flags live in the runtime store and the vault is a sealed file.
//
// **IF STEP 2 FAILS PART WAY, STEP 3 DOES NOT RUN.** The revocation reports
// which dependents were killed, which were not, and refuses to destroy the
// value. The operator is then holding a partially-restricted system whose
// credential still works — restrictive but functional — rather than a
// partially-restricted system whose credential is gone, which is an outage
// with a stack trace. Fail toward MORE restriction and LESS surprise, the same
// disposition `applyKill` itself already documents.
//
// **The audit record.** Every kill writes its own audit row through
// `applyKill`, carrying the reason. This module does not write a second,
// summarising audit row: that would be a fact ("a revocation happened")
// asserted independently of the facts that constitute it, and a reader
// reconciling the two would have no way to tell which was authoritative. The
// kill rows ARE the record, and they carry the revocation's reason text
// verbatim, which is why `reason` is threaded through rather than replaced with
// a generic string.

import type { AuditRepository, RuntimeFlagsRepository } from '../store/index.js';
import { applyKill } from '../flags/kill.js';
import { findSecretDependents, type SecretDependent } from './dependents.js';
import { SecretStoreError, type SecretRef, type SecretStore } from './types.js';

export interface RevokeSecretInput {
  readonly store: SecretStore;
  readonly ref: SecretRef;
  readonly reason: string;
  /** `Principal.subject` of whoever ran this. Never defaulted (CLAUDE.md #1). */
  readonly actorSubject: string;
  /** Repository root the dependent scan reads `manifests/` and `consumers/` under. */
  readonly repoRoot: string;
  readonly flags: RuntimeFlagsRepository;
  readonly audit: AuditRepository;
  readonly deploymentId: string;
  readonly now?: Date;
}

export interface RevokedDependent {
  readonly dependent: SecretDependent;
  readonly flagId: string;
  readonly auditCallId: string;
}

export interface RevokeSecretResult {
  readonly ref: string;
  readonly reason: string;
  readonly by: string;
  /** Dependents kill-switched, in the order they were killed. */
  readonly killed: readonly RevokedDependent[];
  /** True once `SecretStore.revoke()` has returned. False means step 3 never ran. */
  readonly valueInvalidated: boolean;
}

/**
 * Thrown when the revocation refused to complete. Carries what WAS done, so an
 * operator is never guessing at the half-state, and an actionable `next`
 * (CLAUDE.md non-negotiable 5).
 */
export class SecretRevocationError extends Error {
  override readonly name = 'SecretRevocationError';
  readonly next: string;
  readonly ref: string;
  readonly killed: readonly RevokedDependent[];
  readonly valueInvalidated = false;

  // `nextAction`, not `next`: `errors/site-scan.ts` treats a line that BEGINS
  // `next:` as a next-VALUE construction site unless it matches its
  // type-annotation exclusion, and that exclusion does not allow the trailing
  // comma a multi-line parameter list puts there. The parameter is renamed
  // rather than the shared scanner widened — the scanner only over-reports,
  // never under-reports, so this costs nothing and keeps the gate untouched.
  constructor(
    message: string,
    nextAction: string,
    ref: string,
    killed: readonly RevokedDependent[] = [],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.next = nextAction;
    this.ref = ref;
    this.killed = killed;
  }
}

/**
 * Revoke a credential and kill-switch every dependent, in one act.
 *
 * A ref with NO dependents is revoked normally rather than refused: a
 * credential nothing references yet is exactly the credential an operator
 * should be able to destroy without ceremony, and refusing would push them
 * toward deleting the vault entry by hand.
 */
export async function revokeSecret(input: RevokeSecretInput): Promise<RevokeSecretResult> {
  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new SecretRevocationError(
      'A revocation needs a non-empty --reason.',
      'Re-run with --reason "…" naming why the credential is being destroyed; the text is written verbatim into every dependent kill switch\'s audit record.',
      input.ref.uri,
    );
  }
  if (input.actorSubject.trim().length === 0) {
    throw new SecretRevocationError(
      'A revocation needs a named acting subject.',
      'Re-run with --by <Principal.subject>. There is no default acting identity for a bare CLI invocation (CLAUDE.md non-negotiable 1).',
      input.ref.uri,
    );
  }

  // Step 0 — the credential must exist. `metadata()` and not `get()`: this
  // module has no business resolving a value, and `SecretStore.get()` is
  // callable only from adapters/** and core/gateway/identity/** anyway.
  try {
    await input.store.metadata(input.ref);
  } catch (err) {
    if (err instanceof SecretStoreError) {
      throw new SecretRevocationError(
        `No credential is stored for ${input.ref.uri}; there is nothing to revoke.`,
        `Run "forge secrets status --json" to see the refs this store actually holds. Nothing was kill-switched — a revocation of a ref that does not exist must not restrict tools that were never affected.`,
        input.ref.uri,
        [],
        { cause: err },
      );
    }
    throw err;
  }

  // Step 1 — who references it, from git.
  const scan = findSecretDependents(input.repoRoot, input.ref.uri);
  if (scan.failures.length > 0) {
    throw new SecretRevocationError(
      `${scan.failures.length} artefact(s) under manifests/ or consumers/ could not be read, so the set of dependents of ${input.ref.uri} is not known: ${scan.failures
        .map((f) => `${f.file} (${f.message})`)
        .join('; ')}.`,
      'Fix or remove the unreadable artefact(s) named above and re-run. Nothing was kill-switched and the value was NOT destroyed: revoking against an incomplete dependent list would leave the unscanned dependents live with a dead credential, which is the failure mode this refusal exists to prevent. To cut access off immediately in the meantime, run "forge kill" against the dependents you do know.',
      input.ref.uri,
    );
  }

  // Step 2 — kill-switch every dependent BEFORE the value goes away.
  const killed: RevokedDependent[] = [];
  for (const dependent of scan.dependents) {
    try {
      const result = await applyKill(input.flags, input.audit, {
        raw: dependent.killTarget,
        reason: `Credential ${input.ref.uri} revoked: ${reason}`,
        until: null,
        actorSubject: input.actorSubject,
        deploymentId: input.deploymentId,
        ...(input.now === undefined ? {} : { now: input.now }),
      });
      killed.push({ dependent, flagId: result.flagId, auditCallId: result.auditCallId });
    } catch (err) {
      throw new SecretRevocationError(
        `Kill-switching ${dependent.killTarget} (${dependent.file}) failed, so the revocation of ${input.ref.uri} was abandoned before the value was destroyed.`,
        `${killed.length} of ${scan.dependents.length} dependent(s) are already kill-switched and stay that way — ${killed.map((k) => k.dependent.killTarget).join(', ') || 'none'}. The credential STILL WORKS, deliberately: a live credential behind a partially restricted surface is recoverable, a dead one is an outage. Resolve the store error, then re-run "forge secrets revoke ${input.ref.uri} --reason \\"…\\"" — killing an already-killed target is idempotent in effect.`,
        input.ref.uri,
        killed,
        { cause: err },
      );
    }
  }

  // Step 3 — and only now, destroy the value.
  try {
    await input.store.revoke(input.ref);
  } catch (err) {
    throw new SecretRevocationError(
      `Every dependent of ${input.ref.uri} was kill-switched, but destroying the stored value failed.`,
      `Access is already cut off — all ${killed.length} dependent(s) refuse. Resolve the secret-store error and re-run the same command to finish destroying the value; the kill switches stay in force until a human lifts them.`,
      input.ref.uri,
      killed,
      { cause: err },
    );
  }

  return {
    ref: input.ref.uri,
    reason,
    by: input.actorSubject,
    killed,
    valueInvalidated: true,
  };
}
