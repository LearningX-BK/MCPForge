// MCPForge — the `kind: Consumer` record model. W0-N1, 02 §11.2 / 05 §1.3.
//
// A Consumer is the SOFTWARE holding the session — an agent, a client, a
// platform, the portal itself. The record is a git artefact BECAUSE it is a
// grant: `consumers/<id>.consumer.yaml`, validated by `forge validate`,
// compiled by `forge codegen`, changed only through the change-proposal →
// approval → merge flow (02 §11.2). Nothing here writes to `consumers/`.
//
// This file is the runtime-side reader of that artefact. The authoring-side
// authority is `core/codegen/schema/consumer.schema.json` (W0-B1) — the zod
// shape below is field for field with it and with 02 §11.2's worked example,
// and `consumer.schema.test.ts` pins the two together so they cannot drift.
//
// CLAUDE.md #6: every call needs BOTH a registered consumer and a resolved
// human identity, and authorization is the INTERSECTION. Nothing in this
// module resolves, substitutes for, or stands in place of a human identity;
// it only reads what the software is registered to be allowed to do.
// CLAUDE.md #8: `credential.ref` is a `secretRef://` and never a value.

import { z } from 'zod';

/** 02 §11.5 — `secretRef://<scope>/<subject>/<purpose>`, three non-empty segments. */
export const SECRET_REF_RE = /^secretRef:\/\/[a-z0-9-]+\/[a-z0-9._-]+\/[a-z0-9._-]+$/;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

export const CONSUMER_CLASSES = [
  'interactive-client',
  'autonomous-agent',
  'batch-service',
  'portal',
] as const;
export type ConsumerClass = (typeof CONSUMER_CLASSES)[number];

/** The declared lifecycle states of a registration (02 §11.2). */
export const CONSUMER_STATUSES = ['active', 'suspended', 'retired'] as const;
export type ConsumerStatus = (typeof CONSUMER_STATUSES)[number];

/**
 * What the gateway acts on. `expired` is NOT a declarable status: it is the
 * fail-closed reduction of `active` + a past `expiresAt`, because 02 §11.2
 * makes renewal a re-approval and not a no-op. It can only ever narrow.
 * (Identical rule to the compiled artefact's `effectiveStatus`, W0-B8.)
 */
export type EffectiveConsumerStatus = ConsumerStatus | 'expired';

export const BINDING_TYPES = ['rest', 'database', 'plsql', 'function', 'wrapped-vendor'] as const;
export const SENSITIVITIES = [
  'public',
  'internal',
  'confidential',
  'financial',
  'personal',
] as const;

const secretRef = z
  .string()
  .regex(SECRET_REF_RE, 'credential.ref must be a secretRef://<scope>/<subject>/<purpose> URI');
const isoDate = z.string().regex(ISO_DATE_RE, 'must be an ISO date (YYYY-MM-DD)');
const slugId = z.string().regex(SLUG_ID_RE, 'must be a lower-case slug id');

export const CREDENTIAL_METHODS = ['mtls', 'private-key-jwt', 'client-secret'] as const;
export type CredentialMethod = (typeof CREDENTIAL_METHODS)[number];

/**
 * `credential.publicKeys[]` — the GATEWAY-SIDE verification material for
 * `method: private-key-jwt`, added by 05 §A.4/§A.5 ("one refinement W0-N1
 * should absorb ... a one-rule addition inside an existing task").
 *
 * Note the asymmetry 05 §A.4 warns is easy to implement wrongly:
 * `credential.ref` names the consumer's PRIVATE key and the gateway resolves
 * it never; the gateway verifies against these PUBLIC keys, inline in the git
 * record. A public key is safe to commit, safe to log, safe to render and safe
 * to leak — which is precisely why the registry is secret-free.
 *
 * `.strict()` is load-bearing here rather than tidy: an OKP JWK's private
 * component is `d`, so a strict object with no `d` property structurally
 * rejects a private key pasted into a record, which is what 05 §A.5 requires
 * ("reject an inline *private* key outright").
 */
export const consumerPublicKeySchema = z
  .object({
    kid: z.string().min(1),
    kty: z.literal('OKP'),
    crv: z.literal('Ed25519'),
    /** base64url-encoded Ed25519 public key. */
    x: z.string().min(1),
    addedAt: isoDate,
  })
  .strict();

export type ConsumerPublicKey = z.infer<typeof consumerPublicKeySchema>;

export const consumerRecordSchema = z
  .object({
    apiVersion: z.literal('mcpforge/v1'),
    kind: z.literal('Consumer'),
    id: slugId,
    label: z.string().min(1),
    class: z.enum(CONSUMER_CLASSES),
    owner: z.string().min(1),
    steward: z.string().min(1),
    status: z.enum(CONSUMER_STATUSES),
    expiresAt: isoDate,
    credential: z
      .object({
        method: z.enum(CREDENTIAL_METHODS),
        ref: secretRef,
        publicKeys: z.array(consumerPublicKeySchema).optional(),
        boundIssuers: z.array(z.string().min(1)).min(1),
        rotation: z.object({ intervalDays: z.number().int().positive(), lastRotatedAt: isoDate }),
      })
      .strict(),
    authorizations: z.object({
      bindingTypes: z.array(z.enum(BINDING_TYPES)),
      maxSensitivity: z.enum(SENSITIVITIES),
      writeAllowed: z.boolean(),
      roles: z.array(slugId),
      packages: z.array(slugId),
    }),
    limits: z.object({
      callsPerMinute: z.number().int().nonnegative(),
      writesPerDay: z.number().int().nonnegative(),
      concurrentSessions: z.number().int().nonnegative(),
      operatingWindow: z.string().min(1).optional(),
    }),
    attestation: z.object({
      networkOrigins: z.array(z.string().min(1)).optional(),
      humanInTheLoop: z.boolean(),
    }),
    bindingGrants: z.array(z.record(z.unknown())).optional(),
  })
  .strict();

export type ConsumerRecord = z.infer<typeof consumerRecordSchema>;

/**
 * W0-N2, 05 §A.5 — the same record, plus what a record must satisfy to be a
 * REGISTRATION the gateway will authenticate against: "for `private-key-jwt`
 * the record must also carry a `credential.publicKeys[]` array, and validation
 * must require at least one entry."
 *
 * **Why this is a second schema rather than a tightening of the first, which
 * is a real distinction and not a workaround.** 05 §A.4's runbook is ordered:
 * step 1 `forge consumer new` SCAFFOLDS the record, step 2
 * `forge consumer issue-credential` generates the keypair and writes the
 * public half INTO it, step 3 proposes it for approval. Between steps 1 and 2
 * a private-key-jwt record legitimately has no public key yet. So the
 * structural shape (what `forge consumer new` may emit) and the complete
 * registration (what the gateway may load and authenticate against) are two
 * different things, and collapsing them would either break the scaffold or
 * let an unauthenticable record into the registry.
 *
 * `loadConsumerRegistry` uses THIS one. A record that cannot authenticate is
 * reported as a load failure, never silently carried as a live registration.
 */
export const consumerRegistrationSchema = consumerRecordSchema.superRefine((record, ctx) => {
  if (record.credential.method !== 'private-key-jwt') return;
  const keys = record.credential.publicKeys;
  if (keys !== undefined && keys.length > 0) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['credential', 'publicKeys'],
    message:
      "credential.method: private-key-jwt requires at least one credential.publicKeys[] entry — the gateway verifies against the public key in the record and never resolves credential.ref (05 §A.4). Run `forge consumer issue-credential <id> --method private-key-jwt` on the consumer's own machine and commit the public key it emits.",
  });
});

/** Today, as an ISO date, in UTC — the one place this module reads the clock. */
export function isoToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Fail-closed: an `active` registration whose `expiresAt` has passed is
 * `expired`. A `suspended` or `retired` record is never widened back.
 */
export function effectiveStatus(
  record: Pick<ConsumerRecord, 'status' | 'expiresAt'>,
  today: string = isoToday(),
): EffectiveConsumerStatus {
  if (record.status !== 'active') return record.status;
  return record.expiresAt < today ? 'expired' : 'active';
}

/** The repo-relative, forward-slash path a consumer record lives at. */
export function consumerRecordPath(id: string): string {
  return `consumers/${id}.consumer.yaml`;
}

/** 02 §11.5's ref for a consumer's own client credential. Never a value. */
export function consumerCredentialRef(id: string): string {
  return `secretRef://consumer/${id}/client`;
}
