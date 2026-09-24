// MCPForge — canonical argument serialisation and the two hashes the confirm
// token binds. 02 §3.1.1.
//
// **W0-F2 owns this file** (`touches: core/gateway/policy/confirm/hash.ts`).
// W0-F1 seeded it minimal-but-correct; W0-F2 hardened it and added the
// *argument witness* (below), which is what lets `PLAN_ARGUMENT_MISMATCH` name
// the field that changed without the gateway storing a plan record anywhere.
//
// Four properties this file must never lose:
//
//  1. `confirm` is EXCLUDED. The token is bound to the business arguments, and
//     `confirm` is the token itself. Including it would make the plan-time hash
//     (computed before the token exists) permanently unequal to the execute-time
//     hash, so no legitimate confirmation could ever match. W0-B7 fixed exactly
//     this bug in the generated handler; the gateway-side hash must agree.
//  2. Key order is irrelevant. Two argument objects that differ only in key
//     order hash identically, at every depth.
//  3. Everything else is significant. A changed value, a changed type, an added
//     or removed key all change the hash — that is what makes
//     `PLAN_ARGUMENT_MISMATCH` a security control rather than a formality.
//  4. Two different argument sets never canonicalise to the same string. Every
//     value shape either has an unambiguous canonical form or is REFUSED — a
//     canonicaliser that quietly maps two distinct inputs onto one string is a
//     canonicaliser whose collisions an attacker gets to choose.

import { createHash, createHmac } from 'node:crypto';

/** The one hash algorithm, pinned. 02 §3.1.1 says sha256 in so many words. */
export const ARGS_HASH_ALGORITHM = 'sha256';

/** The argument name the hash always excludes. Named once, used everywhere. */
export const CONFIRM_FIELD = 'confirm';

/**
 * Normalise one number to its canonical textual form.
 *
 * The two cases W0-F2's `done:` clause names, and why each is safe:
 *
 *   * **`1.10` ≡ `1.1`.** A JSON parser produces the same IEEE-754 double for
 *     both literals, and ECMAScript's `Number::toString` is specified to emit
 *     the *shortest* decimal that round-trips to that double. So `1.10`, `1.1`
 *     and `1.100000` all reach here as one value and leave as the one string
 *     `"1.1"`. Trailing zeros are therefore never significant — which matters
 *     because a currency amount is exactly where an agent's serialiser is most
 *     likely to differ from the one that produced the plan.
 *   * **`-0` ≡ `0`.** `String(-0)` is `"0"` already, but `Object.is` is used
 *     rather than `===` so the intent is legible and a future refactor that
 *     reaches for a sign-preserving formatter cannot silently break it.
 *
 * Non-finite numbers cannot appear in JSON and are REFUSED rather than
 * serialised as `null`, which is what `JSON.stringify` would do — a hash that
 * quietly maps `NaN`, `Infinity` and `null` onto one string is a hash with a
 * collision an attacker chooses.
 */
function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(
      `Cannot canonicalise the non-finite number ${String(value)}; JSON arguments never contain one.`,
    );
  }
  // `Object.is(-0, 0)` is false, so this branch is reached for negative zero and
  // for nothing else; `String(-0)` would also yield "0", making this belt and
  // braces on purpose.
  return Object.is(value, -0) ? '0' : String(value);
}

/**
 * Is this a plain JSON object — the thing a `JSON.parse` of tool arguments can
 * actually produce?
 *
 * Anything else (a `Date`, a `Map`, a class instance, an object with a `toJSON`)
 * has no own enumerable data properties, or has ones that do not describe it, so
 * it would canonicalise to `{}` and COLLIDE with the empty object and with every
 * other such value. Refusing is the only safe answer: arguments arrive over the
 * wire as JSON, so a non-plain object here means something upstream constructed
 * a value the canonicaliser was never meant to see.
 */
function isPlainJsonObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Canonical JSON. Sorted keys at every depth, normalised numbers, no
 * insignificant whitespace. `undefined` properties are dropped, matching what a
 * JSON round trip would do to them anyway.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return canonicalNumber(value);
    case 'string':
      return JSON.stringify(value);
    case 'undefined':
      return 'null';
    case 'object':
      break;
    default:
      // `bigint`, `symbol` and `function` land here. None can survive a JSON
      // round trip, and each would otherwise be silently dropped or coerced.
      throw new Error(
        `Cannot canonicalise a value of type ${typeof value}; tool arguments are JSON.`,
      );
  }

  if (!Array.isArray(value) && !isPlainJsonObject(value)) {
    throw new Error(
      'Cannot canonicalise a non-plain object (a Date, a Map, a class instance); tool ' +
        'arguments are JSON, and such a value would canonicalise to {} and collide.',
    );
  }

  if (Array.isArray(value)) {
    // Array ORDER is significant and is never sorted: `[a, b]` and `[b, a]` are
    // different arguments to every target system MCPForge speaks to.
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  const body = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',');
  return `{${body}}`;
}

/** The business arguments: everything the caller passed except `confirm`. */
export function businessArgs(
  args: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(args)) {
    if (key === CONFIRM_FIELD) continue;
    out[key] = args[key];
  }
  return out;
}

function sha256Hex(input: string): string {
  return createHash(ARGS_HASH_ALGORITHM).update(input, 'utf8').digest('hex');
}

/**
 * sha256 over the canonical serialisation of the arguments **excluding
 * `confirm`** (02 §3.1.1). Recomputed at execute time from the arguments
 * actually presented and compared against what the token was minted for.
 */
export function argsCanonicalHash(args: Readonly<Record<string, unknown>>): string {
  return sha256Hex(canonicalJson(businessArgs(args)));
}

/**
 * sha256 over the plan the human was shown. This is the second half of the
 * binding: `argsCanonicalHash` proves the arguments did not change, `planHash`
 * proves the *rendered plan* — the text a human actually read and approved —
 * is the one this execution belongs to. W0-F6's approval record captures this
 * exact value, which is why it is bound into the token from W0-F1 onward.
 */
export function planCanonicalHash(plan: unknown): string {
  return sha256Hex(canonicalJson(plan));
}

/**
 * The argument names whose canonical values differ between two argument sets.
 * `PLAN_ARGUMENT_MISMATCH` must name the fields that changed (02 §3.1.1), and
 * a refusal that says only "something changed" is the dead end non-negotiable
 * #5 forbids.
 */
export function changedArgumentNames(
  planned: Readonly<Record<string, unknown>>,
  presented: Readonly<Record<string, unknown>>,
): readonly string[] {
  const a = businessArgs(planned);
  const b = businessArgs(presented);
  const names = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  const changed: string[] = [];
  for (const name of [...names].sort()) {
    if (canonicalJson(a[name]) !== canonicalJson(b[name])) changed.push(name);
  }
  return changed;
}

// --- the argument witness ---------------------------------------------------
//
// 02 §3.1.1: "If they differ → refuse, with `PLAN_ARGUMENT_MISMATCH` **naming
// the fields that changed**." `argsCanonicalHash` is one hash over the whole
// argument set, so by itself it can only say *that* something changed. Naming
// the field needs a per-field comparison, and therefore needs the gateway to
// still know something about the PLANNED arguments at execute time.
//
// **Why not store the plan.** A plan-record table would put business argument
// values — supplier, amount, bank details — into a second durable store beside
// the audit log, with its own retention, redaction and access-control problem,
// and it would make the confirm path depend on the datastore being up. The
// token is already an opaque, integrity-protected value that makes exactly the
// round trip we need. So the witness rides in the token, and no plan record is
// stored anywhere.
//
// **Why the digests are KEYED.** A plain `sha256(value)` of an amount, a company
// code or a supplier number is brute-forceable in microseconds: the value space
// is tiny. Publishing one in a token that travels through the agent would leak
// the very business values ../token.ts promises the payload never carries. An
// HMAC under the gateway's own confirm signing key is not: without the key an
// observer cannot test a guess. The gateway holds the key on both sides of the
// round trip, so it — and only it — can recompute the digests and diff them.
//
// The digest therefore reveals nothing except, to the gateway, equality: exactly
// the fact `PLAN_ARGUMENT_MISMATCH` needs and nothing more.

/** Domain separator, so a witness digest can never be confused with a signature. */
const WITNESS_DOMAIN = 'mcpforge/confirm/arg-witness/v1';

function witnessDigest(name: string, value: unknown, key: Uint8Array): string {
  return createHmac(ARGS_HASH_ALGORITHM, key)
    .update(WITNESS_DOMAIN, 'utf8')
    .update(' ', 'utf8')
    .update(canonicalJson(name), 'utf8')
    .update(' ', 'utf8')
    .update(canonicalJson(value), 'utf8')
    .digest('base64url');
}

/**
 * A keyed digest per business argument name, computed at plan time and carried
 * in the confirm token. Never contains a business value — see the note above.
 */
export function argumentWitness(
  args: Readonly<Record<string, unknown>>,
  key: Uint8Array,
): Readonly<Record<string, string>> {
  const business = businessArgs(args);
  const out: Record<string, string> = {};
  for (const name of Object.keys(business).sort()) {
    out[name] = witnessDigest(name, business[name], key);
  }
  return out;
}

/**
 * The argument names that differ between the plan the witness was minted for and
 * the arguments actually presented. An argument added or removed since the plan
 * counts as changed, because it is.
 *
 * Returns an empty array when nothing differs — which, if `argsCanonicalHash`
 * disagreed, means the witness and the hash disagree and the caller must still
 * refuse. `verifyConfirmToken` handles that case; it never treats "no named
 * field" as "no mismatch".
 */
export function changedArgumentNamesFromWitness(
  witness: Readonly<Record<string, string>>,
  presented: Readonly<Record<string, unknown>>,
  key: Uint8Array,
): readonly string[] {
  const now = argumentWitness(presented, key);
  const names = new Set<string>([...Object.keys(witness), ...Object.keys(now)]);
  const changed: string[] = [];
  for (const name of [...names].sort()) {
    if (witness[name] !== now[name]) changed.push(name);
  }
  return changed;
}
