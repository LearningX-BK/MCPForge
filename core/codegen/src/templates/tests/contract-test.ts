// MCPForge — artefact: `generated/tools/<id>/contract.test.ts`. W0-B7,
// narrowed by W0-P18.
//
// W0-P18 (owner decision of 25 Sep 2026, "Path A only"). Before W0-P18 this
// generator drove a generated `handle()` end to end against a hand-rolled mock
// `Ctx` whose confirm signer, idempotency map and audit list re-implemented, in
// miniature, what the gateway does at stages 6g/6h and [9]. That `handle()` was
// never served, so those generated "contract" tests proved the behaviour of a
// path no call takes. The handler artefact no longer carries a call path (see
// `../handler.ts`), and this generator no longer pretends it does.
//
// WHERE THE TWO-PHASE CONTRACT IS PROVEN NOW. 02 §2.3's row for contract tests
// (happy path, each declared error, dry-run shape, confirm-token binding,
// argument-mismatch refusal, idempotent replay, reversal round trip) is proven
// against the SERVED path, by the gateway's own suites, never re-implemented
// per tool here:
//   - core/gateway/assembly/execute.e2e.test.ts and core/gateway/launch.e2e.test.ts
//     (plan → confirm → execute → replay over real HTTP, audit rows, chain intact);
//   - tests/write-path/** (W0-F7/F8 write-path demonstrations);
//   - core/gateway/policy/confirm/** and tests/policy/** (token binding,
//     PLAN_ARGUMENT_MISMATCH, fail-closed escalation cases).
//
// WHAT THIS GENERATED FILE STILL PROVES, per tool, from the committed artefacts:
//   1. the handler artefact is not a call path: its runtime exports are exactly
//      `HANDLER_RUNTIME_EXPORTS` (no `handle`, no token, no audit), so a call
//      path cannot come back silently;
//   2. a valid argument set passes the schema the tool publishes, and an invalid
//      one is refused with an INPUT_INVALID that carries a non-empty `next`;
//   3. for a write tool, the published schema carries the two-phase `confirm`
//      input exactly as 02 §3.1.1 specifies (optional, string or null);
//   4. for a custom binding, the hand-owned body exports what its stub promises;
//   5. for a reversible write, `writeSafety.reversal.argMap` resolves every
//      reversing argument from this tool's own declared result keys (the pure
//      data half of 02 §3.1.4's round trip; the gateway's `forge audit reverse`
//      applies the same map to a real audit row).

import { formatTsDeterministic } from '../../emit/writer.js';
import type { ProvenanceInfo } from '../../emit/provenance.js';
import { provenanceCommentHeader } from '../../emit/provenance.js';
import { HANDLER_RUNTIME_EXPORTS } from '../handler.js';
import type { ToolView, ViewInput } from '../manifest-view.js';

function exampleValue(input: ViewInput): unknown {
  if (input.example !== undefined) return input.example;
  switch (input.type) {
    case 'number':
    case 'integer':
      return input.minimum !== undefined ? input.minimum + 1 : 1;
    case 'boolean':
      return true;
    default:
      // A schema-boundary-valid string: format-specific where declared (Ajv,
      // via ajv-formats, validates `format` for real on the compiled
      // validator this file imports), a plain marker string otherwise.
      if (input.format === 'date') return '2024-01-15';
      if (input.format === 'date-time') return '2024-01-15T00:00:00.000Z';
      if (input.format === 'email') return 'test@example.com';
      return `test-${input.name}`;
  }
}

/** Reads the narrow `"$.result.<field>"` shape every `writeSafety.reversal.argMap` value in this catalogue uses. */
function jsonPathField(path: string): string | null {
  const m = /^\$\.result\.([a-zA-Z0-9_]+)$/.exec(path);
  return m ? m[1]! : null;
}

/**
 * Build a nested object matching every declared `output.resultKeys[].path`
 * (`"$.a.b.c"`), each leaf set to a distinct marker string, so
 * `extractResultKeys` can actually populate every key — the reversal round
 * trip reads the EXTRACTED result, not an empty stub.
 */
function buildSyntheticRaw(resultKeys: readonly { name: string; path: string }[]): unknown {
  const root: Record<string, unknown> = {};
  for (const key of resultKeys) {
    const segments = key.path.replace(/^\$\.?/, '').split('.').filter((s) => s.length > 0);
    if (segments.length === 0) continue;
    let cur = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]!;
      const next = cur[seg];
      cur[seg] = next && typeof next === 'object' ? next : {};
      cur = cur[seg] as Record<string, unknown>;
    }
    cur[segments[segments.length - 1]!] = `${key.name}-value`;
  }
  return root;
}

/**
 * `generated/tools/<id>/contract.test.ts` source, unformatted. Returns the
 * raw string; `formatTsDeterministic` (same deterministic pass every other
 * `.ts` artefact goes through) does the final formatting.
 */
export async function buildContractTestTs(
  tool: ToolView,
  provenance: ProvenanceInfo,
  repoRoot?: string,
): Promise<string> {
  const validArgs: Record<string, unknown> = {};
  for (const i of tool.input) validArgs[i.name] = exampleValue(i);
  const firstRequired = tool.input.find((i) => i.required);

  const lines: string[] = [];
  lines.push(provenanceCommentHeader(provenance));
  lines.push('');
  lines.push(
    '// GENERATED CONTRACT TEST (W0-B7, narrowed by W0-P18). The two-phase write',
    '// contract (plan, confirm-token binding, argument mismatch, idempotent replay,',
    '// audit) is proven against the SERVED path by core/gateway\'s own suites, never',
    '// re-implemented per tool here. This file proves what the committed artefacts',
    '// for this tool own. See core/codegen/src/templates/tests/contract-test.ts.',
  );
  lines.push('');
  lines.push("import { describe, expect, it } from 'vitest';");
  lines.push("import { ERROR_TAXONOMY } from '@mcpforge/shared/errors';");
  lines.push("import schema from './schema.json' with { type: 'json' };");
  lines.push("import * as handlerModule from './handler.generated.js';");
  lines.push("import { extractResultKeys, validateArgs, type Args } from './handler.generated.js';");
  if (tool.bindingCustom) {
    lines.push("import * as customBinding from './binding.custom.js';");
  }
  lines.push('');
  lines.push(`const VALID_ARGS = ${JSON.stringify(validArgs)} as unknown as Args;`);
  lines.push('');

  lines.push(`describe(${JSON.stringify(`${tool.id} — contract (generated, W0-B7/W0-P18)`)}, () => {`);

  // --- 1. the handler artefact is not a call path ---------------------
  lines.push(
    '  it("the handler artefact is not a call path: no handle(), no confirm signer, no audit writer (W0-P18)", () => {',
  );
  lines.push(
    `    expect(Object.keys(handlerModule).sort()).toEqual(${JSON.stringify([...HANDLER_RUNTIME_EXPORTS])});`,
  );
  lines.push('  });');
  lines.push('');

  // --- 2. schema acceptance and INPUT_INVALID -------------------------
  lines.push('  it("a valid argument set passes the published schema", () => {');
  lines.push('    expect(validateArgs(VALID_ARGS)).toBe(true);');
  lines.push('  });');
  lines.push('');
  if (firstRequired) {
    lines.push(
      `  it(${JSON.stringify(`declared error: INPUT_INVALID when "${firstRequired.name}" is missing, with a non-empty next`)}, () => {`,
    );
    lines.push(
      `    const { ${firstRequired.name}: _drop, ...bad } = VALID_ARGS as unknown as Record<string, unknown>;`,
    );
    lines.push('    expect(validateArgs(bad)).toBe(false);');
    lines.push('    expect(ERROR_TAXONOMY.INPUT_INVALID.next.trim().length).toBeGreaterThan(0);');
    lines.push('  });');
    lines.push('');
  }

  // --- 3. the two-phase input on a write tool --------------------------
  if (tool.write) {
    lines.push(
      '  it("two-phase input: the schema carries confirm as optional string|null (02 §3.1.1)", () => {',
    );
    lines.push(
      '    const s = schema as unknown as { properties: Record<string, { type?: unknown }>; required?: string[] };',
    );
    lines.push('    expect(s.properties["confirm"]?.type).toEqual(["string", "null"]);');
    lines.push('    expect(s.required ?? []).not.toContain("confirm");');
    lines.push('    expect(validateArgs({ ...VALID_ARGS, confirm: null })).toBe(true);');
    lines.push('    expect(validateArgs({ ...VALID_ARGS, confirm: "cnf_test" })).toBe(true);');
    lines.push('  });');
    lines.push('');
  }

  // --- 4. the hand-owned body exports what its stub promises -----------
  if (tool.bindingCustom) {
    lines.push(
      `  it(${JSON.stringify(
        tool.write
          ? 'the hand-owned binding body exports execute and dryRun (02 §2.4)'
          : 'the hand-owned binding body exports execute (02 §2.4)',
      )}, () => {`,
    );
    lines.push('    expect(typeof customBinding.execute).toBe("function");');
    if (tool.write) lines.push('    expect(typeof customBinding.dryRun).toBe("function");');
    lines.push('  });');
    lines.push('');
  }

  // --- 5. reversal round trip, the pure data half ----------------------
  if (tool.write) {
    const reversal = tool.writeSafety;
    const argMapEntries = reversal ? Object.entries(reversal.reversalArgMap) : [];
    const reversalClass = reversal?.reversalClass ?? null;
    // `irreversible` is excluded by construction: there is nothing to map.
    const roundTripApplies =
      reversal !== null &&
      argMapEntries.length > 0 &&
      ((reversalClass === 'compensating-tool' && Boolean(reversal.reversalTool)) ||
        reversalClass === 'native-reverse' ||
        reversalClass === 'transactional');
    if (roundTripApplies && reversal) {
      const isCompensating = reversalClass === 'compensating-tool';
      lines.push(
        `  it(${JSON.stringify(
          isCompensating
            ? `reversal round trip: writeSafety.reversal.argMap maps this tool's result keys into ${reversal.reversalTool}'s arguments`
            : `reversal round trip: writeSafety.reversal.argMap maps this tool's result keys into the ${String(reversalClass)} reversing call's arguments`,
        )}, () => {`,
      );
      lines.push(
        `    const executed = extractResultKeys(${JSON.stringify(buildSyntheticRaw(tool.resultKeys))}) as Record<string, unknown>;`,
      );
      lines.push(`    const ARG_MAP = ${JSON.stringify(reversal.reversalArgMap)} as const;`);
      lines.push('    const reversalArgs: Record<string, unknown> = {};');
      lines.push('    for (const [argName, path] of Object.entries(ARG_MAP)) {');
      lines.push('      const m = /^\\$\\.result\\.([a-zA-Z0-9_]+)$/.exec(path);');
      lines.push('      reversalArgs[argName] = m ? executed[m[1]!] : undefined;');
      lines.push('    }');
      for (const [argName, path] of argMapEntries) {
        const field = jsonPathField(path);
        if (field === null) continue;
        lines.push(
          `    expect(reversalArgs[${JSON.stringify(argName)}]).toBe(executed[${JSON.stringify(field)}]);`,
        );
      }
      lines.push(
        "    // Every mapped arg must resolve to a defined value from THIS tool's own result",
        '    // keys; an unresolved mapping is a write nobody can undo.',
      );
      lines.push('    for (const argName of Object.keys(ARG_MAP)) expect(reversalArgs[argName]).toBeDefined();');
      lines.push('  });');
      lines.push('');
    }
  }

  lines.push('});');
  lines.push('');

  return formatTsDeterministic(lines.join('\n'), repoRoot);
}
