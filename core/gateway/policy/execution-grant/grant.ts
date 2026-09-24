// MCPForge — the execution grant. W0-P9, Wave 0 exit criterion 5 (egress half),
// 02 §4.8, owner decision of 25 Sep 2026.
//
// WHAT IT IS. A short-lived, HMAC-signed statement, minted by the policy chain
// (`../chain.ts`) at the moment every stage has said `continue`, that says: this
// caller, through this consumer, may make THIS call (tool, binding ref,
// business arguments, correlation id) until `exp`. A binding executor refuses
// to dispatch without one it can verify. So "the gateway is the only door" is
// a check the executor performs, not a property of which modules happen to
// import it.
//
// WHAT IT IS NOT, stated so nobody over-reads it:
//   * Not a network control. 02 §4.8's egress control is that the TARGET
//     accepts connections only from the gateway's egress identity. That needs a
//     real target, and there is none at Wave 0; it is a recorded waiver on
//     exit criterion 5 (TASKS.md), not something this file claims.
//   * Not a defence against deliberately malicious code in the gateway
//     process, which could equally open a socket. It is a defence against a
//     STRUCTURAL bypass: a new route, a script, a portal action, a copied test
//     harness, or a future entry point that calls an executor without having
//     run the chain. That is the failure mode Track P keeps finding.
//   * Not single-use. A grant lives for `DEFAULT_EXECUTION_GRANT_TTL_SECONDS`
//     and is bound to one correlation id. Double execution of a WRITE is
//     prevented where it already was: the confirm nonce consumed inside the
//     execute transaction and the idempotency gate (W0-F3).
//
// BINDING. `bindingRef` is the ref of the descriptor actually dispatched. The
// write path's dry run executes the `_VALIDATE` sibling through the same
// executor (`adapters/function/src/dryrun.ts`), so an execute grant cannot be
// spent on the validate orchestration and a dry-run grant cannot be spent on
// the real one. `argsCanonicalHash` is the confirm path's own hash
// (`../confirm/hash.ts`), which excludes `confirm`.
//
// KEYS. A keyring of the confirm token's shape (active + accepted, the dual-key
// rotation overlap CLAUDE.md §3 requires) but a SEPARATE key: its durable home
// is `secretRef://gateway/execution-grant/hmac`. The signing input is also
// domain-separated, so a confirm token and an execution grant can never verify
// as each other even if a deployment misconfigured the two to share a key.
// Like `../confirm/token.ts`, this module never reads a file, an environment
// variable or a SecretStore; the keyring is supplied by the caller.

import { createHmac, timingSafeEqual } from 'node:crypto';

import { argsCanonicalHash } from '../confirm/hash.js';
import type { ConfirmKeyring } from '../confirm/token.js';

export const EXECUTION_GRANT_PREFIX = 'egr_';
/** Long enough to cross the dispatcher to the executor, short enough to be useless later. */
export const DEFAULT_EXECUTION_GRANT_TTL_SECONDS = 30;
const DOMAIN = 'mcpforge.execution-grant.v1';

/** Same shape and rotation semantics as the confirm keyring; a different key. */
export type ExecutionGrantKeyring = ConfirmKeyring;

export const EXECUTION_GRANT_PURPOSES = ['execute', 'dry-run'] as const;
export type ExecutionGrantPurpose = (typeof EXECUTION_GRANT_PURPOSES)[number];

export interface ExecutionGrantPayload {
  readonly purpose: ExecutionGrantPurpose;
  readonly toolId: string;
  readonly bindingRef: string;
  readonly argsCanonicalHash: string;
  readonly callerSubject: string;
  /** Carried for forensics; the call is already pinned by `correlationId`. */
  readonly consumerId: string;
  readonly correlationId: string;
  /** Absolute expiry, epoch seconds. */
  readonly exp: number;
}

/** What the executor can say about the call it is being asked to make. */
export interface ExecutionGrantBinding {
  readonly toolId: string;
  readonly bindingRef: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly callerSubject: string | undefined;
  readonly correlationId: string;
}

export type ExecutionGrantFailure =
  'missing' | 'malformed' | 'bad-signature' | 'expired' | 'not-bound-to-this-call';

export type ExecutionGrantVerification =
  | { readonly ok: true; readonly payload: ExecutionGrantPayload }
  | {
      readonly ok: false;
      readonly failure: ExecutionGrantFailure;
      readonly mismatchedField?: keyof ExecutionGrantPayload;
    };

function b64u(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function sign(signingInput: string, key: Buffer): string {
  return createHmac('sha256', key).update(`${DOMAIN}.${signingInput}`, 'utf8').digest('base64url');
}

function encodePayload(p: ExecutionGrantPayload): string {
  // Fixed field order, so two mints of one payload are byte-identical.
  return b64u(
    JSON.stringify({
      purpose: p.purpose,
      toolId: p.toolId,
      bindingRef: p.bindingRef,
      argsCanonicalHash: p.argsCanonicalHash,
      callerSubject: p.callerSubject,
      consumerId: p.consumerId,
      correlationId: p.correlationId,
      exp: p.exp,
    }),
  );
}

function decodePayload(raw: string): ExecutionGrantPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  for (const field of [
    'toolId',
    'bindingRef',
    'argsCanonicalHash',
    'callerSubject',
    'consumerId',
    'correlationId',
  ] as const) {
    if (typeof p[field] !== 'string' || (p[field] as string).length === 0) return null;
  }
  if (!EXECUTION_GRANT_PURPOSES.includes(p['purpose'] as ExecutionGrantPurpose)) return null;
  if (typeof p['exp'] !== 'number' || !Number.isFinite(p['exp'])) return null;
  return {
    purpose: p['purpose'] as ExecutionGrantPurpose,
    toolId: p['toolId'] as string,
    bindingRef: p['bindingRef'] as string,
    argsCanonicalHash: p['argsCanonicalHash'] as string,
    callerSubject: p['callerSubject'] as string,
    consumerId: p['consumerId'] as string,
    correlationId: p['correlationId'] as string,
    exp: p['exp'] as number,
  };
}

function signaturesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface MintExecutionGrantInput {
  readonly purpose: ExecutionGrantPurpose;
  readonly toolId: string;
  readonly bindingRef: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly callerSubject: string;
  readonly consumerId: string;
  readonly correlationId: string;
  readonly now: Date;
  readonly ttlSeconds?: number;
}

/**
 * Mint with the keyring's ACTIVE key. Called only from inside
 * `core/gateway/policy/**`; `tests/policy/escalation.trust-boundary.test.ts`
 * enforces that statically.
 */
export function mintExecutionGrant(
  input: MintExecutionGrantInput,
  keyring: ExecutionGrantKeyring,
): string {
  if (input.callerSubject.length === 0) {
    // CLAUDE.md #1: there is no grant for "nobody". A call that reached here
    // without a resolved human is a bug upstream, and it must not execute.
    throw new Error('An execution grant needs a resolved caller subject.');
  }
  const payload: ExecutionGrantPayload = {
    purpose: input.purpose,
    toolId: input.toolId,
    bindingRef: input.bindingRef,
    argsCanonicalHash: argsCanonicalHash(input.args),
    callerSubject: input.callerSubject,
    consumerId: input.consumerId,
    correlationId: input.correlationId,
    exp:
      Math.floor(input.now.getTime() / 1000) +
      (input.ttlSeconds ?? DEFAULT_EXECUTION_GRANT_TTL_SECONDS),
  };
  const header = b64u(JSON.stringify({ kid: keyring.active.keyId }));
  const body = encodePayload(payload);
  const signingInput = `${header}.${body}`;
  return `${EXECUTION_GRANT_PREFIX}${signingInput}.${sign(signingInput, keyring.active.key)}`;
}

/**
 * Signature first, then expiry, then the binding — the confirm token's order,
 * for the same reason: a grant this gateway did not sign learns nothing about
 * which of its fields would have mismatched.
 */
export function verifyExecutionGrant(
  grant: string | undefined,
  binding: ExecutionGrantBinding,
  keyring: ExecutionGrantKeyring,
  now: Date,
): ExecutionGrantVerification {
  if (grant === undefined || grant.length === 0) return { ok: false, failure: 'missing' };
  if (!grant.startsWith(EXECUTION_GRANT_PREFIX)) return { ok: false, failure: 'malformed' };
  const parts = grant.slice(EXECUTION_GRANT_PREFIX.length).split('.');
  if (parts.length !== 3) return { ok: false, failure: 'malformed' };
  const [header, body, signature] = parts as [string, string, string];

  let keyId: unknown;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    keyId =
      parsed !== null && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)['kid']
        : undefined;
  } catch {
    return { ok: false, failure: 'malformed' };
  }
  if (typeof keyId !== 'string') return { ok: false, failure: 'malformed' };
  const key = keyring.accepted.find((candidate) => candidate.keyId === keyId);
  if (key === undefined) return { ok: false, failure: 'bad-signature' };
  if (!signaturesEqual(sign(`${header}.${body}`, key.key), signature)) {
    return { ok: false, failure: 'bad-signature' };
  }

  const payload = decodePayload(body);
  if (payload === null) return { ok: false, failure: 'malformed' };
  if (payload.exp * 1000 <= now.getTime()) return { ok: false, failure: 'expired' };

  const expected: Pick<
    ExecutionGrantPayload,
    'toolId' | 'bindingRef' | 'argsCanonicalHash' | 'callerSubject' | 'correlationId'
  > = {
    toolId: binding.toolId,
    bindingRef: binding.bindingRef,
    argsCanonicalHash: argsCanonicalHash(binding.args),
    callerSubject: binding.callerSubject ?? '',
    correlationId: binding.correlationId,
  };
  for (const field of [
    'toolId',
    'bindingRef',
    'argsCanonicalHash',
    'callerSubject',
    'correlationId',
  ] as const) {
    if (payload[field] !== expected[field]) {
      return { ok: false, failure: 'not-bound-to-this-call', mismatchedField: field };
    }
  }
  return { ok: true, payload };
}

/**
 * The executor-facing check, structurally the `ExecutionGrantCheck` interface
 * in `adapters/function/src/types.ts` (the adapter depends on
 * `@mcpforge/shared` only, so it declares the shape and the gateway supplies
 * it). The gateway assembly (W0-P11) constructs this with the real keyring.
 * There is no permissive variant and none may be added.
 */
export function executionGrantCheck(
  keyring: ExecutionGrantKeyring,
  clock: () => Date = () => new Date(),
): {
  check(
    grant: string | undefined,
    binding: ExecutionGrantBinding,
  ): { readonly ok: true } | { readonly ok: false; readonly reason: string };
} {
  return {
    check(grant, binding) {
      const result = verifyExecutionGrant(grant, binding, keyring, clock());
      if (result.ok) return { ok: true };
      return {
        ok: false,
        reason:
          result.mismatchedField === undefined
            ? result.failure
            : `${result.failure} (${result.mismatchedField})`,
      };
    },
  };
}
