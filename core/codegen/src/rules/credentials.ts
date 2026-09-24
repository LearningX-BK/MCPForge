// MCPForge — W0-B3 [P5] credential rules. CLAUDE.md non-negotiables #1 and #8;
// 02 §11.5, §11.5.1.
//
//   policy.stored-credential-on-verified-identity — module-scoped-stored is
//        rejected where the probe reports identity.carries: verified
//   policy.per-user-exchanged-on-plsql            — per-user-exchanged on plsql
//        is structurally impossible
//   policy.stored-credential-four-part-test       — the four-part legitimacy
//        test, failing by NAME of the part that failed
//
// "No service-account fallback" forbids SUBSTITUTION, not STORAGE. The four-part
// test is what keeps those two apart, and it is written here as a rule rather
// than left as a paragraph nobody reads (02 §11.5.1).

import type {
  IndexedManifest,
  RepoContext,
  ValidationFailure,
  ValidationRule,
} from '../validate/types.js';
import { fail, get, tools } from './helpers.js';

/*
 * `binding.identity.onServiceAccount` is a field name fixed by 02 §2.2, and
 * manifest field names are immutable. It is the DETECTION of a service account
 * — what the gateway does when the probe reports the target saw one — and its
 * only values are `block` and `readonly-lowsens`; neither substitutes a shared
 * credential for an unresolved identity. The guard lint rule matches on the
 * name shape alone and cannot see that, so it is disabled for this one
 * constant exactly as core/shared/src/manifest/tool.ts already does, and
 * nowhere else in this package.
 */
// eslint-disable-next-line mcpforge/no-service-account-fallback -- spec-fixed field name; detection, never substitution (02 §2.2)
const IDENTITY_DISPOSITION_KEY = 'onServiceAccount';

/**
 * The binding types 02 §3.3, §3.4 and §3.6 establish as structurally unable to
 * carry a per-user session into the target: there is no per-user session inside
 * an Oracle database, and a wrapped vendor server offering only a static key is
 * treated the same way. `rest` and `function` both have real per-user token
 * exchange (§3.5 row (a)), so a stored credential on either is substitution.
 */
const NON_IDENTITY_CARRYING_BINDING_TYPES = new Set(['database', 'plsql', 'wrapped-vendor']);

function credentialClass(m: IndexedManifest): unknown {
  return get(m.doc, 'binding', 'credentialClass');
}

/**
 * 02 §11.5.1's first named validate rule. If the probe reports the binding DOES
 * carry per-user identity, a stored module credential is not a compensating
 * control — it is a shared credential used in place of one that works, which
 * is the service-account fallback CLAUDE.md #1 forbids outright.
 *
 * GAP (reported, not papered over). This rule fires on the MANIFEST field
 * `binding.identity.carries`, not on the probe report. It is the only carrier
 * of the value available at validate time, and `policy.identity-verified-asserted`
 * independently rejects a manifest that says `verified` — so nothing insecure
 * ships; the rule is watching a place that is correctly always empty. Both
 * rules firing on the same document is correct: one says "you may not assert
 * this", the other says "and if it were true, this credential class would be
 * illegitimate".
 *
 * STATUS AFTER W0-H5 (the probe's identity verification), which landed the
 * artefact this note used to await — corrected here rather than left naming the
 * wrong task, and DELIBERATELY NOT re-pointed:
 *
 *   `probe-report.json` exists now (`core/probe/**`, W0-H4/W0-H5) and carries
 *   the real verdict at `tools[].identity.carries`. It is NOT readable from
 *   here, and the obstacle is a design property rather than a missing import:
 *   the report is a RUNTIME artefact under `.mcpforge/` — an event, not a
 *   definition (02 §1.5) — deliberately absent from git, absent on a clean
 *   clone, and absent in CI, where `forge validate` must still pass. A rule
 *   that read it would either fail every clean checkout or silently skip, and a
 *   silently-skipping security rule is worse than one watching an empty field.
 *   Re-pointing therefore needs a decision this task does not own: whether
 *   `RepoContext` (`validate/types.ts`, today git-borne files only) gains a
 *   probe-report seam, and what `forge validate` does when no report exists.
 *
 *   FLAGGED FOR A HUMAN / A FUTURE TASK (CLAUDE.md §8): that seam is a schema
 *   and interface change reaching every one of the ~40 rules and the CI gate,
 *   so it is named here and left open rather than guessed at. The RUNTIME half
 *   of part 1 — "as reported by the probe, never asserted by a human" — IS
 *   enforced today, by `core/probe/identity/**`: a binding the probe reports as
 *   `verified` cannot be published as anything else, and a `no` or `unverified`
 *   verdict auto-constrains or auto-disables the tool with no manual override.
 */
const storedCredentialNotOnVerifiedIdentity: ValidationRule = {
  id: 'policy.stored-credential-on-verified-identity',
  check(ctx: RepoContext): ValidationFailure[] {
    const out: ValidationFailure[] = [];
    for (const m of tools(ctx)) {
      if (credentialClass(m) !== 'module-scoped-stored') continue;
      if (get(m.doc, 'binding', 'identity', 'carries') !== 'verified') continue;
      out.push(
        fail(
          this.id,
          m.file.file,
          '/binding/credentialClass',
          "credentialClass: module-scoped-stored on a binding reporting identity.carries: verified. A binding that CAN carry the caller's identity may not fall back to a stored module credential — that is substitution, and CLAUDE.md #1 forbids it (02 §11.5.1).",
          "Set binding.credentialClass: per-user-exchanged and exchange the caller identity for a per-user token through the target's trusted token provider. Keep binding.credentialRef only for the exchange client credential, never as the calling identity.",
        ),
      );
    }
    return out;
  },
};

/**
 * 02 §11.5.1's second named validate rule. There is no per-user database
 * session to exchange into: EBS context is initialised inside the wrapper from
 * a git-managed mapping (§3.4), which is the compensating control, not a
 * per-user credential.
 */
const perUserExchangedNotOnPlsql: ValidationRule = {
  id: 'policy.per-user-exchanged-on-plsql',
  check(ctx: RepoContext): ValidationFailure[] {
    const out: ValidationFailure[] = [];
    for (const m of tools(ctx)) {
      if (get(m.doc, 'binding', 'type') !== 'plsql') continue;
      if (credentialClass(m) !== 'per-user-exchanged') continue;
      out.push(
        fail(
          this.id,
          m.file.file,
          '/binding/credentialClass',
          'credentialClass: per-user-exchanged on a plsql binding. There is no per-user session inside the database to exchange into — declaring one claims an identity guarantee the binding cannot keep (02 §11.5.1, §3.4).',
          'Set binding.credentialClass: module-scoped-stored and satisfy all four parts of the stored-credential test: probe-reported non-carriage, a resolved per-user identity with a hard failure on a missing mapping, FND_GLOBAL.APPS_INITIALIZE inside the wrapper echoed into the audit record, and a credential scoped to this module and environment.',
        ),
      );
    }
    return out;
  },
};

/**
 * 02 §11.5.1 — the four-part stored-credential legitimacy test, as a rule that
 * fails naming WHICH of the four parts failed. If any of the four fails, the
 * credential is a service-account fallback and item 1 forbids it.
 *
 * What each part is checked against at validate time, and the limits of that:
 *  1. binding type structurally cannot carry per-user identity, AS REPORTED BY
 *     THE PROBE — checked as (a) the type being one of database/plsql/
 *     wrapped-vendor and (b) `binding.identity.probe` naming a probe binding,
 *     so the claim is probe-backed rather than merely asserted. The probe
 *     REPORT is not readable at validate time (see the gap note on
 *     policy.stored-credential-on-verified-identity, corrected after W0-H5);
 *     the runtime half of this part is enforced by `core/probe/identity/**`.
 *  2. a per-user identity is still resolved and a missing mapping is a hard
 *     failure — the manifest field that carries this is the service-account
 *     disposition, which must be `block` on a write tool. `readonly-lowsens`
 *     is the read-only degradation of §3.5 and cannot stand for a write.
 *  3. a named compensating control carries the identity into the target and is
 *     echoed into the audit record — `binding.identity.echoOn` must not be
 *     `never`.
 *  4. the credential is scoped to one module and one environment — a
 *     `secretRef://binding/<subject>/<purpose>` whose subject names this
 *     tool's module. ENVIRONMENT scoping is not expressible in the SecretRef
 *     format 02 §11.5 fixes, so it is NOT checked here; it is a deployment
 *     property enforced by the store, and this is called out rather than
 *     silently treated as satisfied.
 */
const storedCredentialFourPartTest: ValidationRule = {
  id: 'policy.stored-credential-four-part-test',
  check(ctx: RepoContext): ValidationFailure[] {
    const out: ValidationFailure[] = [];
    for (const m of tools(ctx)) {
      if (credentialClass(m) !== 'module-scoped-stored') continue;
      const file = m.file.file;

      // --- part 1 ---------------------------------------------------------
      const type = get(m.doc, 'binding', 'type');
      const probe = get(m.doc, 'binding', 'identity', 'probe');
      if (typeof type !== 'string' || !NON_IDENTITY_CARRYING_BINDING_TYPES.has(type)) {
        out.push(
          fail(
            this.id,
            file,
            '/binding/type',
            `part 1 FAILED (the binding type structurally cannot carry per-user identity): binding.type ${JSON.stringify(type)} has a per-user identity path, so a stored module credential here is substitution, not compensation (02 §11.5.1 part 1).`,
            'Use binding.credentialClass: per-user-exchanged and exchange the caller identity for a per-user token, or change the binding to one that genuinely cannot carry identity and re-run the probe.',
          ),
        );
      } else if (typeof probe !== 'string' || probe.trim().length === 0) {
        out.push(
          fail(
            this.id,
            file,
            '/binding/identity/probe',
            'part 1 FAILED (the binding type structurally cannot carry per-user identity): no probe binding is named, so non-carriage is asserted by a human rather than reported by the probe — which 02 §11.5.1 part 1 explicitly forbids.',
            "Name the probe binding in binding.identity.probe (e.g. MCPFORGE_PROBE_WHOAMI, or the wrapper's PROBE_COMMIT_BEHAVIOUR sibling for plsql) and run forge probe so the report, not the author, establishes non-carriage.",
          ),
        );
      }

      // --- part 2 ---------------------------------------------------------
      const disposition = get(m.doc, 'binding', 'identity', IDENTITY_DISPOSITION_KEY);
      if (m.doc['write'] === true && disposition !== 'block') {
        out.push(
          fail(
            this.id,
            file,
            `/binding/identity/${IDENTITY_DISPOSITION_KEY}`,
            `part 2 FAILED (a per-user identity is still resolved, and a missing mapping is a hard failure): a write tool with binding.identity.${IDENTITY_DISPOSITION_KEY}: ${JSON.stringify(disposition)} degrades instead of failing. readonly-lowsens is the read-only degradation of 02 §3.5 and may never stand in for a resolved identity on a write (02 §11.5.1 part 2).`,
            `Set binding.identity.${IDENTITY_DISPOSITION_KEY}: block so an unresolved or ambiguous mapping fails the call with IDENTITY_UNRESOLVED, and keep the caller-to-target mapping in overlays/<deployment>/mappings/ where it is diffable and reviewable.`,
          ),
        );
      }

      // --- part 3 ---------------------------------------------------------
      const echoOn = get(m.doc, 'binding', 'identity', 'echoOn');
      if (echoOn === 'never' || echoOn === undefined) {
        out.push(
          fail(
            this.id,
            file,
            '/binding/identity/echoOn',
            `part 3 FAILED (a named compensating control carries that identity into the target, and is echoed back into the audit record): binding.identity.echoOn is ${JSON.stringify(echoOn)}, so nothing proves the identity reached the target (02 §11.5.1 part 3).`,
            'Set binding.identity.echoOn: write (writes) or sampled (reads) so the executing identity the target reports is compared to the caller and written into the audit record as the compensating control.',
          ),
        );
      }

      // --- part 4 ---------------------------------------------------------
      const credentialRef = get(m.doc, 'binding', 'credentialRef');
      const module = m.doc['module'];
      if (typeof credentialRef !== 'string' || !credentialRef.startsWith('secretRef://')) {
        out.push(
          fail(
            this.id,
            file,
            '/binding/credentialRef',
            `part 4 FAILED (the credential is scoped to one module and one environment): binding.credentialRef is ${JSON.stringify(credentialRef)}, not a secretRef:// URI. A credential is a reference, never a value (02 §11.5, CLAUDE.md #8).`,
            'Set binding.credentialRef to secretRef://binding/<module-scoped-subject>/<purpose> — e.g. secretRef://binding/ebs-p2p-ap/wrapper-schema — and store the value in the SecretStore, never in git.',
          ),
        );
      } else {
        const [scope, subject] = credentialRef.slice('secretRef://'.length).split('/');
        const subjectParts = new Set((subject ?? '').split(/[._-]/));
        if (scope !== 'binding') {
          out.push(
            fail(
              this.id,
              file,
              '/binding/credentialRef',
              `part 4 FAILED (the credential is scoped to one module and one environment): the ref's scope is "${String(scope)}", not "binding". A binding credential shared from another scope is one credential across modules, which 02 §11.5 rule 4 forbids.`,
              'Use a binding-scoped ref: secretRef://binding/<subject>/<purpose>. One credential per (binding x module x environment) — a leak then exposes one module in one environment, not the estate.',
            ),
          );
        } else if (typeof module === 'string' && module.length > 0 && !subjectParts.has(module)) {
          out.push(
            fail(
              this.id,
              file,
              '/binding/credentialRef',
              `part 4 FAILED (the credential is scoped to one module and one environment): the ref subject "${String(subject)}" does not name this tool's module "${module}", so it cannot be shown to be scoped to one module (02 §11.5 rule 4, §11.5.1 part 4).`,
              `Name the module in the ref subject — e.g. secretRef://binding/<app>-<something>-${module}/<purpose> — and issue a separate credential per environment.`,
            ),
          );
        }
      }
    }
    return out;
  },
};

export const CREDENTIAL_RULES: readonly ValidationRule[] = [
  storedCredentialNotOnVerifiedIdentity,
  perUserExchangedNotOnPlsql,
  storedCredentialFourPartTest,
];
