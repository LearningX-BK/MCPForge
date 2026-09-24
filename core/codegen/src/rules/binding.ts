// MCPForge — W0-B3 binding-type policy rules. CLAUDE.md non-negotiables #2 and
// #3; 02 §2.2's validate list, §3.3 (database read-only), §3.4 (the wrapper-only
// PL/SQL ref), §3.5 (echoOn: write on function writes).
//
//   policy.expedited-review-elevated-binding — plsql/function reject expedited review
//   policy.identity-verified-asserted        — identity.carries: verified in a manifest
//   policy.database-write                    — write: true + binding.type: database
//   policy.plsql-wrapper-ref                 — plsql binding.ref must be MCPFORGE_WRAP.<PKG>.<PROC>
//   policy.function-write-echo               — echoOn: write on every function write tool

import type { RepoContext, ValidationFailure, ValidationRule } from '../validate/types.js';
import { fail, get, tools } from './helpers.js';
// Factored out to its own fs-free module — see that file's header — so the
// portal's `/build` review-path check (W0-J14) can import the SAME Set
// without pulling in `./helpers.js`'s `node:fs` dependency.
export { ELEVATED_BINDING_TYPES } from './elevated-binding-types.js';
import { ELEVATED_BINDING_TYPES } from './elevated-binding-types.js';

/** 02 §3.4 rule 3 — anonymous PL/SQL is structurally impossible; the ref names a wrapper procedure. */
export const PLSQL_WRAPPER_REF_RE = /^MCPFORGE_WRAP\.[A-Z0-9_]+\.[A-Z0-9_]+$/;

const expeditedReviewRejectedForElevatedBindings: ValidationRule = {
  id: 'policy.expedited-review-elevated-binding',
  check(ctx: RepoContext): ValidationFailure[] {
    const out: ValidationFailure[] = [];
    for (const m of tools(ctx)) {
      const type = get(m.doc, 'binding', 'type');
      if (typeof type !== 'string' || !ELEVATED_BINDING_TYPES.has(type)) continue;
      if (get(m.doc, 'governance', 'reviewPath') !== 'expedited') continue;
      out.push(
        fail(
          this.id,
          m.file.file,
          '/governance/reviewPath',
          `binding.type: ${type} with governance.reviewPath: expedited. Expedited review is structurally unavailable for plsql and function bindings (02 §2.2, §11.4) — they are the elevated-posture handshakes.`,
          'Set governance.reviewPath: standard. If the change is genuinely low risk, that is an argument for a smaller change, not a shorter review.',
        ),
      );
    }
    return out;
  },
};

/**
 * CLAUDE.md non-negotiable #2. `verified` is written by the capability probe,
 * into the probe report, and never into a manifest — not by a human, not by an
 * agent. The tool schema's manifest-side enum already omits it; this rule is
 * the policy statement, and it fires on the raw document so that it cannot be
 * evaded by a manifest that is unparseable to the schema for other reasons.
 */
const identityVerifiedNeverAsserted: ValidationRule = {
  id: 'policy.identity-verified-asserted',
  check(ctx: RepoContext): ValidationFailure[] {
    const out: ValidationFailure[] = [];
    for (const m of tools(ctx)) {
      if (get(m.doc, 'binding', 'identity', 'carries') !== 'verified') continue;
      out.push(
        fail(
          this.id,
          m.file.file,
          '/binding/identity/carries',
          'binding.identity.carries: verified asserted in a hand-authored manifest. Only the capability probe may ever write "verified", and it writes it into the probe report — never back into a manifest (CLAUDE.md #2, 02 §2.2, §3.5).',
          'Set binding.identity.carries: unverified and name the probe binding in binding.identity.probe (e.g. MCPFORGE_PROBE_WHOAMI). Run forge probe against the instance; the probe report, not this file, records whether identity is carried.',
        ),
      );
    }
    return out;
  },
};

/**
 * CLAUDE.md non-negotiable #3 / 02 §3.3. `database` bindings are read-only by
 * policy — writes go through a `plsql` wrapper package, never raw DML. The
 * §3.3 `policyException` path does NOT relax this rule: it is an approval for
 * a non-application data store, granted outside the manifest, and it puts the
 * tool into elevated posture (02 §11.4.7). Nothing in a manifest may switch
 * this check off.
 */
const databaseBindingsAreReadOnly: ValidationRule = {
  id: 'policy.database-write',
  check(ctx: RepoContext): ValidationFailure[] {
    const out: ValidationFailure[] = [];
    for (const m of tools(ctx)) {
      if (m.doc['write'] !== true) continue;
      if (get(m.doc, 'binding', 'type') !== 'database') continue;
      out.push(
        fail(
          this.id,
          m.file.file,
          '/binding/type',
          'write: true with binding.type: database. Database bindings are read-only by policy — an agent-triggered DML statement against an application schema is exactly the risk class this rule removes (CLAUDE.md #3, 02 §3.3).',
          'Author the write as a plsql binding against a MCPFORGE_WRAP wrapper package (binding.ref: MCPFORGE_WRAP.<PACKAGE>.<PROCEDURE>), or set write: false and keep this tool a read.',
        ),
      );
    }
    return out;
  },
};

const plsqlRefNamesWrapperProcedure: ValidationRule = {
  id: 'policy.plsql-wrapper-ref',
  check(ctx: RepoContext): ValidationFailure[] {
    const out: ValidationFailure[] = [];
    for (const m of tools(ctx)) {
      if (get(m.doc, 'binding', 'type') !== 'plsql') continue;
      const ref = get(m.doc, 'binding', 'ref');
      if (typeof ref === 'string' && PLSQL_WRAPPER_REF_RE.test(ref)) continue;
      out.push(
        fail(
          this.id,
          m.file.file,
          '/binding/ref',
          `plsql binding.ref ${JSON.stringify(ref)} does not match ^MCPFORGE_WRAP\\.[A-Z0-9_]+\\.[A-Z0-9_]+$. The MCPForge database user holds EXECUTE on the wrapper schema only and no grant at all on APPS-owned packages (02 §3.4).`,
          'Point binding.ref at a wrapper procedure — MCPFORGE_WRAP.<PACKAGE>.<PROCEDURE> — and author that wrapper so it initialises the EBS context per call from the caller identity the gateway supplies. Never name an APPS package directly, and never an anonymous block.',
        ),
      );
    }
    return out;
  },
};

/**
 * 02 §3.5. The runtime echo is what catches an instance whose SSO configuration
 * silently changes — on the next write, not at the next quarterly probe. The
 * document states the requirement as the literal value `write`; this rule
 * enforces that literally rather than accepting `always` as "stronger", so a
 * deliberate widening has to be argued in a change proposal.
 */
const functionWritesEchoIdentity: ValidationRule = {
  id: 'policy.function-write-echo',
  check(ctx: RepoContext): ValidationFailure[] {
    const out: ValidationFailure[] = [];
    for (const m of tools(ctx)) {
      if (m.doc['write'] !== true) continue;
      if (get(m.doc, 'binding', 'type') !== 'function') continue;
      const echoOn = get(m.doc, 'binding', 'identity', 'echoOn');
      if (echoOn === 'write') continue;
      out.push(
        fail(
          this.id,
          m.file.file,
          '/binding/identity/echoOn',
          `function write tool with binding.identity.echoOn: ${JSON.stringify(echoOn)}. echoOn: write is mandatory for every write tool in a function binding — the gateway asserts the executing identity the target reports back matches the caller before recording success (02 §3.5).`,
          'Set binding.identity.echoOn: write and compose the orchestration with a final step that returns the executing user.',
        ),
      );
    }
    return out;
  },
};

export const BINDING_RULES: readonly ValidationRule[] = [
  expeditedReviewRejectedForElevatedBindings,
  identityVerifiedNeverAsserted,
  databaseBindingsAreReadOnly,
  plsqlRefNamesWrapperProcedure,
  functionWritesEchoIdentity,
];
