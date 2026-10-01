// MCPForge — artefact 3/6: `generated/tools/<id>/handler.generated.ts`.
// W0-B6, narrowed by W0-P18. Regenerated wholesale on every `forge codegen`
// run (02 §2.4).
//
// W0-P18 (owner decision of 25 Sep 2026, recorded under W0-P11: "Path A
// only"). Every served call runs ONE path: the policy chain (6a–6h, including
// the confirm gate 6g and idempotency 6h) → the write or read dispatcher → the
// generic `function` executor → the one audit writer ([9]), all in
// `core/gateway`. Before W0-P18 this template also emitted a `handle()` with
// its OWN confirm-token mint and verify, idempotency bookkeeping and audit
// calls ("Track C stub — core/gateway/store/audit is not built yet"), which
// dispatched into `binding.custom.ts`. Nothing served ever called it: it was
// a second implementation of 6g/6h/[9] waiting to be wired by mistake. It is
// gone, and so is every type that only existed to feed it (`AuditRecordInput`,
// `Ctx.audit`, `Ctx.confirmTokens`, `Ctx.idempotency`).
//
// The artefact is KEPT rather than removed (W0-P18's `done:` allows either),
// because two things still need it and removing it would break both:
//   1. 02 §2.4's hand-owned stub imports `Ctx`, `Args` and `Result` from
//      './handler.generated'. Removing the file would break every committed
//      `binding.custom.ts`, which codegen may never rewrite.
//   2. The generated `unit.test.ts` / `contract.test.ts` exercise the pure,
//      manifest-derived helpers below.
// What is emitted is therefore a TYPE CONTRACT plus PURE helpers: no I/O, no
// token, no store, no dispatch. The emitted file says so in its own header,
// and `contract.test.ts` pins its exact runtime export list per tool so a
// call path cannot be reintroduced without a test failing.

import type { ProvenanceInfo } from '../emit/provenance.js';
import { provenanceCommentHeader } from '../emit/provenance.js';
import { formatTsDeterministic } from '../emit/writer.js';
import type { ToolView, ViewGuardrail, ViewInput } from './manifest-view.js';

/**
 * The exact runtime exports a generated handler module carries. The generated
 * `contract.test.ts` asserts this list per tool (W0-P18), so a `handle()` or
 * any other call path cannot be re-added to the template silently.
 */
export const HANDLER_RUNTIME_EXPORTS = [
  'GATEWAY_EVALUATED_KINDS',
  'GUARDRAILS',
  'RESULT_KEYS',
  'evaluateGuardrails',
  'extractResultKeys',
  'validateArgs',
] as const;

/** The header every emitted handler carries: what the file is FOR, and what it is not. */
const EMITTED_PURPOSE_HEADER = [
  '// WHAT THIS FILE IS FOR (W0-P18). It is NOT a call path. Nothing on the served',
  '// path imports it: every call runs the gateway policy chain (the confirm gate',
  '// 6g and idempotency 6h included), then the write or read dispatcher, then the',
  '// generic `function` executor, then the one audit writer, all in core/gateway.',
  '// This file mints no confirm token, verifies none, keeps no idempotency record,',
  '// writes no audit row and dispatches no binding. It carries only:',
  "//   - the `Args` / `Ctx` / `Result` types a hand-owned binding.custom.ts imports",
  '//     (02 §2.4);',
  '//   - pure helpers derived from the manifest, exercised by the generated',
  '//     unit.test.ts and contract.test.ts: `validateArgs` (compiled Ajv over the',
  '//     same schema.json), `GUARDRAILS` / `evaluateGuardrails` (the argument-only',
  "//     guardrail kinds; the gateway's stage 6f is the guardrail engine) and",
  '//     `RESULT_KEYS` / `extractResultKeys`.',
  '// Do not add a handler, a token, a store or an audit call here: that is a second',
  '// copy of a policy stage, and the generated contract test pins this export list.',
];

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
  lines.push(...EMITTED_PURPOSE_HEADER);
  lines.push('');
  lines.push("import { Ajv2020 } from 'ajv/dist/2020.js';");
  lines.push("import addFormatsImport from 'ajv-formats';");
  lines.push("import schema from './schema.json' with { type: 'json' };");
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
  lines.push(
    '/** The business arguments (02 §3.1.1: `confirm` is the confirm gate\'s, never a binding body\'s). */',
  );
  lines.push('export interface Args {');
  lines.push(argsInterfaceBody(tool.input));
  lines.push('}');
  lines.push('');
  lines.push(
    '/**',
    ' * What a custom binding body may read about the call. Deliberately carries no',
    ' * confirm signer, no idempotency store and no audit writer: those are gateway',
    ' * policy stages, never a binding\'s (W0-P18). At Wave 0 no served path invokes a',
    ' * binding.custom.ts; every tool runs through the generic `function` executor.',
    ' */',
  );
  lines.push('export interface Ctx {');
  lines.push('  readonly callerSubject: string;');
  lines.push('  readonly correlationId: string;');
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
  lines.push(' * [W0-F8, W0-P18] NOT THE GUARDRAIL ENGINE, and not called on the served path. The');
  lines.push(" * one guardrail engine is the gateway's shared evaluator at policy stage 6f");
  lines.push(' * (core/gateway/policy/guardrails/gate.ts), which runs on every call, through');
  lines.push(' * `tools/call` and through `forge.invoke` alike, at plan time and again at');
  lines.push(' * execute time (02 §3.1.3). This pure function evaluates only the kinds that read');
  lines.push(" * NOTHING but the call's own arguments (maxNumeric, minNumeric, allowedValues), so");
  lines.push(" * the generated unit test can pin each declared threshold: sodConflict needs the");
  lines.push(" * resolved role scope, rateLimit needs the caller's execute counter and timeWindow");
  lines.push(' * needs a precondition read, and this module has none of them.');
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

  return formatTsDeterministic(lines.join('\n'), repoRoot);
}
