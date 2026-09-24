// MCPForge — the `forge codegen` orchestration entry point. W0-B4.
//
// SCOPE BOUNDARY (per TASKS.md W0-B4): this wires the deterministic emit
// *engine* end-to-end and proves it against real Tool manifests, but the
// artefact this pipeline writes per tool is a single, minimal placeholder
// file — not the real schema.json / tool.ts / handler.generated.ts / card /
// docs / role-scope set 02 §2.3 lists. Producing those for real is W0-B6.
//
// What this DOES prove, for every Tool manifest found under `manifests/`:
//   - the manifest's source is hashed (`manifestSha256`)
//   - a provenance header naming that hash and the codegen version is
//     attached to the artefact, in the JSON-pseudo-comment convention
//     `provenance.ts` documents
//   - the artefact is written through the deterministic writer (sorted
//     keys, prettier-formatted, no timestamps, no random ids)
//   - running this twice against an unchanged tree reproduces identical
//     bytes, with or without a prior `generated/` tree on disk

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildCatalogueIndex, type CatalogueIndexToolInput } from '@mcpforge/registry/index';
import { countTokens } from '@mcpforge/shared/tokens';
import { compileGovernanceArtefacts } from '../compile/emit-compiled.js';
import { loadEvalStrings } from '../rules/evals.js';
import { loadEnumNames, loadManifestFiles } from '../validate/loader.js';
import { resolvedKindAndId } from '../validate/structural.js';
import type { IndexedManifest, RepoContext } from '../validate/types.js';
import {
  buildContractTestTs,
  buildDiscoveryCard,
  buildDocsMarkdown,
  buildHandlerTs,
  buildSchemaJson,
  buildToolRegistrationTs,
  buildUnitTestTs,
  cardWireShape,
  DEFAULT_STATUS,
  readTool,
  type ToolView,
} from '../templates/server.js';
import { hasCustomBinding, syncCustomBinding, type ContractDriftFailure } from './custom.js';
import { manifestSha256 } from './hash.js';
import { provenanceJsonFields } from './provenance.js';
import { codegenVersion } from './version.js';
import { serializeJsonDeterministic, writeGeneratedFile } from './writer.js';

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

export interface CodegenReport {
  /** False when any tool's hand-owned binding body drifted from its manifest (W0-B5). */
  readonly ok: boolean;
  /** How many Tool manifests were found and processed. */
  readonly manifestsProcessed: number;
  /** Repo-relative, forward-slash paths of every file written, sorted. */
  readonly filesWritten: readonly string[];
  /**
   * 02 §2.4 — every `CUSTOM_BINDING_CONTRACT_DRIFT`, sorted by tool id. Each
   * names the exact changed fields, the untouched hand-owned file, and the
   * `--accept-contract` fix. Non-empty implies `ok: false` and a non-zero
   * exit from `forge codegen`.
   */
  readonly contractDrift: readonly ContractDriftFailure[];
  /** Tool ids whose hand-owned `binding.custom.ts` stub was created on this run (W0-B5). */
  readonly customBindingsCreated: readonly string[];
}

/**
 * Locate one Tool manifest by its id. Used by `forge codegen
 * --accept-contract <id>`, which acts on exactly one tool and must not run
 * the pipeline.
 */
export function findToolManifest(
  repoRoot: string,
  toolId: string,
): { readonly file: string; readonly doc: unknown } | null {
  for (const file of loadManifestFiles(repoRoot)) {
    const resolved = resolvedKindAndId(file);
    if (resolved && resolved.kind === 'Tool' && resolved.id === toolId) {
      return { file: file.file, doc: file.doc };
    }
  }
  return null;
}

/**
 * Run `forge codegen`'s emit pipeline against `repoRoot`. Deterministic:
 * the only inputs are the manifest files on disk; nothing about the
 * pre-existing state of `generated/` (present, absent, stale) affects the
 * output.
 */
export async function runCodegen(repoRoot: string): Promise<CodegenReport> {
  const files = loadManifestFiles(repoRoot);
  const version = codegenVersion();

  const toolManifests: { readonly file: (typeof files)[number]; readonly id: string }[] = [];
  for (const file of files) {
    const resolved = resolvedKindAndId(file);
    if (resolved && resolved.kind === 'Tool') {
      toolManifests.push({ file, id: resolved.id });
    }
  }
  // Sort by tool id, not filesystem order — filesystem iteration order is
  // not guaranteed to be stable across platforms/filesystems.
  toolManifests.sort((a, b) => a.id.localeCompare(b.id));

  const filesWritten: string[] = [];
  const contractDrift: ContractDriftFailure[] = [];
  const customBindingsCreated: string[] = [];
  // W0-G1 — collected across the loop below so the catalogue index (built
  // after every per-tool artefact, once server/package lookups are also
  // available) never re-reads or re-parses a manifest this loop already did.
  const indexedTools: { readonly tool: ToolView; readonly sha256: string }[] = [];

  for (const { file, id } of toolManifests) {
    const rawSource = readFileSync(file.absPath, 'utf8');
    const sha256 = manifestSha256(rawSource);
    const provenance = { manifestPath: file.file, manifestSha256: sha256, codegenVersion: version };
    const tool = readTool(file.doc);
    indexedTools.push({ tool, sha256 });
    const toolDir = join(repoRoot, 'generated', 'tools', id);

    // 1. schema.json — the callable input JSON Schema (draft 2020-12).
    const schemaJson = buildSchemaJson(tool, provenance);
    const schemaContent = await serializeJsonDeterministic(schemaJson, repoRoot);
    writeGeneratedFile(join(toolDir, 'schema.json'), schemaContent);
    filesWritten.push(toPosix(relative(repoRoot, join(toolDir, 'schema.json'))));

    // 2. tool.ts — gateway registration + policy metadata.
    const toolTs = await buildToolRegistrationTs(tool, provenance, repoRoot);
    writeGeneratedFile(join(toolDir, 'tool.ts'), toolTs);
    filesWritten.push(toPosix(relative(repoRoot, join(toolDir, 'tool.ts'))));

    // 3. handler.generated.ts — validation, two-phase dispatch, guardrails,
    // result-key extraction, audit call sites, error mapping (regenerated
    // wholesale every run — 02 §2.4).
    const handlerTs = await buildHandlerTs(tool, provenance, repoRoot);
    writeGeneratedFile(join(toolDir, 'handler.generated.ts'), handlerTs);
    filesWritten.push(toPosix(relative(repoRoot, join(toolDir, 'handler.generated.ts'))));

    // 4. unit.test.ts — schema-boundary tests only (W0-B7 owns contract tests).
    const unitTestTs = await buildUnitTestTs(tool, provenance, repoRoot);
    writeGeneratedFile(join(toolDir, 'unit.test.ts'), unitTestTs);
    filesWritten.push(toPosix(relative(repoRoot, join(toolDir, 'unit.test.ts'))));

    // 4b. contract.test.ts — full two-phase contract round trips (W0-B7): happy
    // path, every declared error, and, for write tools, dry-run shape,
    // confirm-token binding, argument-mismatch refusal, idempotent replay and
    // the reversal round trip. See `templates/tests/contract-test.ts` for the
    // documented scope boundary against unit.test.ts and the read/write emit
    // judgment call.
    const contractTestTs = await buildContractTestTs(tool, provenance, repoRoot);
    writeGeneratedFile(join(toolDir, 'contract.test.ts'), contractTestTs);
    filesWritten.push(toPosix(relative(repoRoot, join(toolDir, 'contract.test.ts'))));

    // 5. docs — human-readable doc generated from the manifest.
    const docsMd = buildDocsMarkdown(tool, provenance);
    const docsAbsPath = join(repoRoot, 'generated', 'docs', 'tools', `${id}.md`);
    writeGeneratedFile(docsAbsPath, docsMd);
    filesWritten.push(toPosix(relative(repoRoot, docsAbsPath)));

    // 6. discovery card — ≤60 tokens, measured with the pinned counter.
    const card = buildDiscoveryCard(tool, provenance);
    const cardContent = await serializeJsonDeterministic(card, repoRoot);
    const cardAbsPath = join(repoRoot, 'generated', 'cards', `${id}.json`);
    writeGeneratedFile(cardAbsPath, cardContent);
    filesWritten.push(toPosix(relative(repoRoot, cardAbsPath)));
    const cardTokens = countTokens(JSON.stringify(cardWireShape(card)));
    if (cardTokens > 60) {
      throw new Error(
        `Discovery card for ${id} measures ${cardTokens} tokens with the pinned cl100k_base ` +
          `counter — over the 02 §5.3(a) ≤60-token budget. Shorten \`purpose\` (≤14 words) or ` +
          `another card field.`,
      );
    }

    // W0-B5 / 02 §2.4 — the hand-owned half of the three-file split. Created
    // once, then never written again while its contract hash holds; a changed
    // contract fails the build and leaves the file untouched.
    if (hasCustomBinding(file.doc)) {
      const result = await syncCustomBinding({
        repoRoot,
        toolId: id,
        doc: file.doc,
        manifestPath: file.file,
        manifestSha256: sha256,
        codegenVersion: version,
      });
      filesWritten.push(...result.filesWritten);
      if (result.action === 'created') customBindingsCreated.push(id);
      if (result.drift) contractDrift.push(result.drift);
    }
  }

  // W0-B8 — the governance artefacts: role scopes (globs resolved to an
  // explicit sorted tool-id list, with bindingGrants beside them), package
  // selections, and consumer authorizations. This SUPERSEDES the minimal
  // W0-B6 per-tool `coreForRoles` role-scope stub, which has been removed:
  // `generated/roles/<id>.scope.json` now has exactly one writer, and it
  // compiles `roles/<id>.yaml` as 02 §4.3 specifies.
  const manifests: IndexedManifest[] = [];
  for (const file of files) {
    const resolved = resolvedKindAndId(file);
    if (resolved) {
      manifests.push({
        file,
        kind: resolved.kind,
        id: resolved.id,
        doc: (file.doc ?? {}) as Record<string, unknown>,
      });
    }
  }
  const ctx: RepoContext = {
    repoRoot,
    files,
    manifests,
    enumNames: loadEnumNames(repoRoot),
  };
  const compiled = await compileGovernanceArtefacts(ctx, version);
  filesWritten.push(...compiled.filesWritten);

  // W0-G1 — the catalogue index build artefact, 02 §5.4.1.
  // `generated/index/catalogue-index.json`, loaded into gateway memory at
  // boot by `@mcpforge/registry/index`'s `loadCatalogueIndex`.
  {
    const serversById = new Map(
      manifests.filter((m) => m.kind === 'Server').map((m) => [m.id, m] as const),
    );
    const packages = manifests.filter((m) => m.kind === 'Package');

    const catalogueInputs: CatalogueIndexToolInput[] = indexedTools.map(({ tool }) => {
      const server = serversById.get(tool.server);
      const serverLabel = typeof server?.doc['label'] === 'string' ? server.doc['label'] : null;
      // JUDGMENT CALL (flagged in W0-G1's final report): 02 §5.4.1 names
      // "module label" and "app label" as two distinct lexical-document
      // fields, but `kind: Server` (core/shared/src/manifest/server.ts) has
      // only ONE combined `label` (e.g. "JD Edwards Financials — Accounts
      // Payable"), and no manifest kind carries an app-level label at all.
      // Until a human splits that field, the server's combined label stands
      // in for "module label", and the bare app code stands in for "app
      // label" rather than inventing a value no manifest asserts.
      const moduleLabel = serverLabel ?? tool.module;
      const appLabel = tool.app;

      // JUDGMENT CALL (also flagged): `packageTags[]` is named in 02 §5.4.1
      // but no manifest field carries it directly. Computed here as the
      // sorted set of Package ids whose `servers` list includes this tool's
      // `server` — the only structural link a Tool has to a Package.
      const packageTags = packages
        .filter((p) => Array.isArray(p.doc['servers']) && p.doc['servers'].includes(tool.server))
        .map((p) => p.id)
        .sort();

      return {
        id: tool.id,
        title: tool.title,
        purpose: tool.purpose,
        aliases: tool.aliases,
        disambiguation: tool.disambiguation,
        entity: tool.entity,
        verb: tool.verb,
        app: tool.app,
        module: tool.module,
        appLabel,
        moduleLabel,
        functionalArea: tool.functionalArea,
        bindingType: tool.bindingType,
        archetype: tool.archetype,
        sensitivity: tool.sensitivity,
        write: tool.write,
        processTags: tool.processTags,
        packageTags,
        roles: tool.coreForRoles,
        status: DEFAULT_STATUS,
      };
    });

    const evalIntents = new Set(loadEvalStrings(repoRoot).keys());
    const catalogueIndex = buildCatalogueIndex(catalogueInputs, evalIntents);

    // A single aggregate provenance pair (02 §2.3's JSON pseudo-comment
    // convention) covering every tool manifest that fed the index, sorted by
    // id to match `catalogueIndex.tools`'s own ordering — so the hash moves
    // if, and only if, a tool manifest that is actually indexed changes.
    const combinedHash = manifestSha256(
      [...indexedTools]
        .sort((a, b) => a.tool.id.localeCompare(b.tool.id))
        .map((t) => t.sha256)
        .join('\n'),
    );
    const indexProvenance = provenanceJsonFields({
      manifestPath: 'manifests/**/*.tool.yaml',
      manifestSha256: combinedHash,
      codegenVersion: version,
    });

    const indexAbsPath = join(repoRoot, 'generated', 'index', 'catalogue-index.json');
    const indexContent = await serializeJsonDeterministic(
      { ...indexProvenance, ...catalogueIndex },
      repoRoot,
    );
    writeGeneratedFile(indexAbsPath, indexContent);
    filesWritten.push(toPosix(relative(repoRoot, indexAbsPath)));
  }

  filesWritten.sort();
  contractDrift.sort((a, b) => a.toolId.localeCompare(b.toolId));
  customBindingsCreated.sort();
  return {
    ok: contractDrift.length === 0,
    manifestsProcessed: toolManifests.length,
    filesWritten,
    contractDrift,
    customBindingsCreated,
  };
}
