// MCPForge — building the catalogue index (02 §5.4.1). W0-G1.

import type { CatalogueIndex, CatalogueIndexEntry, CatalogueIndexToolInput } from './types.js';

/** Normalise a string the same way `policy.eval-alias-leak` does: trim, lower-case. Case and surrounding whitespace are not a defence against a verbatim leak. */
function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * 02 §5.4.1: "What is deliberately NOT indexed: the benchmark intents...
 * `forge validate` fails if any string in `evals/**` appears verbatim in an
 * `aliases` list." That is `policy.eval-alias-leak`
 * (`core/codegen/src/rules/evals.ts`, W0-B3) — a validate-time rule that can
 * be skipped (nothing forces `forge validate` to run before `forge
 * codegen`). This is the SAME check run again at index-build time, as a
 * second, independent gate directly on the artefact this task owns, so a
 * leaked benchmark intent can never reach `generated/index/catalogue-index.json`
 * even if validate was skipped. `evalIntents` is caller-supplied (normalised
 * or not — this function normalises again) rather than this package reading
 * `evals/**` itself, keeping `@mcpforge/registry` a pure function of its
 * inputs with no filesystem knowledge of its own.
 */
export interface EvalAliasLeak {
  readonly toolId: string;
  readonly alias: string;
}

/** Every `(tool, alias)` pair where `alias` matches an eval intent verbatim (case/whitespace-insensitive). Empty means clean. */
export function findEvalAliasLeaks(
  tools: readonly CatalogueIndexToolInput[],
  evalIntents: ReadonlySet<string>,
): readonly EvalAliasLeak[] {
  if (evalIntents.size === 0) return [];
  const normalizedIntents = new Set([...evalIntents].map(normalize));
  const out: EvalAliasLeak[] = [];
  for (const tool of tools) {
    for (const alias of tool.aliases) {
      if (normalizedIntents.has(normalize(alias))) {
        out.push({ toolId: tool.id, alias });
      }
    }
  }
  return out;
}

function lexicalDocument(tool: CatalogueIndexToolInput): string {
  const idParts = tool.id.split(/[._-]/).filter((p) => p.length > 0);
  return [
    tool.title,
    tool.purpose,
    ...tool.aliases,
    tool.entity,
    tool.moduleLabel,
    tool.appLabel,
    tool.functionalArea,
    ...idParts,
  ]
    .filter((part) => part.trim().length > 0)
    .join(' ');
}

function buildEntry(tool: CatalogueIndexToolInput): CatalogueIndexEntry {
  return {
    id: tool.id,
    filters: {
      app: tool.app,
      module: tool.module,
      entity: tool.entity,
      verb: tool.verb,
      bindingType: tool.bindingType,
      archetype: tool.archetype,
      sensitivity: tool.sensitivity,
      write: tool.write,
      processTags: [...tool.processTags].sort(),
      packageTags: [...tool.packageTags].sort(),
      roles: [...tool.roles].sort(),
      status: tool.status,
    },
    lexicalDocument: lexicalDocument(tool),
    disambiguation: tool.disambiguation,
  };
}

/**
 * Build the catalogue index from plain per-tool inputs. Deterministic: pure
 * function of `tools` and `evalIntents`, sorted by id regardless of input
 * order, no clock/random-id reads. Throws — never emits a partial or
 * best-effort artefact — when a benchmark intent has leaked into an
 * `aliases` list; the thrown message names every offending `(tool, alias)`
 * pair so the failure is immediately actionable, matching CLAUDE.md
 * non-negotiable #5's "actionable, never dead-end" discipline even though
 * this is a build-time failure rather than a caller-facing tool error.
 */
export function buildCatalogueIndex(
  tools: readonly CatalogueIndexToolInput[],
  evalIntents: ReadonlySet<string>,
): CatalogueIndex {
  const leaks = findEvalAliasLeaks(tools, evalIntents);
  if (leaks.length > 0) {
    const detail = leaks.map((l) => `  ${l.toolId}: ${JSON.stringify(l.alias)}`).join('\n');
    throw new Error(
      `Catalogue index build refused — ${leaks.length} alias(es) leak a benchmark intent verbatim ` +
        `(02 §5.4.1: "Indexing the eval set would make the benchmark measure itself"):\n${detail}\n` +
        `Fix: reword the alias so it is genuine domain vocabulary, or change the intent in evals/ ` +
        `(the steward owns that file) — do not index the intent string itself.`,
    );
  }

  const sorted = [...tools].sort((a, b) => a.id.localeCompare(b.id));
  return { tools: sorted.map(buildEntry) };
}
