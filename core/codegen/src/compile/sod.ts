// MCPForge — segregation-of-duties detection over compiled role scopes. W0-B8.
//
// 02 §4.3: "`forge validate` walks each role for declared `conflict` pairs and
// for the implicit pattern (`create` and `approve` verbs on the same
// `{app}.{module}.{entity}`). A conflict produces a build WARNING plus a
// required `sodException` record naming an approver, or a build FAILURE if
// `disposition: block`."
//
// Two halves, and they are not interchangeable:
//   sod.declared-conflict        — an authored pair, both of whose tools the
//                                  role's compiled scope actually grants.
//                                  disposition: block  -> error (build fails)
//                                  anything else       -> warning
//   sod.implicit-create-approve  — the create/approve pattern on one entity,
//                                  detected whether or not anyone declared it.
//                                  Always reported. Reported EVEN WHEN a
//                                  declared conflict covers it: suppressing it
//                                  would mean a role author could hide the
//                                  pattern from the report by declaring it
//                                  with disposition `warn`, which is the
//                                  wrong direction for a control.
//
// Both halves run against the COMPILED scope (the resolved globs), not against
// `includes` as text — a pattern cannot be reasoned about, an explicit id list
// can. This is the design-time half of the pair 02 §4.3 describes; the runtime
// half is the `sodConflict` guardrail at call time (§3.1.3), which is the
// gateway's concern, not this task's.

import type { RepoContext, ValidationFailure, ValidationRule } from '../validate/types.js';
import { entityPrefix, toolVerb } from './glob.js';
import { manifestsOfKind, readRole } from './model.js';
import { compileRoleScope, todayIso } from './role.js';

const NO_PROVENANCE = { manifestPath: '', manifestSha256: '', codegenVersion: '' };

/** The verb pair 02 §4.3 names as the implicit pattern. */
export const IMPLICIT_SOD_VERBS = ['create', 'approve'] as const;

function toolIdsFor(ctx: RepoContext): string[] {
  return manifestsOfKind(ctx, 'Tool')
    .map((m) => m.id)
    .sort();
}

const declaredConflict: ValidationRule = {
  id: 'sod.declared-conflict',
  check(ctx: RepoContext): ValidationFailure[] {
    const catalogue = toolIdsFor(ctx);
    const today = todayIso();
    const out: ValidationFailure[] = [];
    for (const m of manifestsOfKind(ctx, 'Role')) {
      const role = readRole(m);
      const { toolIds } = compileRoleScope(role, catalogue, NO_PROVENANCE, today);
      const inScope = new Set(toolIds);
      for (const c of role.segregationOfDuties) {
        if (c.conflict.length < 2) continue;
        const realised = c.conflict.filter((t) => inScope.has(t));
        if (realised.length < c.conflict.length) continue;
        const block = c.disposition === 'block';
        out.push({
          ruleId: this.id,
          severity: block ? 'error' : 'warning',
          file: m.file.file,
          path: `/segregationOfDuties/${c.index}`,
          message:
            `Role "${role.id}" grants every tool of the declared segregation-of-duties ` +
            `conflict [${c.conflict.join(', ')}] — the compiled scope in ` +
            `generated/roles/${role.id}.scope.json contains all of them. ` +
            (block
              ? 'disposition is "block", so this fails the build (02 §4.3).'
              : `disposition is "${c.disposition}", so this is a warning and needs a recorded exception naming an approver (02 §4.3).`),
          fix: block
            ? `Narrow roles/${role.id}.yaml so the compiled scope cannot contain both — add an "excludes" entry for one of [${c.conflict.join(', ')}], or split the role. Changing the disposition away from "block" to make the build pass is the escalation this rule exists to stop; that requires a fresh approval record, not an edit.`
            : `Either narrow roles/${role.id}.yaml's includes/excludes so the pair is not granted together, or commit the approval record under approvals/ naming the approver who accepted this conflict, and reference it from the change proposal.`,
        });
      }
    }
    return out;
  },
};

const implicitCreateApprove: ValidationRule = {
  id: 'sod.implicit-create-approve',
  check(ctx: RepoContext): ValidationFailure[] {
    const catalogue = toolIdsFor(ctx);
    const today = todayIso();
    const out: ValidationFailure[] = [];
    for (const m of manifestsOfKind(ctx, 'Role')) {
      const role = readRole(m);
      const { toolIds } = compileRoleScope(role, catalogue, NO_PROVENANCE, today);

      // entity prefix -> verbs present in this role's compiled scope.
      const byEntity = new Map<string, Set<string>>();
      for (const id of toolIds) {
        const prefix = entityPrefix(id);
        const verb = toolVerb(id);
        if (prefix === null || verb === null) continue;
        const set = byEntity.get(prefix) ?? new Set<string>();
        set.add(verb);
        byEntity.set(prefix, set);
      }

      const declaredPairs = role.segregationOfDuties.map((c) => new Set(c.conflict));

      for (const prefix of [...byEntity.keys()].sort()) {
        const verbs = byEntity.get(prefix)!;
        if (!IMPLICIT_SOD_VERBS.every((v) => verbs.has(v))) continue;
        const pair = IMPLICIT_SOD_VERBS.map((v) => `${prefix}.${v}`);
        const declared = declaredPairs.some((set) => pair.every((t) => set.has(t)));
        out.push({
          ruleId: this.id,
          // 02 §4.3 attaches `disposition` to a DECLARED conflict. An
          // undeclared pattern has no disposition, so it is reported as a
          // warning; declaring it with disposition: block is how a steward
          // turns it into a build failure.
          severity: 'warning',
          file: m.file.file,
          path: '/includes',
          message:
            `Role "${role.id}" grants both ${pair[0]} and ${pair[1]} — the implicit ` +
            `create/approve segregation-of-duties pattern on ${prefix} (02 §4.3). ` +
            (declared
              ? 'It is also declared in segregationOfDuties, which is where its disposition is decided.'
              : 'It is NOT declared in this role\'s segregationOfDuties, so nobody has recorded a decision about it.'),
          fix: declared
            ? `No action beyond the declared entry in roles/${role.id}.yaml; this line exists so the pattern is never invisible in the report.`
            : `Add a segregationOfDuties entry to roles/${role.id}.yaml naming the conflict [${pair.join(', ')}] with an explicit disposition (block, warn-and-require-exception, or warn), or exclude one of the two so the role cannot grant both.`,
        });
      }
    }
    return out;
  },
};

/** The W0-B8 segregation-of-duties rule set, plugged into the W0-B2 ValidationRule seam. */
export const SOD_RULES: readonly ValidationRule[] = [declaredConflict, implicitCreateApprove];
