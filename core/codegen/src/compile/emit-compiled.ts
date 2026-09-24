// MCPForge — writing the compiled governance artefacts. W0-B8.
//
// Three artefacts, all through the SAME deterministic writer every other
// generated file uses (emit/writer.ts): sorted keys, repo prettier config, no
// timestamps, LF, one trailing newline. That is what makes "widening a grant
// produces a visible diff" true — the diff is visible because the bytes are a
// pure function of the manifests, so the ONLY thing that can move them is a
// real change to a role, a package or a consumer record.
//
//   generated/roles/<id>.scope.json               (02 §4.3)
//   generated/packages/<id>.selection.json        (02 §6.1)
//   generated/consumers/<id>.authorization.json   ([P5] 02 §11.2)
//
// DETERMINISM CAVEAT, documented rather than hidden: grant and registration
// expiry are compared against a calendar date, so the day a grant's expiresAt
// passes, its compiled artefact flips `expired: false` -> `true` with no
// manifest edit. That is a genuine, intended diff — an expiry is a real change
// of authorization state and CI noticing it is the point — but it does mean
// the regeneration invariant is "byte-identical for a given day", not "for
// all time". `today` is injectable so tests pin it.

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { manifestSha256 } from '../emit/hash.js';
import type { ProvenanceInfo } from '../emit/provenance.js';
import { serializeJsonDeterministic, writeGeneratedFile } from '../emit/writer.js';
import type { IndexedManifest, RepoContext } from '../validate/types.js';
import { compileConsumerAuthorization } from './consumer.js';
import { manifestsOfKind, readConsumer, readPackage, readRole } from './model.js';
import { compilePackageSelection } from './package.js';
import { compileRoleScope, todayIso, type IsoDate } from './role.js';
import { loadApprovalRecords } from './standing.js';

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

function provenanceFor(m: IndexedManifest, codegenVersion: string): ProvenanceInfo {
  let sha: string;
  try {
    sha = manifestSha256(readFileSync(m.file.absPath, 'utf8'));
  } catch {
    // An unreadable manifest still gets an artefact with an EMPTY hash rather
    // than a plausible-looking one — provenance must never claim more than it knows.
    sha = '';
  }
  return { manifestPath: m.file.file, manifestSha256: sha, codegenVersion };
}

export interface CompileArtefactsResult {
  /** Repo-relative, forward-slash paths written, sorted. */
  readonly filesWritten: readonly string[];
  /** roleId -> compiled explicit tool-id list, for callers that need it in-process. */
  readonly roleScopes: ReadonlyMap<string, readonly string[]>;
}

/**
 * Compile every Role, Package and Consumer manifest in `ctx` and write its
 * artefact. Roles are compiled FIRST because a package's selection is the
 * union of its roles' compiled scopes.
 */
export async function compileGovernanceArtefacts(
  ctx: RepoContext,
  codegenVersion: string,
  options: { readonly today?: IsoDate } = {},
): Promise<CompileArtefactsResult> {
  const today = options.today ?? todayIso();
  const repoRoot = ctx.repoRoot;
  const catalogue = manifestsOfKind(ctx, 'Tool')
    .map((m) => m.id)
    .sort();

  // [W0-N4] Read ONCE. Every role and every consumer resolves its standing
  // authorizations against the same snapshot of `approvals/`, so two artefacts
  // compiled in one run can never disagree about whether a record exists.
  const approvals = loadApprovalRecords(repoRoot);

  const filesWritten: string[] = [];
  const roleScopes = new Map<string, readonly string[]>();

  const roles = [...manifestsOfKind(ctx, 'Role')].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const m of roles) {
    const compiled = compileRoleScope(
      readRole(m),
      catalogue,
      provenanceFor(m, codegenVersion),
      today,
      approvals,
    );
    roleScopes.set(m.id, compiled.toolIds);
    const abs = join(repoRoot, 'generated', 'roles', `${m.id}.scope.json`);
    writeGeneratedFile(abs, await serializeJsonDeterministic(compiled.artefact, repoRoot));
    filesWritten.push(toPosix(relative(repoRoot, abs)));
  }

  const packages = [...manifestsOfKind(ctx, 'Package')].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const m of packages) {
    const compiled = compilePackageSelection(
      readPackage(m),
      roleScopes,
      provenanceFor(m, codegenVersion),
    );
    const abs = join(repoRoot, 'generated', 'packages', `${m.id}.selection.json`);
    writeGeneratedFile(abs, await serializeJsonDeterministic(compiled.artefact, repoRoot));
    filesWritten.push(toPosix(relative(repoRoot, abs)));
  }

  const consumers = [...manifestsOfKind(ctx, 'Consumer')].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const m of consumers) {
    const compiled = compileConsumerAuthorization(
      readConsumer(m),
      provenanceFor(m, codegenVersion),
      today,
      approvals,
    );
    const abs = join(repoRoot, 'generated', 'consumers', `${m.id}.authorization.json`);
    writeGeneratedFile(abs, await serializeJsonDeterministic(compiled.artefact, repoRoot));
    filesWritten.push(toPosix(relative(repoRoot, abs)));
  }

  filesWritten.sort();
  return { filesWritten, roleScopes };
}
