// MCPForge — referential-integrity rules for `forge validate`. W0-B2.
//
// Checks that are NOT expressible in JSON Schema alone because they reach
// across files: a Tool's `server` must name a Server manifest that exists; an
// `enumRef` must name a file under `enums/`; a Role's `coreTools` and
// `segregationOfDuties` conflicts must name real Tool ids; a Package's
// `servers`/`roles` must name real Server/Role manifests; a Consumer's
// `authorizations.roles`/`packages` must name real Role/Package manifests; a
// write tool's `reversal.tool` and `sodConflict` guardrail's `with` must name
// real Tool ids. 02 §2.2's referential-integrity list; the ~40 policy rules
// (W0-B3) are a separate, later concern and are not implemented here.

import type { IndexedManifest, RepoContext, ValidationFailure, ValidationRule } from './types.js';

function fail(
  ruleId: string,
  file: string,
  path: string,
  message: string,
  fix: string,
): ValidationFailure {
  return { ruleId, file, path, message, fix };
}

/**
 * A finding that is REPORTED but does not fail the build — the same
 * `severity` mechanism W0-B8 added to `ValidationFailure` (absent means
 * error; only an explicit `warning` is downgraded). Used by exactly two
 * rules — `ref.role-core-tool-not-found` and `ref.role-sod-tool-not-found` —
 * under a named, human-approved exception recorded during W0-I1: Track I
 * authors Server/Role/Package scaffolding (W0-I1) BEFORE the Tool manifests
 * that fill it in (W0-I3/I4/I5), so a Role naming a not-yet-authored tool is
 * an expected intermediate state, not a misconfiguration. Every other
 * referential rule stays a hard failure.
 */
function warn(
  ruleId: string,
  file: string,
  path: string,
  message: string,
  fix: string,
): ValidationFailure {
  return { ruleId, file, path, message, fix, severity: 'warning' };
}

function byKindAndId(
  manifests: readonly IndexedManifest[],
  kind: IndexedManifest['kind'],
): Set<string> {
  return new Set(manifests.filter((m) => m.kind === kind).map((m) => m.id));
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function get(doc: Record<string, unknown>, ...path: string[]): unknown {
  let cur: unknown = doc;
  for (const key of path) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

// --- Tool.server -> Server -----------------------------------------------------

const toolServerExists: ValidationRule = {
  id: 'ref.server-not-found',
  check(ctx: RepoContext): ValidationFailure[] {
    const serverIds = byKindAndId(ctx.manifests, 'Server');
    const out: ValidationFailure[] = [];
    for (const m of ctx.manifests) {
      if (m.kind !== 'Tool') continue;
      const server = m.doc['server'];
      if (typeof server !== 'string') continue;
      if (!serverIds.has(server)) {
        out.push(
          fail(
            this.id,
            m.file.file,
            '/server',
            `server "${server}" does not match any Server manifest id.`,
            `Create manifests/_servers/${server}.server.yaml with kind: Server and id: ${server}, or fix the "server" field on this Tool to name an existing Server manifest.`,
          ),
        );
      }
    }
    return out;
  },
};

// --- Tool.input[].enumRef -> enums/<name>.yaml ---------------------------------

const toolEnumRefExists: ValidationRule = {
  id: 'ref.enum-not-found',
  check(ctx: RepoContext): ValidationFailure[] {
    const out: ValidationFailure[] = [];
    for (const m of ctx.manifests) {
      if (m.kind !== 'Tool') continue;
      const inputs = m.doc['input'];
      if (!Array.isArray(inputs)) continue;
      inputs.forEach((input, i) => {
        if (typeof input !== 'object' || input === null) return;
        const enumRef = (input as Record<string, unknown>)['enumRef'];
        if (typeof enumRef !== 'string') return;
        if (!ctx.enumNames.has(enumRef)) {
          out.push(
            fail(
              this.id,
              m.file.file,
              `/input/${i}/enumRef`,
              `enumRef "${enumRef}" does not match any lookup list under enums/.`,
              `Create enums/${enumRef}.yaml with the allowed values, or fix "enumRef" to name an existing file under enums/.`,
            ),
          );
        }
      });
    }
    return out;
  },
};

// --- writeSafety.reversal.tool -> Tool (when class: compensating-tool) --------

const reversalToolExists: ValidationRule = {
  id: 'ref.reversal-tool-not-found',
  check(ctx: RepoContext): ValidationFailure[] {
    const toolIds = byKindAndId(ctx.manifests, 'Tool');
    const out: ValidationFailure[] = [];
    for (const m of ctx.manifests) {
      if (m.kind !== 'Tool') continue;
      const reversal = get(m.doc, 'writeSafety', 'reversal');
      if (typeof reversal !== 'object' || reversal === null) continue;
      const r = reversal as Record<string, unknown>;
      if (r['class'] !== 'compensating-tool') continue;
      const tool = r['tool'];
      if (typeof tool !== 'string') continue;
      if (!toolIds.has(tool)) {
        out.push(
          fail(
            this.id,
            m.file.file,
            '/writeSafety/reversal/tool',
            `reversal.tool "${tool}" does not match any Tool manifest id.`,
            `Author the reversing tool manifest for "${tool}" (its id is immutable once created), or fix "writeSafety.reversal.tool" to name an existing Tool.`,
          ),
        );
      }
    }
    return out;
  },
};

// --- writeSafety.guardrails[].with -> Tool (sodConflict) -----------------------

const guardrailWithToolExists: ValidationRule = {
  id: 'ref.guardrail-tool-not-found',
  check(ctx: RepoContext): ValidationFailure[] {
    const toolIds = byKindAndId(ctx.manifests, 'Tool');
    const out: ValidationFailure[] = [];
    for (const m of ctx.manifests) {
      if (m.kind !== 'Tool') continue;
      const guardrails = get(m.doc, 'writeSafety', 'guardrails');
      if (!Array.isArray(guardrails)) continue;
      guardrails.forEach((g, i) => {
        if (typeof g !== 'object' || g === null) return;
        const gr = g as Record<string, unknown>;
        const withTool = gr['with'];
        if (typeof withTool !== 'string') return;
        if (!toolIds.has(withTool)) {
          out.push(
            fail(
              this.id,
              m.file.file,
              `/writeSafety/guardrails/${i}/with`,
              `guardrail "with" tool "${withTool}" does not match any Tool manifest id.`,
              `Fix "writeSafety.guardrails[${i}].with" to name an existing Tool id, or author that tool's manifest first.`,
            ),
          );
        }
      });
    }
    return out;
  },
};

// --- Role.coreTools[] -> Tool ---------------------------------------------------
//
// WARNING, not failure — see `warn()` above. A Role manifest is authored
// ahead of its tools by design (W0-I1 before W0-I3/I4/I5), so a dangling
// coreTools id is advisory. It is still emitted on every run and still shows
// in `forge validate --json` under `warnings`, so it stays visible in CI.

const roleCoreToolsExist: ValidationRule = {
  id: 'ref.role-core-tool-not-found',
  check(ctx: RepoContext): ValidationFailure[] {
    const toolIds = byKindAndId(ctx.manifests, 'Tool');
    const out: ValidationFailure[] = [];
    for (const m of ctx.manifests) {
      if (m.kind !== 'Role') continue;
      const coreTools = m.doc['coreTools'];
      if (!isStringArray(coreTools)) continue;
      coreTools.forEach((toolId, i) => {
        if (!toolIds.has(toolId)) {
          out.push(
            warn(
              this.id,
              m.file.file,
              `/coreTools/${i}`,
              `coreTools entry "${toolId}" does not match any Tool manifest id yet.`,
              `Author the Tool manifest for "${toolId}" (expected until its tools are authored — W0-I3/I4/I5), or remove/fix this coreTools entry. Advisory: a warning, not a build failure, because Role manifests are authored ahead of their tools.`,
            ),
          );
        }
      });
    }
    return out;
  },
};

// --- Role.segregationOfDuties[].conflict[] -> Tool -----------------------------
//
// WARNING, not failure — same named exception as `coreTools` above. Note this
// downgrade is about the tool id being UNRESOLVED, not about the conflict
// itself: 02 §4.3's segregation-of-duties detection (compile/sod.ts) is
// untouched, and a `disposition: block` conflict between two REAL tools still
// fails the build there.

const roleSodToolsExist: ValidationRule = {
  id: 'ref.role-sod-tool-not-found',
  check(ctx: RepoContext): ValidationFailure[] {
    const toolIds = byKindAndId(ctx.manifests, 'Tool');
    const out: ValidationFailure[] = [];
    for (const m of ctx.manifests) {
      if (m.kind !== 'Role') continue;
      const sod = m.doc['segregationOfDuties'];
      if (!Array.isArray(sod)) continue;
      sod.forEach((rule, i) => {
        if (typeof rule !== 'object' || rule === null) return;
        const conflict = (rule as Record<string, unknown>)['conflict'];
        if (!isStringArray(conflict)) return;
        conflict.forEach((toolId, j) => {
          if (!toolIds.has(toolId)) {
            out.push(
              warn(
                this.id,
                m.file.file,
                `/segregationOfDuties/${i}/conflict/${j}`,
                `segregationOfDuties conflict entry "${toolId}" does not match any Tool manifest id yet.`,
                `Author the Tool manifest for "${toolId}" (expected while its tools are still unauthored — W0-I3/I4/I5), or fix this segregationOfDuties.conflict entry. Advisory: this is a warning, not a build failure, because Role manifests are authored ahead of their tools.`,
              ),
            );
          }
        });
      });
    }
    return out;
  },
};

// --- Package.servers[] -> Server, Package.roles[] -> Role ---------------------

const packageServersExist: ValidationRule = {
  id: 'ref.package-server-not-found',
  check(ctx: RepoContext): ValidationFailure[] {
    const serverIds = byKindAndId(ctx.manifests, 'Server');
    const out: ValidationFailure[] = [];
    for (const m of ctx.manifests) {
      if (m.kind !== 'Package') continue;
      const servers = m.doc['servers'];
      if (!isStringArray(servers)) continue;
      servers.forEach((id, i) => {
        if (!serverIds.has(id)) {
          out.push(
            fail(
              this.id,
              m.file.file,
              `/servers/${i}`,
              `servers entry "${id}" does not match any Server manifest id.`,
              `Fix "servers[${i}]" to name an existing Server manifest, or author that server first. A package is a selection, never a build.`,
            ),
          );
        }
      });
    }
    return out;
  },
};

const packageRolesExist: ValidationRule = {
  id: 'ref.package-role-not-found',
  check(ctx: RepoContext): ValidationFailure[] {
    const roleIds = byKindAndId(ctx.manifests, 'Role');
    const out: ValidationFailure[] = [];
    for (const m of ctx.manifests) {
      if (m.kind !== 'Package') continue;
      const roles = m.doc['roles'];
      if (!isStringArray(roles)) continue;
      roles.forEach((id, i) => {
        if (!roleIds.has(id)) {
          out.push(
            fail(
              this.id,
              m.file.file,
              `/roles/${i}`,
              `roles entry "${id}" does not match any Role manifest id.`,
              `Fix "roles[${i}]" to name an existing Role manifest, or author that role first.`,
            ),
          );
        }
      });
    }
    return out;
  },
};

// --- Consumer.authorizations.roles[]/.packages[] -------------------------------

const consumerRolesExist: ValidationRule = {
  id: 'ref.consumer-role-not-found',
  check(ctx: RepoContext): ValidationFailure[] {
    const roleIds = byKindAndId(ctx.manifests, 'Role');
    const out: ValidationFailure[] = [];
    for (const m of ctx.manifests) {
      if (m.kind !== 'Consumer') continue;
      const roles = get(m.doc, 'authorizations', 'roles');
      if (!isStringArray(roles)) continue;
      roles.forEach((id, i) => {
        if (!roleIds.has(id)) {
          out.push(
            fail(
              this.id,
              m.file.file,
              `/authorizations/roles/${i}`,
              `authorizations.roles entry "${id}" does not match any Role manifest id.`,
              `Fix "authorizations.roles[${i}]" to name an existing Role manifest, or author that role first.`,
            ),
          );
        }
      });
    }
    return out;
  },
};

const consumerPackagesExist: ValidationRule = {
  id: 'ref.consumer-package-not-found',
  check(ctx: RepoContext): ValidationFailure[] {
    const packageIds = byKindAndId(ctx.manifests, 'Package');
    const out: ValidationFailure[] = [];
    for (const m of ctx.manifests) {
      if (m.kind !== 'Consumer') continue;
      const packages = get(m.doc, 'authorizations', 'packages');
      if (!isStringArray(packages)) continue;
      packages.forEach((id, i) => {
        if (!packageIds.has(id)) {
          out.push(
            fail(
              this.id,
              m.file.file,
              `/authorizations/packages/${i}`,
              `authorizations.packages entry "${id}" does not match any Package manifest id.`,
              `Fix "authorizations.packages[${i}]" to name an existing Package manifest, or author that package first.`,
            ),
          );
        }
      });
    }
    return out;
  },
};

// --- duplicate ids within one kind ----------------------------------------------

const noDuplicateIds: ValidationRule = {
  id: 'ref.duplicate-id',
  check(ctx: RepoContext): ValidationFailure[] {
    const seen = new Map<string, IndexedManifest>();
    const out: ValidationFailure[] = [];
    for (const m of ctx.manifests) {
      const key = `${m.kind}:${m.id}`;
      const prior = seen.get(key);
      if (prior) {
        out.push(
          fail(
            this.id,
            m.file.file,
            '/id',
            `id "${m.id}" (kind: ${m.kind}) is already used by ${prior.file.file}. Ids are immutable and unique per kind.`,
            `Rename one of the two manifests' id, or delete the duplicate. A rename is a retire-and-create pair, both recorded (CLAUDE.md §5).`,
          ),
        );
      } else {
        seen.set(key, m);
      }
    }
    return out;
  },
};

/** The complete W0-B2 referential-integrity rule set. */
export const REFERENTIAL_RULES: readonly ValidationRule[] = [
  toolServerExists,
  toolEnumRefExists,
  reversalToolExists,
  guardrailWithToolExists,
  roleCoreToolsExist,
  roleSodToolsExist,
  packageServersExist,
  packageRolesExist,
  consumerRolesExist,
  consumerPackagesExist,
  noDuplicateIds,
];
