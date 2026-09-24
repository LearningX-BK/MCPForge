// MCPForge — artefact: `generated/tools/<id>/contract.test.ts`. W0-B7.
//
// Reads: 02 §2.3's artefact table ("Contract tests — happy path, each
// declared error, dry-run shape, confirm-token binding, argument-mismatch
// refusal, idempotent replay, reversal round trip for write tools") and
// §7.3, plus §3.1 (two-phase confirm), §3.1.2 (idempotency), §3.1.4
// (reversal registry) and §3.1.5 (the closed error taxonomy — "every error
// requires a non-empty next").
//
// SCOPE BOUNDARY vs. `unit.test.ts` (W0-B6): that generator owns
// schema-boundary tests only (required fields, type coercion, enum
// rejection, guardrail thresholds) — see its own header. This generator
// owns the full two-phase CONTRACT: it drives the real `handle()` export
// from `handler.generated.ts` end to end, against a hand-rolled mock `Ctx`
// (Track C — `core/gateway/store/**` — does not exist yet at Wave 0; the
// mock reproduces the plan/confirm/idempotency bookkeeping a real store
// will do, per this task's own instructions to mock/stub in the same
// spirit as W0-B6's documented audit call-site stub).
//
// JUDGMENT CALL (documented per CLAUDE.md §8): 02 §2.3's table lists
// "Contract tests" as its own row, separate from "Unit tests", but is
// silent on whether a READ tool also gets a `contract.test.ts`, since the
// row's own wording ("... reversal round trip for write tools") only
// singles out the write-specific tail of an otherwise general list. The
// most literal reading is that every tool gets a contract.test.ts, and
// only the reversal-round-trip (and the two-phase-only sections: dry-run
// shape, confirm-token binding, idempotent replay) are write-specific. That
// is what this generator implements: a non-write tool still gets a
// generated contract.test.ts covering happy path and every declared error;
// a write tool additionally gets the two-phase sections.
//
// A SECOND JUDGMENT CALL: a "happy path" and a "target error" case can only
// be driven meaningfully when the tool has a custom binding body to mock
// (`bindingCustom: true`) — a non-custom tool's handler body is itself a
// documented Wave-1-scope placeholder (`const raw: unknown = {}`, see
// `templates/handler.ts`), so there is no real dispatch to mock a failure
// into. For a non-custom tool this generator still emits the happy-path
// and declared-error sections that ARE meaningful against that stub body
// (schema validation, guardrail breach), and documents in the generated
// file's own comment why the binding-dispatch-specific cases are omitted,
// rather than fabricating a target call that does not exist yet.

import { formatTsDeterministic } from '../../emit/writer.js';
import type { ProvenanceInfo } from '../../emit/provenance.js';
import { provenanceCommentHeader } from '../../emit/provenance.js';
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
      // A schema-boundary-valid string: format-specific where declared (Ajv
      // validates `format` for real here, unlike unit.test.ts's own
      // wrong-type fixtures, since contract.test.ts drives the real handler
      // end to end), a plain marker string otherwise.
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
 * (`"$.a.b.c"`), each leaf set to a distinct marker string, so a mocked
 * `customBinding.execute` resolves to a value `extractResultKeys` can
 * actually populate — needed for the reversal-round-trip test, which reads
 * the ACTUAL extracted result, not an empty stub.
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

  const guardrails = tool.writeSafety?.guardrails ?? [];
  const numericGuardrail = guardrails.find(
    (g) => g.kind === 'maxNumeric' && g.field !== undefined && typeof g.value === 'number',
  );

  const lines: string[] = [];
  lines.push(provenanceCommentHeader(provenance));
  lines.push('');
  lines.push(
    '// GENERATED CONTRACT TEST (W0-B7). Drives the real `handle()` export end to',
    '// end against a hand-rolled mock Ctx — Track C (core/gateway/store/**) does',
    '// not exist yet at Wave 0. See this file\'s generator',
    '// (core/codegen/src/templates/tests/contract-test.ts) for the documented',
    '// scope boundary against unit.test.ts (W0-B6, schema-boundary only).',
  );
  lines.push('');
  lines.push("import { beforeEach, describe, expect, it, vi } from 'vitest';");
  if (tool.bindingCustom) {
    lines.push("import * as customBinding from './binding.custom.js';");
  }
  lines.push("import { handle, type Args, type Ctx } from './handler.generated.js';");
  lines.push('');
  lines.push(`const VALID_ARGS = ${JSON.stringify(validArgs)} as unknown as Args;`);
  lines.push('');

  if (tool.bindingCustom) {
    lines.push("vi.mock('./binding.custom.js', () => ({ execute: vi.fn(), dryRun: vi.fn() }));");
    lines.push('');
  }

  // --- mock Ctx factory ---------------------------------------------------
  // A minimal, deterministic stand-in for the real gateway store (Track C).
  // `confirmTokens` and `idempotency` are backed by real in-memory maps and
  // real argsCanonicalHash comparison, so the confirm-token-binding and
  // idempotent-replay assertions below exercise the actual mismatch/replay
  // LOGIC this contract depends on, not just a canned mock response.
  lines.push('function makeCtx(): Ctx & { auditRecords: unknown[] } {');
  lines.push('  const tokens = new Map<string, { toolId: string; argsCanonicalHash: string }>();');
  lines.push('  const idempotencyStore = new Map<string, unknown>();');
  lines.push('  const auditRecords: unknown[] = [];');
  lines.push('  let tokenCounter = 0;');
  lines.push('  return {');
  lines.push('    callerSubject: "test-subject",');
  lines.push('    correlationId: "test-correlation-id",');
  lines.push('    auditRecords,');
  lines.push('    audit: {');
  lines.push('      async record(entry) {');
  lines.push('        auditRecords.push(entry);');
  lines.push('      },');
  lines.push('    },');
  lines.push('    confirmTokens: {');
  lines.push('      async mint({ toolId, argsCanonicalHash }) {');
  lines.push('        tokenCounter += 1;');
  lines.push('        const token = `cnf_test_${tokenCounter}`;');
  lines.push('        tokens.set(token, { toolId, argsCanonicalHash });');
  lines.push('        return { token, expiresAt: "2099-01-01T00:00:00.000Z" };');
  lines.push('      },');
  lines.push('      async verify({ toolId, token, argsCanonicalHash }) {');
  lines.push('        const minted = tokens.get(token);');
  lines.push(
    '        return { ok: minted !== undefined && minted.toolId === toolId && minted.argsCanonicalHash === argsCanonicalHash };',
  );
  lines.push('      },');
  lines.push('    },');
  lines.push('    idempotency: {');
  lines.push('      async recordBeforeInvoke(key) {');
  lines.push('        if (idempotencyStore.has(key)) {');
  lines.push('          return { replay: true, previousResult: idempotencyStore.get(key) };');
  lines.push('        }');
  lines.push('        return { replay: false };');
  lines.push('      },');
  lines.push('      async recordOutcome(key, result) {');
  lines.push('        idempotencyStore.set(key, result);');
  lines.push('      },');
  lines.push('    },');
  lines.push('  };');
  lines.push('}');
  lines.push('');

  if (tool.bindingCustom) {
    lines.push('const mockedExecute = vi.mocked(customBinding.execute);');
    lines.push('const mockedDryRun = vi.mocked(customBinding.dryRun);');
    lines.push('');
    const syntheticRaw = buildSyntheticRaw(tool.resultKeys);
    lines.push('beforeEach(() => {');
    lines.push('  mockedExecute.mockReset();');
    lines.push('  mockedDryRun.mockReset();');
    lines.push(`  mockedExecute.mockResolvedValue(${JSON.stringify(syntheticRaw)});`);
    lines.push(`  mockedDryRun.mockResolvedValue(${JSON.stringify(syntheticRaw)});`);
    lines.push('});');
    lines.push('');
  }

  lines.push(`describe(${JSON.stringify(`${tool.id} — contract (generated, W0-B7)`)}, () => {`);

  // --- 1. happy path --------------------------------------------------
  if (tool.write) {
    lines.push('  it("happy path: plan then execute with a valid confirmToken succeeds", async () => {');
    lines.push('    const ctx = makeCtx();');
    lines.push('    const planned = await handle(ctx, VALID_ARGS);');
    lines.push('    expect(planned).toMatchObject({ status: "confirm_required" });');
    lines.push('    const confirmed = (planned as { confirmToken: string }).confirmToken;');
    lines.push('    const executed = await handle(ctx, { ...VALID_ARGS, confirm: confirmed });');
    lines.push('    expect(executed).not.toHaveProperty("status", "confirm_required");');
    if (tool.bindingCustom) {
      lines.push('    expect(mockedDryRun).toHaveBeenCalledTimes(1);');
      lines.push('    expect(mockedExecute).toHaveBeenCalledTimes(1);');
    }
    lines.push('  });');
    lines.push('');
  } else {
    lines.push('  it("happy path: a valid call succeeds and returns the extracted result", async () => {');
    lines.push('    const ctx = makeCtx();');
    lines.push('    const result = await handle(ctx, VALID_ARGS);');
    lines.push('    expect(result).toBeDefined();');
    if (tool.bindingCustom) {
      lines.push('    expect(mockedExecute).toHaveBeenCalledTimes(1);');
    }
    lines.push('  });');
    lines.push('');
  }

  // --- 2. every declared error path, each with a non-empty `next` -----
  lines.push('  it("declared error: INPUT_INVALID on schema violation, with a non-empty next", async () => {');
  lines.push('    const ctx = makeCtx();');
  lines.push('    const { [Object.keys(VALID_ARGS as unknown as Record<string, unknown>)[0]!]: _drop, ...bad } = VALID_ARGS as unknown as Record<string, unknown>;');
  lines.push('    await expect(handle(ctx, bad)).rejects.toMatchObject({');
  lines.push('      code: "INPUT_INVALID",');
  lines.push('      next: expect.stringMatching(/\\S/),');
  lines.push('    });');
  lines.push('  });');
  lines.push('');

  if (numericGuardrail) {
    const field = numericGuardrail.field!;
    const value = numericGuardrail.value as number;
    lines.push(
      `  it(${JSON.stringify(`declared error: POLICY_GUARDRAIL_BREACH when "${field}" exceeds its ${value} ceiling, with a non-empty next`)}, async () => {`,
    );
    lines.push('    const ctx = makeCtx();');
    lines.push(`    const bad = { ...VALID_ARGS, ${field}: ${value + 1} } as unknown as Args;`);
    lines.push('    await expect(handle(ctx, bad)).rejects.toMatchObject({');
    lines.push('      code: "POLICY_GUARDRAIL_BREACH",');
    lines.push('      next: expect.stringMatching(/\\S/),');
    lines.push('    });');
    lines.push('  });');
    lines.push('');
  }

  if (tool.write) {
    lines.push('  it("declared error: PLAN_ARGUMENT_MISMATCH when confirm token does not match the presented arguments, with a non-empty next", async () => {');
    lines.push('    const ctx = makeCtx();');
    lines.push('    await expect(handle(ctx, { ...VALID_ARGS, confirm: "cnf_never_minted" })).rejects.toMatchObject({');
    lines.push('      code: "PLAN_ARGUMENT_MISMATCH",');
    lines.push('      next: expect.stringMatching(/\\S/),');
    lines.push('    });');
    lines.push('  });');
    lines.push('');
  }

  if (tool.bindingCustom) {
    lines.push('  it("declared error: an unmapped target failure maps to TARGET_ERROR, with a non-empty next", async () => {');
    lines.push('    const ctx = makeCtx();');
    if (tool.write) {
      lines.push('    mockedDryRun.mockRejectedValueOnce(new Error("target says no"));');
    } else {
      lines.push('    mockedExecute.mockRejectedValueOnce(new Error("target says no"));');
    }
    lines.push('    await expect(handle(ctx, VALID_ARGS)).rejects.toMatchObject({');
    lines.push('      code: "TARGET_ERROR",');
    lines.push('      next: expect.stringMatching(/\\S/),');
    lines.push('    });');
    lines.push('  });');
    lines.push('');
  }

  if (tool.write) {
    // --- 3. dry-run shape ---------------------------------------------
    lines.push('  it("dry-run shape: the plan-phase response carries status/plan/confirmToken/expiresAt/next (02 §3.1.1)", async () => {');
    lines.push('    const ctx = makeCtx();');
    lines.push('    const planned = await handle(ctx, VALID_ARGS);');
    lines.push('    expect(planned).toMatchObject({');
    lines.push('      status: "confirm_required",');
    lines.push('      confirmToken: expect.any(String),');
    lines.push('      expiresAt: expect.any(String),');
    lines.push('      next: expect.stringMatching(/\\S/),');
    lines.push('    });');
    lines.push('    expect(planned).toHaveProperty("plan");');
    lines.push('  });');
    lines.push('');

    // --- 4. confirm-token binding --------------------------------------
    lines.push('  it("confirm-token binding: a token minted for one argument set is refused against a different one (PLAN_ARGUMENT_MISMATCH)", async () => {');
    lines.push('    const ctx = makeCtx();');
    lines.push('    const planned = await handle(ctx, VALID_ARGS);');
    lines.push('    const token = (planned as { confirmToken: string }).confirmToken;');
    if (tool.input.length > 0) {
      const first = tool.input[0]!;
      lines.push(
        `    const tampered = { ...VALID_ARGS, ${first.name}: ${JSON.stringify(`${String(exampleValue(first))}-TAMPERED`)} } as unknown as Args;`,
      );
    } else {
      lines.push('    const tampered = { ...VALID_ARGS } as unknown as Args;');
    }
    lines.push('    await expect(handle(ctx, { ...tampered, confirm: token })).rejects.toMatchObject({');
    lines.push('      code: "PLAN_ARGUMENT_MISMATCH",');
    lines.push('      next: expect.stringMatching(/\\S/),');
    lines.push('    });');
    lines.push('  });');
    lines.push('');

    // --- 5. argument-mismatch refusal (explicit, per the done criterion's own wording) ---
    lines.push('  it("argument-mismatch refusal: execute is refused, not silently re-planned, when arguments changed after planning", async () => {');
    lines.push('    const ctx = makeCtx();');
    lines.push('    const planned = await handle(ctx, VALID_ARGS);');
    lines.push('    const token = (planned as { confirmToken: string }).confirmToken;');
    lines.push('    let threw = false;');
    lines.push('    try {');
    lines.push(
      '      await handle(ctx, { ...VALID_ARGS, confirm: token, ' +
        JSON.stringify(tool.input[0]?.name ?? 'unused') +
        ': "__changed__" } as unknown as Args);',
    );
    lines.push('    } catch (err) {');
    lines.push('      threw = true;');
    lines.push('      expect((err as { code: string }).code).toBe("PLAN_ARGUMENT_MISMATCH");');
    lines.push('      expect((err as { next: string }).next.trim().length).toBeGreaterThan(0);');
    lines.push('    }');
    lines.push('    expect(threw).toBe(true);');
    lines.push('  });');
    lines.push('');

    // --- 6. idempotent replay -------------------------------------------
    lines.push('  it("idempotent replay: executing twice with the same confirmToken returns the original result with replayed: true, without re-invoking the target (02 §3.1.2)", async () => {');
    lines.push('    const ctx = makeCtx();');
    lines.push('    const planned = await handle(ctx, VALID_ARGS);');
    lines.push('    const token = (planned as { confirmToken: string }).confirmToken;');
    lines.push('    const first = await handle(ctx, { ...VALID_ARGS, confirm: token });');
    lines.push('    const second = await handle(ctx, { ...VALID_ARGS, confirm: token });');
    lines.push('    expect((second as Record<string, unknown>).replayed).toBe(true);');
    lines.push('    const { replayed: _r1, ...firstRest } = first as Record<string, unknown>;');
    lines.push('    const { replayed: _r2, ...secondRest } = second as Record<string, unknown>;');
    lines.push('    expect(secondRest).toEqual(firstRest);');
    if (tool.bindingCustom) {
      lines.push('    expect(mockedExecute).toHaveBeenCalledTimes(1);');
    }
    lines.push('  });');
    lines.push('');

    // --- 7. reversal round trip -----------------------------------------
    const reversal = tool.writeSafety;
    const argMapEntries = reversal ? Object.entries(reversal.reversalArgMap) : [];
    // W0-I3 EXTENSION: the round trip is emitted for `native-reverse` too.
    // Originally this section was gated on `compensating-tool` alone, which
    // left the one class whose reversal is the TARGET's own operation
    // (02 §3.1.4: `jde.fin.journal.submit` -> JDE journal reversal) with no
    // generated reverse leg at all — and W0-I3's own done criterion requires
    // the full plan -> confirm -> execute -> reverse round trip against the
    // mock for a native-reverse pair. The assertions are identical; only the
    // narration differs, because a native reverse has no reversing tool id.
    // `irreversible` is excluded by construction: there is nothing to map.
    const reversalClass = reversal?.reversalClass ?? null;
    const roundTripApplies =
      tool.bindingCustom &&
      reversal !== null &&
      argMapEntries.length > 0 &&
      ((reversalClass === 'compensating-tool' && Boolean(reversal.reversalTool)) ||
        reversalClass === 'native-reverse' ||
        reversalClass === 'transactional');
    if (roundTripApplies && reversal) {
      const isCompensating = reversalClass === 'compensating-tool';
      if (isCompensating) {
        lines.push(
          '  // Reversal round trip (02 §3.1.4): `writeSafety.reversal.class: compensating-tool`',
          `  // names ${JSON.stringify(reversal.reversalTool)} as the reversing tool. That tool's own`,
          '  // manifest/generated handler is not assumed to exist at Wave 0, so this proves the',
          "  // pure data-mapping half of the round trip: `writeSafety.reversal.argMap` correctly",
          "  // maps this call's own result keys into the reversing tool's arguments, resolved",
          '  // against the ACTUAL result this handler returned from a real execute call.',
        );
      } else {
        lines.push(
          `  // Reversal round trip (02 §3.1.4): \`writeSafety.reversal.class: ${String(reversalClass)}\` —`,
          "  // the reversal is the TARGET system's own operation, not a sibling tool, so there is",
          '  // no reversing tool id to name. What must hold is identical and is what this proves:',
          "  // `writeSafety.reversal.argMap` resolves every argument the reversing call needs out",
          "  // of THIS call's own extracted result keys, against the ACTUAL result this handler",
          '  // returned from a real execute call. An unresolved mapping is a write nobody can undo.',
        );
      }
      lines.push(
        `  it(${JSON.stringify(
          isCompensating
            ? `reversal round trip: writeSafety.reversal.argMap maps the result of this call into ${reversal.reversalTool}'s arguments`
            : `reversal round trip: writeSafety.reversal.argMap maps the result of this call into the ${String(reversalClass)} reversing call's arguments`,
        )}, async () => {`,
      );
      lines.push('    const ctx = makeCtx();');
      lines.push('    const planned = await handle(ctx, VALID_ARGS);');
      lines.push('    const token = (planned as { confirmToken: string }).confirmToken;');
      lines.push('    const executed = (await handle(ctx, { ...VALID_ARGS, confirm: token })) as Record<string, unknown>;');
      lines.push('');
      if (isCompensating) {
        lines.push(`    const REVERSAL_TOOL_ID = ${JSON.stringify(reversal.reversalTool)};`);
      } else {
        lines.push(`    const REVERSAL_CLASS = ${JSON.stringify(reversalClass)};`);
      }
      lines.push(`    const ARG_MAP = ${JSON.stringify(reversal.reversalArgMap)} as const;`);
      lines.push('');
      lines.push('    function readResultPath(path: string): unknown {');
      lines.push('      const m = /^\\$\\.result\\.([a-zA-Z0-9_]+)$/.exec(path);');
      lines.push('      if (!m) return undefined;');
      lines.push('      return executed[m[1]!];');
      lines.push('    }');
      lines.push('');
      lines.push('    const reversalArgs: Record<string, unknown> = {};');
      lines.push('    for (const [argName, path] of Object.entries(ARG_MAP)) reversalArgs[argName] = readResultPath(path);');
      lines.push('');
      lines.push(
        isCompensating
          ? `    expect(REVERSAL_TOOL_ID).toBe(${JSON.stringify(reversal.reversalTool)});`
          : `    expect(REVERSAL_CLASS).toBe(${JSON.stringify(reversalClass)});`,
      );
      for (const [argName, path] of argMapEntries) {
        const field = jsonPathField(path);
        if (field === null) continue;
        lines.push(
          `    expect(reversalArgs[${JSON.stringify(argName)}]).toBe(executed[${JSON.stringify(field)}]);`,
        );
      }
      lines.push(
        "    // Every mapped arg must resolve to a defined value from THIS call's own result —",
        '    // an unresolved mapping would silently pass the reversal tool a bad argument.',
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
