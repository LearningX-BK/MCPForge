// MCPForge — artefact 4/6: `generated/tools/<id>/unit.test.ts`. W0-B6.
// 02 §2.3: "Unit tests — schema-boundary tests (required fields, type
// coercion, enum rejection, guardrail thresholds)". Full write-tool
// round-trip CONTRACT tests (happy path, every declared error, dry-run
// shape, confirm-token binding, argument-mismatch refusal, idempotent
// replay, reversal round-trip) are W0-B7, a separate later task — this
// generator's scope is schema-boundary only, per this task's own `done:`
// wording and TASKS.md's W0-B7 entry.

import { formatTsDeterministic } from '../emit/writer.js';
import type { ProvenanceInfo } from '../emit/provenance.js';
import { provenanceCommentHeader } from '../emit/provenance.js';
import type { ToolView, ViewInput } from './manifest-view.js';

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
      // handler this file imports), a plain marker string otherwise.
      if (input.format === 'date') return '2024-01-15';
      if (input.format === 'date-time') return '2024-01-15T00:00:00.000Z';
      if (input.format === 'email') return 'test@example.com';
      return `test-${input.name}`;
  }
}

function wrongTypeValue(input: ViewInput): unknown {
  switch (input.type) {
    case 'number':
    case 'integer':
      return 'not-a-number';
    case 'boolean':
      return 'not-a-boolean';
    default:
      return 12345;
  }
}

/** `generated/tools/<id>/unit.test.ts` source, unformatted. */
export async function buildUnitTestTs(
  tool: ToolView,
  provenance: ProvenanceInfo,
  repoRoot?: string,
): Promise<string> {
  const validArgs: Record<string, unknown> = {};
  for (const i of tool.input) validArgs[i.name] = exampleValue(i);

  const requiredInputs = tool.input.filter((i) => i.required);
  const numericGuardrails = (tool.writeSafety?.guardrails ?? []).filter(
    (g) => g.kind === 'maxNumeric' && g.field !== undefined && typeof g.value === 'number',
  );

  const lines: string[] = [];
  lines.push(provenanceCommentHeader(provenance));
  lines.push('');
  lines.push("import { describe, expect, it } from 'vitest';");
  lines.push("import { evaluateGuardrails, validateArgs, type Args } from './handler.generated.js';");
  lines.push("import { ERROR_TAXONOMY } from '@mcpforge/shared/errors';");
  lines.push('');
  lines.push(`const VALID_ARGS = ${JSON.stringify(validArgs)} as unknown as Args;`);
  lines.push('');
  lines.push(`describe(${JSON.stringify(`${tool.id} — schema boundary (generated, W0-B6)`)}, () => {`);
  lines.push('  it("accepts a fully valid argument set", () => {');
  lines.push('    expect(validateArgs(VALID_ARGS)).toBe(true);');
  lines.push('  });');
  lines.push('');

  for (const input of requiredInputs) {
    lines.push(`  it(${JSON.stringify(`rejects a call missing required field "${input.name}"`)}, () => {`);
    lines.push(`    const { ${input.name}: _omit, ...rest } = VALID_ARGS as unknown as Record<string, unknown>;`);
    lines.push('    expect(validateArgs(rest)).toBe(false);');
    lines.push('  });');
    lines.push('');
  }

  for (const input of tool.input) {
    lines.push(`  it(${JSON.stringify(`rejects the wrong type for "${input.name}" (type coercion is not permitted)`)}, () => {`);
    lines.push(
      `    const bad = { ...VALID_ARGS, ${input.name}: ${JSON.stringify(wrongTypeValue(input))} };`,
    );
    lines.push('    expect(validateArgs(bad)).toBe(false);');
    lines.push('  });');
    lines.push('');
  }

  const enumInputs = tool.input.filter((i) => i.enum !== undefined && i.enum.length > 0);
  for (const input of enumInputs) {
    lines.push(`  it(${JSON.stringify(`rejects a value for "${input.name}" outside its declared enum`)}, () => {`);
    lines.push(
      `    const bad = { ...VALID_ARGS, ${input.name}: "__not_a_declared_enum_value__" };`,
    );
    lines.push('    expect(validateArgs(bad)).toBe(false);');
    lines.push('  });');
    lines.push('');
  }

  if (tool.write) {
    lines.push('  it("accepts confirm omitted, confirm: null, and confirm as a string", () => {');
    lines.push('    expect(validateArgs(VALID_ARGS)).toBe(true);');
    lines.push('    expect(validateArgs({ ...VALID_ARGS, confirm: null })).toBe(true);');
    lines.push('    expect(validateArgs({ ...VALID_ARGS, confirm: "cnf_test" })).toBe(true);');
    lines.push('  });');
    lines.push('');
  }

  for (const g of numericGuardrails) {
    const field = g.field!;
    const value = g.value as number;
    lines.push(
      `  it(${JSON.stringify(`the ${g.kind} guardrail on "${field}" breaches above, not below, its ${value} threshold`)}, () => {`,
    );
    lines.push(`    const overArgs = { ...VALID_ARGS, ${field}: ${value + 1} } as unknown as Args;`);
    lines.push('    const over = evaluateGuardrails(overArgs);');
    lines.push('    expect(over.breached).toBe(true);');
    lines.push('');
    lines.push(`    const underArgs = { ...VALID_ARGS, ${field}: ${Math.max(value - 1, 0)} } as unknown as Args;`);
    lines.push('    const under = evaluateGuardrails(underArgs);');
    lines.push('    expect(under.breached).toBe(false);');
    lines.push('  });');
    lines.push('');
  }

  // W0-B7 done criterion: "a generated unit test asserts every declared
  // error path returns a non-empty next." The full end-to-end error-path
  // round trips (actually driving `handle()` into each error) live in the
  // sibling `contract.test.ts` (W0-B7); this schema-boundary file asserts
  // the same guarantee at the taxonomy level — every error code this
  // handler is generated to throw (`INPUT_INVALID` always;
  // `POLICY_GUARDRAIL_BREACH` when this tool declares guardrails;
  // `PLAN_ARGUMENT_MISMATCH` for write tools; `TARGET_ERROR` as the
  // catch-all mapping in `mapUnknownError`) carries a non-empty,
  // agent-actionable `next` in the closed taxonomy this handler constructs
  // every thrown error from (CLAUDE.md non-negotiable #5).
  const declaredErrorCodes = ['INPUT_INVALID', 'TARGET_ERROR'];
  if (numericGuardrails.length > 0) declaredErrorCodes.push('POLICY_GUARDRAIL_BREACH');
  if (tool.write) declaredErrorCodes.push('PLAN_ARGUMENT_MISMATCH');

  lines.push(
    `  it(${JSON.stringify(
      `every declared error path (${declaredErrorCodes.join(', ')}) carries a non-empty, agent-actionable next`,
    )}, () => {`,
  );
  lines.push(`    const codes = ${JSON.stringify(declaredErrorCodes)} as const;`);
  lines.push('    for (const code of codes) {');
  lines.push('      const spec = ERROR_TAXONOMY[code];');
  lines.push('      expect(spec.next).toBeTruthy();');
  lines.push('      expect(spec.next.trim().length).toBeGreaterThan(0);');
  lines.push('      expect(spec.next).not.toMatch(/^try again\\.?$/i);');
  lines.push('    }');
  lines.push('  });');
  lines.push('');

  lines.push('});');
  lines.push('');

  return formatTsDeterministic(lines.join('\n'), repoRoot);
}
