// MCPForge — artefact 3/6: `generated/tools/<id>/handler.generated.ts`. W0-B6.
// Reads: 02 §2.3 (artefact table), §3.1.1 (two-phase confirm), §3.1.2
// (idempotency), §3.1.3 (guardrails), §3.1.4 (reversal/audit shape), §3.1.5
// (error taxonomy). Regenerated wholesale on every `forge codegen` run (02
// §2.4 — "handler.generated.ts is regenerated wholesale every time"); the
// hand-owned half of the split is `binding.custom.ts` (W0-B5), which this
// file's own emitted source imports `execute`/`dryRun` from when the
// manifest declares `bindingCustom: true`, per that stub's own contract
// (`import type { Ctx, Args, Result } from './handler.generated'` — this
// module is therefore also the file that MUST export those three types).
//
// TRACK C STUB, DOCUMENTED (CLAUDE.md task instructions; per this task's own
// "done" criterion note that a call-site stub is fine at Wave 0 since the
// real audit store, confirm-token signer and idempotency store do not exist
// yet): `ctx.audit`, `ctx.confirmTokens` and `ctx.idempotency` are typed
// interfaces this generated handler calls into, at the exact call sites 02
// §3 describes (plan-time audit write, execute-time audit write with the
// reversal class + result keys, confirm-token mint at plan / verify at
// execute, idempotency record-before-invoke / replay-after). Nothing here
// fabricates their implementation — `core/gateway/store/**` (a later,
// Opus-guarded task, per CLAUDE.md's OPUS_GUARDED_PATHS) supplies the real
// `Ctx` your gateway constructs and passes in.

import type { ProvenanceInfo } from '../emit/provenance.js';
import { provenanceCommentHeader } from '../emit/provenance.js';
import { formatTsDeterministic } from '../emit/writer.js';
import type { ToolView, ViewGuardrail, ViewInput } from './manifest-view.js';

function tsType(input: ViewInput): string {
  switch (input.type) {
    case 'integer':
      return 'number';
    default:
      return input.type;
  }
}

function argsInterfaceBody(inputs: readonly ViewInput[]): string {
  return inputs
    .map((i) => `  readonly ${i.name}${i.required ? '' : '?'}: ${tsType(i)};`)
    .join('\n');
}

function guardrailLiteral(g: ViewGuardrail): string {
  return JSON.stringify(g);
}

/**
 * `generated/tools/<id>/handler.generated.ts` source, as an unformatted
 * string — `formatTsDeterministic` (the same deterministic-writer prettier
 * pass every other `.ts` artefact goes through) does the final formatting.
 */
export async function buildHandlerTs(
  tool: ToolView,
  provenance: ProvenanceInfo,
  repoRoot?: string,
): Promise<string> {
  const guardrails = tool.writeSafety?.guardrails ?? [];
  const resultKeys = tool.resultKeys;

  const lines: string[] = [];
  lines.push(provenanceCommentHeader(provenance));
  lines.push('');
  lines.push("import { Ajv2020 } from 'ajv/dist/2020.js';");
  lines.push("import addFormatsImport from 'ajv-formats';");
  lines.push("import { forgeError, isErrorCode, type ErrorCode } from '@mcpforge/shared/errors';");
  lines.push("import schema from './schema.json' with { type: 'json' };");
  if (tool.bindingCustom) {
    lines.push("import * as customBinding from './binding.custom.js';");
  }
  lines.push('');
  lines.push(
    'const addFormats = (addFormatsImport as unknown as { default: (a: Ajv2020) => void }).default ?? (addFormatsImport as unknown as (a: Ajv2020) => void);',
  );
  lines.push('');
  lines.push('// --- Args / Ctx / Result -----------------------------------------------------');
  lines.push(
    "// `binding.custom.ts`'s hand-owned stub imports exactly these three types from",
    '// this file (02 §2.4) — do not rename without regenerating the stub AND',
    '// getting a fresh `--accept-contract` acceptance for every custom binding.',
  );
  lines.push('export interface Args {');
  lines.push(argsInterfaceBody(tool.input));
  if (tool.write) {
    lines.push('  /** 02 §3.1.1 — omit/null to PLAN, pass the confirmToken to EXECUTE. */');
    lines.push('  readonly confirm?: string | null;');
  }
  lines.push('}');
  lines.push('');
  lines.push(
    '/** The audit-record shape this handler writes at each call site (Track C stub — core/gateway/store/audit is not built yet). */',
  );
  lines.push('export interface AuditRecordInput {');
  lines.push('  readonly phase: "plan" | "execute";');
  lines.push('  readonly toolId: string;');
  lines.push('  readonly toolVersion: string;');
  lines.push('  readonly callerSubject: string;');
  lines.push('  readonly correlationId: string;');
  lines.push('  readonly argsRedacted: Readonly<Record<string, unknown>>;');
  lines.push('  readonly resultKeys?: Readonly<Record<string, unknown>>;');
  lines.push('  readonly reversalClass?: string | null;');
  lines.push('}');
  lines.push('');
  lines.push(
    '/** What the gateway constructs and passes into every generated handler. Track C stub — see file header. */',
  );
  lines.push('export interface Ctx {');
  lines.push('  readonly callerSubject: string;');
  lines.push('  readonly correlationId: string;');
  lines.push('  readonly audit: { record(entry: AuditRecordInput): Promise<void> };');
  lines.push('  readonly confirmTokens: {');
  lines.push(
    '    mint(args: { readonly toolId: string; readonly argsCanonicalHash: string }): Promise<{ readonly token: string; readonly expiresAt: string }>;',
  );
  lines.push(
    '    verify(args: { readonly toolId: string; readonly token: string; readonly argsCanonicalHash: string }): Promise<{ readonly ok: boolean }>;',
  );
  lines.push('  };');
  lines.push('  readonly idempotency: {');
  lines.push(
    '    recordBeforeInvoke(key: string): Promise<{ readonly replay: false } | { readonly replay: true; readonly previousResult: unknown }>;',
  );
  lines.push('    recordOutcome(key: string, result: unknown): Promise<void>;');
  lines.push('  };');
  lines.push('}');
  lines.push('');
  lines.push('export interface Result {');
  lines.push('  readonly [key: string]: unknown;');
  lines.push('}');
  lines.push('');
  lines.push(
    '// --- argument validation: compiled Ajv from the SAME schema.json this handler is generated beside ---',
  );
  lines.push('const ajv = new Ajv2020({ strict: false, allErrors: true });');
  lines.push('addFormats(ajv);');
  lines.push('export const validateArgs = ajv.compile(schema);');
  lines.push('');
  lines.push('function summarizeAjvErrors(): string {');
  lines.push('  return (validateArgs.errors ?? [])');
  lines.push('    .map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`)');
  lines.push("    .join('; ');");
  lines.push('}');
  lines.push('');
  if (tool.write) {
    lines.push(
      '// The canonical hash binds a confirm token to the BUSINESS arguments only.',
      '// `confirm` itself is the presented token, never part of what it is bound to',
      '// — including it would make the plan-time hash (computed before `confirm`',
      '// exists) permanently unequal to the execute-time hash (computed once it',
      '// does), so no legitimate confirmation could ever match (02 §3.1.1).',
      'function canonicalArgsHash(args: Args): string {',
      '  const { confirm: _confirm, ...business } = args as unknown as Record<string, unknown>;',
      '  return JSON.stringify(business, Object.keys(business).sort());',
      '}',
      '',
    );
  }
  lines.push('// --- guardrail evaluation (02 §3.1.3), from writeSafety.guardrails -----------');
  lines.push(
    `export const GUARDRAILS = [${guardrails.map(guardrailLiteral).join(', ')}] as const;`,
  );
  lines.push('');
  lines.push('export interface GuardrailBreach {');
  lines.push('  readonly breached: true;');
  lines.push('  readonly kind: string;');
  lines.push('  readonly message: string;');
  lines.push('}');
  lines.push('');
  lines.push(
    "/** [W0-F8] The kinds this handler DELEGATES to the gateway's stage-6f evaluator. */",
  );
  lines.push(
    'export const GATEWAY_EVALUATED_KINDS = ["sodConflict", "rateLimit", "timeWindow"] as const;',
  );
  lines.push('');
  lines.push('/**');
  lines.push(
    ' * Evaluated at plan time and again at execute time (02 §3.1.3 — never only at plan).',
  );
  lines.push(' *');
  lines.push(' * [W0-F8] THIS IS A DEFENCE-IN-DEPTH PRE-CHECK, NOT THE GUARDRAIL ENGINE. The one');
  lines.push(" * guardrail engine is the gateway's shared evaluator at policy stage 6f");
  lines.push(' * (core/gateway/policy/guardrails/gate.ts), which runs on every call — through');
  lines.push(' * `tools/call` and through `forge.invoke` alike — before this handler is reached.');
  lines.push(" * This function re-checks only the kinds that read NOTHING but the call's own");
  lines.push(' * arguments (maxNumeric, minNumeric, allowedValues), because those are the only');
  lines.push(' * ones evaluable here: sodConflict needs the resolved role scope, rateLimit needs');
  lines.push(" * this caller's execute counter and timeWindow needs a precondition read, and this");
  lines.push(' * handler has none of them.');
  lines.push(' *');
  lines.push(' * The kinds it cannot evaluate are named explicitly in GATEWAY_EVALUATED_KINDS and');
  lines.push(' * DELEGATED to that one evaluator — they are not silently skipped. Before W0-F8');
  lines.push(' * this loop simply ignored every kind it did not implement, so a manifest could');
  lines.push(' * declare a control this file quietly dropped. Anything that is neither evaluated');
  lines.push(' * here nor delegated FAILS CLOSED below.');
  lines.push(' */');
  lines.push(
    'export function evaluateGuardrails(args: Args): GuardrailBreach | { readonly breached: false } {',
  );
  lines.push('  const record = args as unknown as Record<string, unknown>;');
  lines.push('  const malformed = (kind: string, detail: string): GuardrailBreach => ({');
  lines.push('    breached: true,');
  lines.push('    kind,');
  lines.push(
    '    message: `A ${kind} guardrail on this tool cannot be evaluated: ${detail}. The call is refused because the guardrail could not be checked, not because you exceeded it.`,',
  );
  lines.push('  });');
  lines.push('  for (const declared of GUARDRAILS) {');
  lines.push(
    '    const g = declared as unknown as { kind: string; field?: string; value?: unknown; message?: string };',
  );
  lines.push('    switch (g.kind) {');
  lines.push('      case "maxNumeric":');
  lines.push('      case "minNumeric": {');
  lines.push(
    '        if (g.field === undefined || g.field === "") return malformed(g.kind, "it names no field");',
  );
  lines.push('        if (typeof g.value !== "number" || !Number.isFinite(g.value)) {');
  lines.push(
    '          return malformed(g.kind, `its value on "${g.field}" is not a finite number`);',
  );
  lines.push('        }');
  lines.push('        const v = record[g.field];');
  lines.push('        if (v === undefined || v === null) break;');
  lines.push('        if (typeof v !== "number" || !Number.isFinite(v)) {');
  lines.push(
    '          return malformed(g.kind, `the argument "${g.field}" is not a finite number to compare against ${g.value}`);',
  );
  lines.push('        }');
  lines.push('        const isMax = g.kind === "maxNumeric";');
  lines.push('        if (isMax ? v > g.value : v < g.value) {');
  lines.push(
    '          return { breached: true, kind: g.kind, message: g.message ?? `${g.field} is ${v}, ${isMax ? "above the maximum" : "below the minimum"} of ${g.value} this tool allows.` };',
  );
  lines.push('        }');
  lines.push('        break;');
  lines.push('      }');
  lines.push('      case "allowedValues": {');
  lines.push(
    '        if (g.field === undefined || g.field === "") return malformed(g.kind, "it names no field");',
  );
  lines.push('        const allowed = g.value;');
  lines.push('        if (!Array.isArray(allowed) || allowed.length === 0) {');
  lines.push(
    '          return malformed(g.kind, `its value on "${g.field}" is not a non-empty list of permitted values`);',
  );
  lines.push('        }');
  lines.push('        const v = record[g.field];');
  lines.push('        if (v === undefined || v === null) break;');
  lines.push('        if (typeof v !== "string" && typeof v !== "number") {');
  lines.push(
    '          return malformed(g.kind, `the argument "${g.field}" is neither a string nor a number to match against the permitted list`);',
  );
  lines.push('        }');
  lines.push('        if (!(allowed as readonly unknown[]).includes(v)) {');
  lines.push(
    '          return { breached: true, kind: g.kind, message: g.message ?? `${g.field} is ${JSON.stringify(v)}, which is not one of the values this tool permits: ${(allowed as readonly unknown[]).map((a) => JSON.stringify(a)).join(", ")}.` };',
  );
  lines.push('        }');
  lines.push('        break;');
  lines.push('      }');
  lines.push('      case "sodConflict":');
  lines.push('      case "rateLimit":');
  lines.push('      case "timeWindow":');
  lines.push("        // DELEGATED, not ignored: evaluated by the gateway's one shared evaluator");
  lines.push('        // at stage 6f, which holds the role scope, the execute counter and the');
  lines.push('        // precondition source this handler does not.');
  lines.push('        break;');
  lines.push('      default:');
  lines.push('        // Fail closed. A kind that is neither evaluated here nor delegated above');
  lines.push('        // is a control nobody is enforcing, and admitting the call would make');
  lines.push('        // the manifest assert a guardrail that does not exist.');
  lines.push(
    '        return malformed(String(g.kind), "this handler has no evaluator for that guardrail kind and it is not one the gateway evaluates either");',
  );
  lines.push('    }');
  lines.push('  }');
  lines.push('  return { breached: false };');
  lines.push('}');
  lines.push('');
  lines.push('// --- result-key extraction, from output.resultKeys ---------------------------');
  lines.push(
    `export const RESULT_KEYS = [${resultKeys.map((k) => JSON.stringify(k)).join(', ')}] as const;`,
  );
  lines.push('');
  lines.push(
    '/** Minimal `$.a.b.c` JSONPath reader — every declared resultKeys.path in this catalogue is this shape. */',
  );
  lines.push('function readJsonPath(raw: unknown, path: string): unknown {');
  lines.push(
    '  const segments = path.replace(/^\\$\\.?/, "").split(".").filter((s) => s.length > 0);',
  );
  lines.push('  let cur: unknown = raw;');
  lines.push('  for (const seg of segments) {');
  lines.push('    if (cur === null || typeof cur !== "object") return undefined;');
  lines.push('    cur = (cur as Record<string, unknown>)[seg];');
  lines.push('  }');
  lines.push('  return cur;');
  lines.push('}');
  lines.push('');
  lines.push('export function extractResultKeys(raw: unknown): Result {');
  lines.push('  const out: Record<string, unknown> = {};');
  lines.push('  for (const k of RESULT_KEYS) out[k.name] = readJsonPath(raw, k.path);');
  lines.push('  return out;');
  lines.push('}');
  lines.push('');
  lines.push('// --- error mapping, to the closed taxonomy (02 §3.1.5) -----------------------');
  lines.push('function mapUnknownError(err: unknown, correlationId: string): never {');
  lines.push(
    '  if (err !== null && typeof err === "object" && "code" in err && isErrorCode(String((err as { code: unknown }).code))) {',
  );
  lines.push('    throw err;');
  lines.push('  }');
  lines.push('  const message = err instanceof Error ? err.message : String(err);');
  lines.push('  throw forgeError("TARGET_ERROR", message, correlationId);');
  lines.push('}');
  lines.push('');
  lines.push('// --- the handler ---------------------------------------------------------------');
  lines.push(
    `export async function handle(ctx: Ctx, rawArgs: unknown): Promise<Result | Record<string, unknown>> {`,
  );
  lines.push('  const correlationId = ctx.correlationId;');
  lines.push('  if (!validateArgs(rawArgs)) {');
  lines.push(
    '    throw forgeError("INPUT_INVALID", summarizeAjvErrors() || "arguments failed schema validation", correlationId);',
  );
  lines.push('  }');
  lines.push('  const args = rawArgs as Args;');
  lines.push('');
  lines.push('  const guardrailResult = evaluateGuardrails(args);');
  lines.push('  if (guardrailResult.breached) {');
  lines.push(
    '    throw forgeError("POLICY_GUARDRAIL_BREACH", guardrailResult.message, correlationId);',
  );
  lines.push('  }');
  lines.push('');
  if (tool.write) {
    lines.push(`  const toolId = ${JSON.stringify(tool.id)};`);
    lines.push(`  const toolVersion = ${JSON.stringify(tool.version)};`);
    lines.push('  const isPlan = args.confirm === undefined || args.confirm === null;');
    lines.push('');
    lines.push('  try {');
    lines.push('    if (isPlan) {');
    lines.push(
      tool.bindingCustom
        ? '      const dryRunRaw = await customBinding.dryRun(ctx, args);'
        : "      // 02 §3.2-§3.6: non-custom bindings dispatch dry-run through the generic\n      // binding-type executor (Wave 1+ scope for this tool's binding type); no\n      // executor is wired here because this manifest declares no custom body.\n      const dryRunRaw: unknown = {};",
    );
    lines.push('      const planResult = extractResultKeys(dryRunRaw);');
    lines.push('      const argsCanonicalHash = canonicalArgsHash(args);');
    lines.push('      const minted = await ctx.confirmTokens.mint({ toolId, argsCanonicalHash });');
    lines.push('      await ctx.audit.record({');
    lines.push('        phase: "plan",');
    lines.push('        toolId,');
    lines.push('        toolVersion,');
    lines.push('        callerSubject: ctx.callerSubject,');
    lines.push('        correlationId,');
    lines.push('        argsRedacted: args as unknown as Record<string, unknown>,');
    lines.push('        resultKeys: planResult,');
    lines.push(
      `        reversalClass: ${JSON.stringify(tool.writeSafety?.reversalClass ?? null)},`,
    );
    lines.push('      });');
    lines.push('      return {');
    lines.push('        status: "confirm_required",');
    lines.push('        plan: planResult,');
    lines.push('        confirmToken: minted.token,');
    lines.push('        expiresAt: minted.expiresAt,');
    lines.push(
      '        next: "Show the plan to the human. If approved, call this tool again with identical arguments plus confirm=<confirmToken>.",',
    );
    lines.push('      };');
    lines.push('    }');
    lines.push('');
    lines.push('    const argsCanonicalHash = canonicalArgsHash(args);');
    lines.push(
      '    const verified = await ctx.confirmTokens.verify({ toolId, token: String(args.confirm), argsCanonicalHash });',
    );
    lines.push('    if (!verified.ok) {');
    lines.push(
      '      throw forgeError("PLAN_ARGUMENT_MISMATCH", "confirm token does not match the presented arguments", correlationId);',
    );
    lines.push('    }');
    lines.push('');
    lines.push(
      '    const idempotencyKey = `${ctx.callerSubject}|${toolId}|${toolVersion}|${argsCanonicalHash}|${String(args.confirm)}`;',
    );
    lines.push('    const idempotent = await ctx.idempotency.recordBeforeInvoke(idempotencyKey);');
    lines.push('    if (idempotent.replay) {');
    lines.push(
      '      return { ...(idempotent.previousResult as Record<string, unknown>), replayed: true };',
    );
    lines.push('    }');
    lines.push('');
    lines.push(
      tool.bindingCustom
        ? '    const executeRaw = await customBinding.execute(ctx, args);'
        : '    // See the dry-run branch above for the same non-custom-binding note.\n    const executeRaw: unknown = {};',
    );
    lines.push('    const result = extractResultKeys(executeRaw);');
    lines.push('    await ctx.idempotency.recordOutcome(idempotencyKey, result);');
    lines.push('    await ctx.audit.record({');
    lines.push('      phase: "execute",');
    lines.push('      toolId,');
    lines.push('      toolVersion,');
    lines.push('      callerSubject: ctx.callerSubject,');
    lines.push('      correlationId,');
    lines.push('      argsRedacted: args as unknown as Record<string, unknown>,');
    lines.push('      resultKeys: result,');
    lines.push(`      reversalClass: ${JSON.stringify(tool.writeSafety?.reversalClass ?? null)},`);
    lines.push('    });');
    lines.push('    return result;');
    lines.push('  } catch (err) {');
    lines.push('    mapUnknownError(err, correlationId);');
    lines.push('  }');
  } else {
    lines.push('  try {');
    lines.push(
      tool.bindingCustom
        ? '    const raw = await customBinding.execute(ctx, args);'
        : "    // No custom binding body: the generic binding-type executor for this\n    // tool's binding type dispatches the read (Wave 1+ scope here).\n    const raw: unknown = {};",
    );
    lines.push('    const result = extractResultKeys(raw);');
    lines.push(`    const toolId = ${JSON.stringify(tool.id)};`);
    lines.push(`    const toolVersion = ${JSON.stringify(tool.version)};`);
    lines.push('    await ctx.audit.record({');
    lines.push('      phase: "execute",');
    lines.push('      toolId,');
    lines.push('      toolVersion,');
    lines.push('      callerSubject: ctx.callerSubject,');
    lines.push('      correlationId,');
    lines.push('      argsRedacted: args as unknown as Record<string, unknown>,');
    lines.push('      resultKeys: result,');
    lines.push('    });');
    lines.push('    return result;');
    lines.push('  } catch (err) {');
    lines.push('    mapUnknownError(err, correlationId);');
    lines.push('  }');
  }
  lines.push('}');
  lines.push('');

  return formatTsDeterministic(lines.join('\n'), repoRoot);
}
