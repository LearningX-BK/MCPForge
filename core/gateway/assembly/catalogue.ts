// MCPForge — W0-P13. The runtime catalogue resolver: `manifests/` (validated by
// `forge validate`'s own rules) + the committed `generated/` artefacts ->
// everything the policy chain and the executors need per tool.
//
// OWNER DECISION, 25 Sep 2026 (TASKS.md W0-P13): the catalogue is sourced from
// the MANIFESTS, through codegen's own reader and codegen's own rules, not from
// `generated/tools/<id>/tool.ts`. The generated registration is incomplete for
// runtime use: it has no plan template, confirm TTL, reversal argMap, result
// keys, server id, execution caps or `echoOn`. So:
//
//   1. `validateRepo` — the identical function `forge validate` runs, with its
//      default rule set (structural + referential + policy). ANY failure
//      refuses to start, naming the rule. There is no "start with the tools
//      that passed": a repo that does not validate is not a catalogue.
//   2. Every Tool manifest is read with codegen's `readTool` (one parser, never
//      a second hand-rolled one).
//   3. Every tool is cross-checked against what codegen COMMITTED for it: the
//      `manifest-sha256` provenance header of `tool.ts` and `schema.json`
//      against the manifest's own bytes, the registration's fields against the
//      manifest view, and `schema.json` against what codegen would emit from
//      this manifest today. Drift refuses to start. A missing generated tree,
//      or a generated tree with no manifest, also refuses.
//   4. Only then are the runtime objects built: the `PolicyCatalogueEntry`, the
//      `WriteSafetyView`, the reversal registry, the `function` binding
//      descriptor (the adapter's own builder) and the compiled-Ajv 6d
//      validator over the COMMITTED `schema.json` (the adapter's own compile —
//      never a second hand-written validator, CLAUDE.md §5).
//
// Nothing here restates a manifest value and nothing defaults one: a write
// tool whose manifest lacks a plan template, TTL or dry-run strategy has
// already failed `forge validate`, and if one still reached this module it is
// refused here rather than filled in.
//
// SCOPE: this module resolves; it does not serve, dispatch or construct an
// executor (W0-P16/P17/P11 own those, and the execution-grant tripwire in
// tests/policy/escalation.trust-boundary.test.ts still lists no constructor).

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BINDING_TYPES,
  REVERSAL_CLASSES,
  SENSITIVITIES,
  type BindingType,
  type Guardrail,
  type ReversalClass,
  type Sensitivity,
} from '@mcpforge/shared';
import type { ToolManifest } from '@mcpforge/shared/manifest';
import {
  loadManifestFiles,
  resolvedKindAndId,
  validateRepo,
  type ValidationFailure,
} from '@mcpforge/codegen/validate';
import { buildSchemaJson, readTool, type ToolView } from '@mcpforge/codegen/templates';
import { codegenVersion, manifestSha256, sortKeysDeep } from '@mcpforge/codegen/emit';
import {
  buildFunctionBindingDescriptor,
  compileGeneratedSchema,
  type CompiledSchemaValidator,
  type FunctionBindingDescriptor,
} from '@mcpforge/adapter-function';
import type { ArgumentValidator, PolicyCatalogueEntry } from '../policy/types.js';
import type { WriteSafetyView } from '../policy/confirm/gate.js';
import { reversalRegistry } from '../reversal/registry.js';
import type { ReversalContract, ReversalRegistry } from '../reversal/types.js';

// --- refusal ------------------------------------------------------------------

/** One reason the gateway will not start. Shaped like a `forge validate` failure. */
export interface CatalogueLoadFailure {
  /** `forge validate`'s own rule id, or an `assembly.*` id for a drift/resolve failure. */
  readonly ruleId: string;
  /** Repo-relative path of the offending file. */
  readonly file: string;
  readonly message: string;
  /** What a human does about it. Never "try again" (CLAUDE.md #5). */
  readonly fix: string;
}

/**
 * Thrown by `loadRuntimeCatalogue` when the gateway must not start. This is a
 * startup refusal, not a caller-visible error: no session exists yet, so there
 * is no MCP error envelope to carry it.
 */
export class CatalogueLoadRefused extends Error {
  readonly failures: readonly CatalogueLoadFailure[];
  constructor(failures: readonly CatalogueLoadFailure[]) {
    const lines = failures.map((f) => `  [${f.ruleId}] ${f.file}: ${f.message} — ${f.fix}`);
    super(
      `The gateway refused to start: the runtime catalogue did not resolve (${failures.length} failure${failures.length === 1 ? '' : 's'}).\n${lines.join('\n')}`,
    );
    this.name = 'CatalogueLoadRefused';
    this.failures = failures;
  }
}

// --- the resolved catalogue ------------------------------------------------------

/** Everything the runtime holds for one tool. Frozen. */
export interface ResolvedTool {
  readonly toolId: string;
  /** Repo-relative path of the source manifest. */
  readonly manifestFile: string;
  /** Codegen's own view of the manifest. */
  readonly view: ToolView;
  readonly entry: PolicyCatalogueEntry;
  /** Present exactly when the tool is a write tool. */
  readonly writeSafety: WriteSafetyView | undefined;
  /** Present exactly when the tool is a write tool. */
  readonly reversal: ReversalContract | undefined;
  /** Present exactly when `binding.type` is `function`. */
  readonly functionDescriptor: FunctionBindingDescriptor | undefined;
  /** The committed `generated/tools/<id>/schema.json`, as parsed. */
  readonly schema: Readonly<Record<string, unknown>>;
  /** Compiled Ajv over `schema`. */
  readonly validate: CompiledSchemaValidator;
}

export interface RuntimeCatalogue {
  /** Tool ids, sorted. */
  readonly toolIds: readonly string[];
  readonly tools: ReadonlyMap<string, ResolvedTool>;
  /** The chain's `PolicyContext.catalogue`. */
  readonly entries: readonly PolicyCatalogueEntry[];
  entryFor(toolId: string): PolicyCatalogueEntry | undefined;
  /** The confirm gate's `ConfirmGateDeps.writeSafetyFor`. */
  writeSafetyFor(toolId: string): WriteSafetyView | undefined;
  readonly reversals: ReversalRegistry;
  functionDescriptorFor(toolId: string): FunctionBindingDescriptor | undefined;
  /** The executor's `FunctionCallInput.validate` — the same compiled function 6d uses. */
  schemaValidatorFor(toolId: string): CompiledSchemaValidator | undefined;
  /** Stage 6d. Fails closed for a tool this catalogue does not hold. */
  readonly argumentValidator: ArgumentValidator;
  /** `forge validate` warnings (reported, never fatal — 02 §4.3). */
  readonly warnings: readonly ValidationFailure[];
}

export interface LoadRuntimeCatalogueOptions {
  /** The repository (or deployed image) root holding `manifests/` and `generated/`. */
  readonly repoRoot: string;
}

// --- load ------------------------------------------------------------------------

/**
 * Resolve the runtime catalogue, or throw `CatalogueLoadRefused`. Asynchronous
 * only because each committed `tool.ts` is imported as a module, exactly as a
 * reviewer reads it; nothing here touches the network.
 */
export async function loadRuntimeCatalogue(
  options: LoadRuntimeCatalogueOptions,
): Promise<RuntimeCatalogue> {
  const { repoRoot } = options;

  // 1. forge validate — its own function, its own default rules.
  const report = validateRepo(repoRoot);
  if (!report.ok) {
    throw new CatalogueLoadRefused(
      report.failures.map((f) => ({
        ruleId: f.ruleId,
        file: f.file,
        message: f.message,
        fix: f.fix,
      })),
    );
  }

  // 2. every Tool manifest, through codegen's reader.
  const toolFiles = loadManifestFiles(repoRoot)
    .map((file) => ({ file, resolved: resolvedKindAndId(file) }))
    .filter((m) => m.resolved?.kind === 'Tool');

  const failures: CatalogueLoadFailure[] = [];
  const generatedToolsDir = join(repoRoot, 'generated', 'tools');
  const generatedIds = existsSync(generatedToolsDir)
    ? readdirSync(generatedToolsDir).filter((n) =>
        statSync(join(generatedToolsDir, n)).isDirectory(),
      )
    : [];
  const manifestIds = new Set(toolFiles.map((m) => m.resolved!.id));
  for (const orphan of generatedIds.filter((id) => !manifestIds.has(id)).sort()) {
    failures.push({
      ruleId: 'assembly.generated-orphan',
      file: `generated/tools/${orphan}`,
      message: `generated/tools/${orphan} has no manifest under manifests/.`,
      fix: 'Run `forge codegen` so the generated tree matches manifests/, and commit the result.',
    });
  }

  const tools = new Map<string, ResolvedTool>();
  for (const { file } of toolFiles) {
    const resolved = await resolveTool(repoRoot, file.absPath, file.file, file.doc, failures);
    if (resolved !== undefined) tools.set(resolved.toolId, resolved);
  }

  // 3b. cross-tool: a declared reversing tool must be in this catalogue, or the
  //     reversal the audit row freezes names a tool the gateway cannot run.
  for (const tool of tools.values()) {
    const reversingTool = tool.reversal?.tool;
    if (reversingTool !== undefined && !tools.has(reversingTool)) {
      failures.push({
        ruleId: 'assembly.reversal-tool-unresolved',
        file: tool.manifestFile,
        message: `${tool.toolId} declares reversal.tool ${reversingTool}, which did not resolve into the runtime catalogue.`,
        fix: `Fix ${reversingTool}'s own failure above, or correct writeSafety.reversal.tool in ${tool.manifestFile}.`,
      });
    }
  }

  if (failures.length > 0) throw new CatalogueLoadRefused(failures);

  return buildCatalogue(tools, report.warnings);
}

// --- one tool -----------------------------------------------------------------------

interface GeneratedRegistration {
  readonly id: unknown;
  readonly version: unknown;
  readonly write: unknown;
  readonly sensitivity: unknown;
  readonly binding: { readonly type: unknown; readonly ref: unknown };
  readonly writeSafety: {
    readonly humanApprovalRequired: unknown;
    readonly reversalClass: unknown;
    readonly reversalTool: unknown;
    readonly dryRunStrategy: unknown;
    readonly idempotencyScopeHours: unknown;
    readonly guardrails: unknown;
  } | null;
  readonly governance: { readonly policyException: unknown };
}

const SHA_HEADER = /manifest-sha256:\s*([0-9a-f]{64})/;

async function resolveTool(
  repoRoot: string,
  manifestAbsPath: string,
  manifestFile: string,
  doc: unknown,
  failures: CatalogueLoadFailure[],
): Promise<ResolvedTool | undefined> {
  const view = readTool(doc);
  const id = view.id;
  const genDir = join(repoRoot, 'generated', 'tools', id);
  const genRel = `generated/tools/${id}`;
  const fail = (ruleId: string, file: string, message: string, fix: string): undefined => {
    failures.push({ ruleId, file, message, fix });
    return undefined;
  };
  const regenFix = `Run \`forge codegen\` and commit generated/tools/${id}/, or revert the manifest change.`;

  const toolTsPath = join(genDir, 'tool.ts');
  const schemaPath = join(genDir, 'schema.json');
  if (!existsSync(toolTsPath) || !existsSync(schemaPath)) {
    return fail(
      'assembly.generated-missing',
      genRel,
      `${id} has a manifest (${manifestFile}) but no generated tool.ts and schema.json.`,
      regenFix,
    );
  }

  // --- provenance: the committed artefacts were generated from THESE bytes.
  const sha = manifestSha256(readFileSync(manifestAbsPath, 'utf8'));
  const toolTsText = readFileSync(toolTsPath, 'utf8');
  const schemaText = readFileSync(schemaPath, 'utf8');
  const toolTsSha = SHA_HEADER.exec(toolTsText)?.[1];
  let schema: Record<string, unknown>;
  try {
    schema = JSON.parse(schemaText) as Record<string, unknown>;
  } catch (error) {
    return fail(
      'assembly.schema-unparseable',
      `${genRel}/schema.json`,
      `schema.json is not JSON: ${error instanceof Error ? error.message : String(error)}.`,
      regenFix,
    );
  }
  const schemaSha = SHA_HEADER.exec(String(schema['//2'] ?? ''))?.[1];
  let drifted = false;
  for (const [file, headerSha] of [
    [`${genRel}/tool.ts`, toolTsSha],
    [`${genRel}/schema.json`, schemaSha],
  ] as const) {
    if (headerSha !== sha) {
      drifted = true;
      fail(
        'assembly.manifest-sha256',
        file,
        `was generated from a different ${manifestFile} (header ${headerSha ?? 'missing'}, manifest ${sha}).`,
        regenFix,
      );
    }
  }
  if (drifted) return undefined;

  // --- schema.json is byte-for-byte what codegen emits from this manifest today.
  const expectedSchema = buildSchemaJson(view, {
    manifestPath: manifestFile,
    manifestSha256: sha,
    codegenVersion: codegenVersion(),
  });
  if (JSON.stringify(sortKeysDeep(expectedSchema)) !== JSON.stringify(sortKeysDeep(schema))) {
    return fail(
      'assembly.schema-drift',
      `${genRel}/schema.json`,
      `does not match what forge codegen emits from ${manifestFile}.`,
      regenFix,
    );
  }

  // --- the registration agrees with the manifest, field by field.
  let registration: GeneratedRegistration;
  try {
    const mod = (await import(pathToFileURL(toolTsPath).href)) as {
      toolRegistration?: GeneratedRegistration;
    };
    if (mod.toolRegistration === undefined) throw new Error('no toolRegistration export');
    registration = mod.toolRegistration;
  } catch (error) {
    return fail(
      'assembly.registration-unloadable',
      `${genRel}/tool.ts`,
      `could not be loaded: ${error instanceof Error ? error.message : String(error)}.`,
      regenFix,
    );
  }
  const mismatches = registrationMismatches(view, registration);
  if (mismatches.length > 0) {
    return fail(
      'assembly.registration-drift',
      `${genRel}/tool.ts`,
      `has drifted from ${manifestFile}: ${mismatches.join('; ')}.`,
      regenFix,
    );
  }

  // --- the runtime objects.
  try {
    const manifest = doc as ToolManifest;
    const reversal = view.write ? reversalContractFor(manifest, view) : undefined;
    const writeSafety = view.write ? writeSafetyViewFor(view, reversal!) : undefined;
    const entry = catalogueEntryFor(view, reversal);
    const functionDescriptor =
      view.bindingType === 'function' ? buildFunctionBindingDescriptor(manifest) : undefined;
    const validate = compileGeneratedSchema(schema);
    return Object.freeze({
      toolId: id,
      manifestFile,
      view,
      entry,
      writeSafety,
      reversal,
      functionDescriptor,
      schema: Object.freeze(schema),
      validate,
    });
  } catch (error) {
    return fail(
      'assembly.resolve',
      manifestFile,
      `${id} passed forge validate but could not be resolved: ${error instanceof Error ? error.message : String(error)}.`,
      `Fix ${manifestFile}; this is also a gap in forge validate's rules — name it so a rule can catch it at authoring time.`,
    );
  }
}

/** The fields W0-F8's store-world checked, for every tool, plus policyException. */
function registrationMismatches(view: ToolView, reg: GeneratedRegistration): string[] {
  const out: string[] = [];
  const check = (field: string, fromManifest: unknown, fromGenerated: unknown): void => {
    if (JSON.stringify(fromManifest) !== JSON.stringify(fromGenerated)) {
      out.push(
        `${field}: manifest=${JSON.stringify(fromManifest)} generated=${JSON.stringify(fromGenerated)}`,
      );
    }
  };
  check('id', view.id, reg.id);
  check('version', view.version, reg.version);
  check('write', view.write, reg.write);
  check('sensitivity', view.sensitivity, reg.sensitivity);
  check('binding.type', view.bindingType, reg.binding?.type);
  check('binding.ref', view.bindingRef, reg.binding?.ref);
  check('governance.policyException', view.policyException, reg.governance?.policyException);
  const ws = view.writeSafety;
  const gws = reg.writeSafety;
  if (ws === null || gws === null) {
    check('writeSafety', ws === null ? null : 'present', gws === null ? null : 'present');
    return out;
  }
  check('writeSafety.humanApprovalRequired', ws.humanApprovalRequired, gws.humanApprovalRequired);
  check('writeSafety.reversal.class', ws.reversalClass, gws.reversalClass);
  check('writeSafety.reversal.tool', ws.reversalTool, gws.reversalTool);
  check('writeSafety.dryRun.strategy', ws.dryRunStrategy, gws.dryRunStrategy);
  check('writeSafety.idempotency.scopeHours', ws.idempotencyScopeHours, gws.idempotencyScopeHours);
  check('writeSafety.guardrails', ws.guardrails, gws.guardrails);
  return out;
}

// --- manifest -> runtime views ----------------------------------------------------
//
// Narrowing is by CHECKING: a value outside a closed list throws (and becomes an
// `assembly.resolve` refusal) rather than being cast into the catalogue.

function oneOf<T extends string>(list: readonly T[], value: string | null, what: string): T {
  if (value === null || !(list as readonly string[]).includes(value)) {
    throw new Error(`${what} ${JSON.stringify(value)} is not one of ${list.join(', ')}`);
  }
  return value as T;
}

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined || value === '') {
    throw new Error(`write tool declares no ${what}`);
  }
  return value;
}

function reversalContractFor(manifest: ToolManifest, view: ToolView): ReversalContract {
  const ws = required(view.writeSafety, 'writeSafety block');
  // `windowHours`/`preconditions` are not on codegen's flat view; they are read
  // off the same validated document the view was read from.
  const raw = manifest.writeSafety?.reversal;
  const cls: ReversalClass = oneOf(
    REVERSAL_CLASSES,
    ws.reversalClass,
    'writeSafety.reversal.class',
  );
  return Object.freeze({
    class: cls,
    ...(ws.reversalTool === null ? {} : { tool: ws.reversalTool }),
    ...(Object.keys(ws.reversalArgMap).length === 0
      ? {}
      : { argMap: Object.freeze({ ...ws.reversalArgMap }) }),
    ...(typeof raw?.windowHours === 'number' ? { windowHours: raw.windowHours } : {}),
    ...(typeof raw?.preconditions === 'string' ? { preconditions: raw.preconditions } : {}),
  });
}

function writeSafetyViewFor(view: ToolView, reversal: ReversalContract): WriteSafetyView {
  const ws = required(view.writeSafety, 'writeSafety block');
  const dryRunStrategy = required(ws.dryRunStrategy, 'writeSafety.dryRun.strategy');
  if (dryRunStrategy === 'none') throw new Error('write tool declares dryRun.strategy none');
  return Object.freeze({
    toolId: view.id,
    toolVersion: view.version,
    planTemplate: required(ws.planTemplate, 'writeSafety.confirm.planTemplate'),
    tokenTtlSeconds: required(ws.confirmTokenTtlSeconds, 'writeSafety.confirm.tokenTtlSeconds'),
    humanApprovalRequired: ws.humanApprovalRequired,
    reversal,
    dryRunStrategy,
    entity: view.entity,
    verb: view.verb,
  });
}

function catalogueEntryFor(
  view: ToolView,
  reversal: ReversalContract | undefined,
): PolicyCatalogueEntry {
  const ws = view.writeSafety;
  return Object.freeze({
    toolId: view.id,
    serverId: required(view.server, 'server'),
    bindingType: oneOf<BindingType>(BINDING_TYPES, view.bindingType, 'binding.type'),
    sensitivity: oneOf<Sensitivity>(SENSITIVITIES, view.sensitivity, 'sensitivity'),
    write: view.write,
    toolVersion: view.version,
    bindingRef: required(view.bindingRef, 'binding.ref'),
    policyException: view.policyException,
    resultKeys: Object.freeze(view.resultKeys.map((k) => Object.freeze({ ...k }))),
    ...(ws === null
      ? {}
      : {
          humanApprovalRequired: ws.humanApprovalRequired,
          guardrails: Object.freeze([...(ws.guardrails as readonly Guardrail[])]),
        }),
    ...(reversal === undefined ? {} : { reversal }),
  });
}

// --- assembly ---------------------------------------------------------------------------

function describeAjvErrors(validate: CompiledSchemaValidator): string {
  const errs = validate.errors ?? [];
  if (errs.length === 0) return 'arguments failed schema validation';
  return errs
    .map(
      (e) =>
        `${e.instancePath && e.instancePath.length > 0 ? e.instancePath : '(root)'} ${e.message ?? 'is invalid'}`,
    )
    .join('; ');
}

function buildCatalogue(
  tools: ReadonlyMap<string, ResolvedTool>,
  warnings: readonly ValidationFailure[],
): RuntimeCatalogue {
  const toolIds = Object.freeze([...tools.keys()].sort());
  const entries = Object.freeze(toolIds.map((id) => tools.get(id)!.entry));
  const reversalContracts = new Map<string, ReversalContract>();
  for (const t of tools.values()) {
    if (t.reversal !== undefined) reversalContracts.set(t.toolId, t.reversal);
  }

  const argumentValidator: ArgumentValidator = {
    validate(call, entry) {
      // The validator is looked up by the ENTRY the chain resolved, and the
      // call must name the same tool: a mismatch is a wiring fault, refused.
      const tool = tools.get(entry.toolId);
      if (tool === undefined || call.toolId !== entry.toolId) {
        return {
          valid: false,
          errors: `no compiled schema is loaded for ${call.toolId}; the runtime catalogue does not hold it`,
        };
      }
      return tool.validate(call.args)
        ? { valid: true }
        : { valid: false, errors: describeAjvErrors(tool.validate) };
    },
  };

  return Object.freeze({
    toolIds,
    tools,
    entries,
    entryFor: (id: string) => tools.get(id)?.entry,
    writeSafetyFor: (id: string) => tools.get(id)?.writeSafety,
    reversals: reversalRegistry(reversalContracts),
    functionDescriptorFor: (id: string) => tools.get(id)?.functionDescriptor,
    schemaValidatorFor: (id: string) => tools.get(id)?.validate,
    argumentValidator,
    warnings,
  });
}
