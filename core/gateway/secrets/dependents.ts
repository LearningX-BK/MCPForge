// MCPForge — what "a dependent of a secret" means. W0-N6, 02 §11.5 rule 6.
//
// Rule 6: "`forge secrets revoke <ref> --reason "…"` invalidates the value
// **and kill-switches everything referencing it in the same operation**, using
// §4.7's flags mechanism."
//
// "Everything referencing it" is not a vague phrase in this repository — it is
// two typed fields in two git artefacts, and this file is the exhaustive list
// of them:
//
//   * `binding.credentialRef` on a Tool manifest (core/shared manifest/tool.ts,
//     added by the Phase 5 correction 02 §11.5.1) — the credential a binding
//     holds under the four-part stored-credential test. Its kill target is the
//     TOOL, at 02 §4.7's `tool` granularity.
//
//   * `credential.ref` on a Consumer record (core/shared manifest/consumer.ts,
//     02 §11.2) — the client credential a registered consumer authenticates
//     with. Its kill target is the CONSUMER, at the `consumer` granularity
//     W0-E5 wired in from day one.
//
// **Why a scan of git rather than a query of the store.** Both fields live in
// reviewed git artefacts, which is the whole point of §11.5 rule 1 — a
// credential reference is a committed fact, so the set of dependents is
// knowable without the runtime having recorded a single call. A store-derived
// answer ("who has USED this credential", `audit_credential_ref`, rule 3)
// answers a different and strictly narrower question: it cannot name a binding
// that holds the credential but has not been called yet, and revoking on that
// basis would leave exactly the untouched dependents live. So: git for WHO MAY
// use it (this file, and what revocation acts on), audit for WHO DID (rule 3,
// the forensic query). Conflating the two fails open.
//
// **Fail closed on an unreadable artefact.** A file under `manifests/` or
// `consumers/` that does not parse is reported as a FAILURE, never skipped.
// `revokeSecret` refuses to proceed while any failure stands, because a
// manifest this scanner could not read is precisely where an unnoticed
// reference to the revoked credential would hide.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';

/** One artefact that references a `secretRef://`, and how the kill switch names it. */
export interface SecretDependent {
  readonly kind: 'tool' | 'consumer';
  /** The tool id or consumer id. */
  readonly id: string;
  /** The `forge kill` target string — a bare tool id, or `consumer:<id>`. */
  readonly killTarget: string;
  /** Repo-relative, forward-slash. */
  readonly file: string;
  /** Which field carried the reference. */
  readonly field: 'binding.credentialRef' | 'credential.ref';
}

/** An artefact that could not be read. Never silently dropped — see the header. */
export interface DependentScanFailure {
  readonly file: string;
  readonly message: string;
}

export interface SecretDependentScan {
  readonly ref: string;
  readonly dependents: readonly SecretDependent[];
  readonly failures: readonly DependentScanFailure[];
}

const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', '.git', 'generated']);

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

function walkYaml(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current)) {
      if (SKIP_DIR_NAMES.has(entry)) continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) stack.push(full);
      else if (entry.endsWith('.yaml') || entry.endsWith('.yml')) out.push(full);
    }
  }
  return out.sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every Tool manifest and Consumer record whose credential reference is `ref`.
 *
 * Matching is on the exact ref string. A `secretRef://` is a whole identity —
 * scope, subject and purpose together — so a prefix or substring match would
 * let revoking `secretRef://binding/ebs-p2p-ap/wrapper-schema` also kill
 * `…/wrapper-schema-readonly`, which is a different credential under rule 4's
 * one-credential-per-(binding × module × environment).
 */
export function findSecretDependents(repoRoot: string, ref: string): SecretDependentScan {
  const dependents: SecretDependent[] = [];
  const failures: DependentScanFailure[] = [];

  const consider = (absPath: string, handle: (doc: Record<string, unknown>) => void): void => {
    const file = toPosix(relative(repoRoot, absPath));
    let doc: unknown;
    try {
      doc = parseYaml(readFileSync(absPath, 'utf8'));
    } catch (err) {
      failures.push({ file, message: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (!isRecord(doc)) {
      // An empty or scalar YAML document under manifests/ or consumers/ is not
      // a manifest. It is reported rather than ignored: it may be a truncated
      // file that DID reference the credential before it was mangled.
      failures.push({ file, message: 'not a YAML mapping; cannot be checked for a credentialRef' });
      return;
    }
    handle(doc);
  };

  for (const absPath of walkYaml(join(repoRoot, 'manifests'))) {
    consider(absPath, (doc) => {
      const binding = doc['binding'];
      if (!isRecord(binding)) return; // a Server manifest has no binding — legitimately.
      if (binding['credentialRef'] !== ref) return;
      const id = doc['id'];
      const file = toPosix(relative(repoRoot, absPath));
      if (typeof id !== 'string' || id.length === 0) {
        failures.push({
          file,
          message: `references ${ref} but has no string "id"; its kill target cannot be named`,
        });
        return;
      }
      dependents.push({
        kind: 'tool',
        id,
        killTarget: id,
        file,
        field: 'binding.credentialRef',
      });
    });
  }

  for (const absPath of walkYaml(join(repoRoot, 'consumers'))) {
    const base = toPosix(absPath).split('/').pop() as string;
    if (!base.endsWith('.consumer.yaml') && !base.endsWith('.consumer.yml')) continue;
    consider(absPath, (doc) => {
      const credential = doc['credential'];
      if (!isRecord(credential) || credential['ref'] !== ref) return;
      const id = doc['id'];
      const file = toPosix(relative(repoRoot, absPath));
      if (typeof id !== 'string' || id.length === 0) {
        failures.push({
          file,
          message: `references ${ref} but has no string "id"; its kill target cannot be named`,
        });
        return;
      }
      dependents.push({
        kind: 'consumer',
        id,
        killTarget: `consumer:${id}`,
        file,
        field: 'credential.ref',
      });
    });
  }

  dependents.sort((a, b) => a.killTarget.localeCompare(b.killTarget));
  return { ref, dependents, failures };
}
