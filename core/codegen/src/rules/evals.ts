// MCPForge — W0-B3 benchmark-integrity rule. 02 §5.4.1.
//
//   policy.eval-alias-leak — no string in evals/** may appear verbatim in any
//                            `aliases` list.
//
// "What is deliberately NOT indexed: the benchmark intents. Indexing the eval
// set would make the benchmark measure itself." Aliases are the highest-leverage
// discovery field in the manifest, which is exactly why copying an intent into
// one turns a retrieval benchmark into a lookup of its own answer key. Small
// rule, large integrity consequence — and it is exercised again by W0-G1 when
// the catalogue index is built.

import { join, relative } from 'node:path';
import type { RepoContext, ValidationFailure, ValidationRule } from '../validate/types.js';
import { fail, isRecord, readYaml, tools, walkYamlFiles } from './helpers.js';

/** Collect every string scalar in a document — an intent may sit under any key shape. */
function collectStrings(node: unknown, out: Map<string, string>, source: string): void {
  if (typeof node === 'string') {
    const key = node.trim().toLowerCase();
    if (key.length > 0 && !out.has(key)) out.set(key, source);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, out, source);
    return;
  }
  if (!isRecord(node)) return;
  for (const value of Object.values(node)) collectStrings(value, out, source);
}

/**
 * Every string appearing anywhere under `evals/`, keyed by its normalised form.
 * Comparison is case- and surrounding-whitespace-insensitive: "verbatim" in the
 * spec means the same string, and a capitalisation change is not a meaningful
 * defence against the benchmark measuring itself.
 */
export function loadEvalStrings(repoRoot: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const absPath of walkYamlFiles(join(repoRoot, 'evals'))) {
    const rel = relative(repoRoot, absPath).split('\\').join('/');
    collectStrings(readYaml(absPath), out, rel);
  }
  return out;
}

const noEvalIntentInAliases: ValidationRule = {
  id: 'policy.eval-alias-leak',
  check(ctx: RepoContext): ValidationFailure[] {
    const evalStrings = loadEvalStrings(ctx.repoRoot);
    if (evalStrings.size === 0) return [];

    const out: ValidationFailure[] = [];
    for (const m of tools(ctx)) {
      const aliases = m.doc['aliases'];
      if (!Array.isArray(aliases)) continue;
      aliases.forEach((alias, i) => {
        if (typeof alias !== 'string') return;
        const source = evalStrings.get(alias.trim().toLowerCase());
        if (source === undefined) return;
        out.push(
          fail(
            this.id,
            m.file.file,
            `/aliases/${i}`,
            `alias ${JSON.stringify(alias)} appears verbatim in ${source}. Indexing a benchmark intent as an alias makes the discovery benchmark measure itself (02 §5.4.1).`,
            'Delete this alias, or reword it so it is genuine domain vocabulary rather than the intent string. If the benchmark intent is the natural business phrasing, change the INTENT in evals/ — the steward owns that file — and leave the catalogue honest.',
          ),
        );
      });
    }
    return out;
  },
};

export const EVAL_RULES: readonly ValidationRule[] = [noEvalIntentInAliases];
