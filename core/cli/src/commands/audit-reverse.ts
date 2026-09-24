// MCPForge — `forge audit reverse <callId>`. W0-F5, 02 §3.1.4, 03 §7.5.
// Wave 0 exit criterion 7(a).
//
// 02 §3.1.4, on why this is a COMMAND and not a runbook page: "`forge audit
// reverse <callId>` … constructs the reversing call by applying
// `reversal.argMap` to the original call's result keys. That is how Wave 0
// exit criterion 7(a) is demonstrated: **it is a one-command operation, not an
// improvised script.**"
//
// Same split as `./audit.ts`: the command formats, it does not implement. The
// construction is `core/gateway/reversal/` — the identical module the portal's
// Reverse action and the write-path tests use, so the CLI cannot drift into a
// second, more permissive way back.
//
// TWO THINGS THIS COMMAND DELIBERATELY DOES NOT DO, both for the same reason.
//
// It does not execute, and it does not pretend it could. A bare CLI process
// holds no MCP session: no registered consumer, no resolved human identity, no
// binding executor. Non-negotiable 6 says a call needs BOTH a registered
// consumer and a resolved human identity, and non-negotiable 1 says the
// missing one may never be defaulted — so a CLI that executed a write would
// have to invent exactly the thing this codebase forbids. What it therefore
// produces is the constructed call: the tool id and the exact arguments,
// derived from the business keys the original call actually recorded, for a
// human or an agent to put through the ordinary plan -> confirm -> execute
// chain from a real session. `--execute` is refused with that explanation
// rather than silently absent, because a flag that does not exist teaches
// nothing and an operator will otherwise go looking for a shortcut.
//
// The seam for executing it exists and is exercised: `ReversalExecutor`
// (`core/gateway/reversal/types.ts`) is implemented against the real confirm
// gate and the real write dispatcher in this task's tests, which is where the
// "runs the full plan -> confirm sequence" and "linked in both directions"
// clauses of the `done:` criterion are proved end to end against real SQLite.

import { loadManifestFiles, resolvedKindAndId } from '@mcpforge/codegen/validate';
import { findRepoRoot } from '@mcpforge/ci';
import {
  openRuntimeStore,
  storeConfigFromEnv,
  type RuntimeStore,
} from '@mcpforge/gateway/store/server';
import {
  reverseCall,
  reversalRegistry,
  type ReversalContract,
  type ReversalRegistry,
  type ReversalReport,
} from '@mcpforge/gateway/reversal';

const USAGE_EXIT_CODE = 64;

export interface AuditReverseOptions {
  readonly json: boolean;
  /** Positional `<callId>`, lifted into the options bag by `program.ts`. */
  readonly target?: string;
  /** Refused, on purpose. See the header. */
  readonly execute?: boolean;
}

export interface AuditReverseCliError {
  readonly ok: false;
  readonly code: 'INPUT_INVALID';
  readonly message: string;
  readonly next: string;
}

function usageError(message: string, next: string): AuditReverseCliError {
  return { ok: false, code: 'INPUT_INVALID', message, next };
}

function emitError(error: AuditReverseCliError, json: boolean): number {
  if (json) {
    process.stdout.write(`${JSON.stringify(error)}\n`);
  } else {
    process.stderr.write(`forge: audit reverse — ${error.message}\n`);
    process.stderr.write(`forge: next — ${error.next}\n`);
  }
  return USAGE_EXIT_CODE;
}

/** A `writeSafety.reversal` block read off a raw manifest document. */
function reversalOf(doc: Record<string, unknown>): ReversalContract | undefined {
  const ws = doc['writeSafety'];
  if (ws === null || typeof ws !== 'object') return undefined;
  const raw = (ws as Record<string, unknown>)['reversal'];
  if (raw === null || typeof raw !== 'object') return undefined;
  const block = raw as Record<string, unknown>;
  const cls = block['class'];
  if (typeof cls !== 'string') return undefined;

  const tool = block['tool'];
  const windowHours = block['windowHours'];
  const preconditions = block['preconditions'];
  const rawArgMap = block['argMap'];
  const argMap: Record<string, string> = {};
  if (rawArgMap !== null && typeof rawArgMap === 'object') {
    for (const [arg, path] of Object.entries(rawArgMap as Record<string, unknown>)) {
      if (typeof path === 'string') argMap[arg] = path;
    }
  }

  return {
    class: cls as ReversalContract['class'],
    ...(typeof tool === 'string' ? { tool } : {}),
    ...(Object.keys(argMap).length > 0 ? { argMap } : {}),
    ...(typeof windowHours === 'number' ? { windowHours } : {}),
    ...(typeof preconditions === 'string' ? { preconditions } : {}),
  };
}

/**
 * Build the reversal registry from the MANIFESTS, not from `generated/`.
 *
 * The manifest is the sole source of truth (CLAUDE.md §3), and `argMap` is the
 * one part of the contract the audit row does not freeze: `reversal_class` and
 * `reversal_tool_id` are on the row, but the map from the reversing tool's
 * arguments to the original call's result keys is read here. Where the row and
 * the manifest disagree about the class or the tool, `contractForCall` prefers
 * the ROW — the call was made under the manifest as it was then.
 */
export function reversalRegistryFromManifests(repoRoot: string): ReversalRegistry {
  const contracts = new Map<string, ReversalContract>();
  for (const file of loadManifestFiles(repoRoot)) {
    const resolved = resolvedKindAndId(file);
    if (resolved === null || resolved.kind !== 'Tool') continue;
    const doc = file.doc as Record<string, unknown>;
    const contract = reversalOf(doc);
    if (contract !== undefined) contracts.set(resolved.id, contract);
  }
  return reversalRegistry(contracts);
}

function formatReportHuman(report: ReversalReport): string {
  const lines: string[] = [
    `forge audit reverse ${report.originalCallId}`,
    `  original tool: ${report.originalToolId}`,
    `  reversal class: ${report.reversalClass ?? '(none recorded)'}`,
  ];

  const keyNames = Object.keys(report.resultKeys);
  lines.push(
    keyNames.length === 0
      ? '  result keys: (none recorded — there is no reversal handle)'
      : `  result keys: ${keyNames.map((k) => `${k}=${report.resultKeys[k]}`).join(' · ')}`,
  );

  if (report.links !== null) {
    lines.push(
      `  reverses_call_id: ${report.links.reversesCallId ?? '—'}`,
      `  reversed_by_call_id: ${report.links.reversedByCallId ?? '—'}`,
    );
  }

  if (report.refusal !== null) {
    lines.push(
      '',
      `  REFUSED (${report.refusal.reason})`,
      `    ${report.refusal.message}`,
      `    next: ${report.refusal.next}`,
    );
    return lines.join('\n');
  }

  const call = report.reversingCall;
  if (call === null) {
    return lines.join('\n');
  }

  lines.push(
    '',
    `  The reversing call, constructed from the business keys above:`,
    `    tool: ${call.toolId}`,
    ...Object.entries(call.args).map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`),
    '',
    // 03 §7.5, verbatim in spirit: "A reversal is itself a write, so it runs
    // the full plan -> confirm sequence. It is not a shortcut."
    `  NOT executed. A reversal is itself a write and runs the full plan -> confirm sequence`,
    `  from a real session, which this CLI process does not hold.`,
    `  next: make this call from a registered consumer with a resolved human identity —`,
    `  plan it, confirm the token against identical arguments, and execute. The gateway`,
    `  records it with reverses_call_id=${report.originalCallId}, which links both calls.`,
  );
  return lines.join('\n');
}

export interface AuditReverseDeps {
  readonly openStore?: () => Promise<RuntimeStore>;
  readonly registry?: ReversalRegistry;
  readonly repoRoot?: string;
  now?(): Date;
}

/**
 * `forge audit reverse <callId> [--json]`.
 *
 * Exit 0 when a reversing call was constructed, 1 when the call cannot be
 * reversed (a refusal is a REPORTED outcome carrying a `next`, never a crash —
 * non-negotiable 5), 64 on a usage error.
 */
export async function runAuditReverseCommand(
  callId: string | undefined,
  opts: AuditReverseOptions,
  deps: AuditReverseDeps = {},
): Promise<number> {
  const json = opts.json;
  const id = (callId ?? opts.target)?.trim();
  if (!id) {
    return emitError(
      usageError(
        'An audit call id is required.',
        'Run "forge audit reverse <callId> [--json]". Find the call id in the audit trail, or in the execute response\'s correlationId lookup.',
      ),
      json,
    );
  }

  if (opts.execute === true) {
    return emitError(
      usageError(
        '--execute is not available. A reversal is itself a write, so it runs the full plan -> confirm sequence from a real session, and this CLI process holds no registered consumer and no resolved human identity (non-negotiables 1 and 6).',
        'Run "forge audit reverse <callId>" to construct the call, then make that call from a registered consumer with a resolved human identity — the gateway links it to the original by reverses_call_id.',
      ),
      json,
    );
  }

  const registry =
    deps.registry ?? reversalRegistryFromManifests(deps.repoRoot ?? findRepoRoot());

  const open = deps.openStore ?? (() => openRuntimeStore(storeConfigFromEnv()));
  const store = await open();
  try {
    const report = await reverseCall(id, {
      audit: store.audit,
      registry,
      ...(deps.now === undefined ? {} : { now: deps.now }),
    });
    if (json) {
      process.stdout.write(`${JSON.stringify(report)}\n`);
    } else {
      process.stdout.write(`${formatReportHuman(report)}\n`);
    }
    return report.refusal === null ? 0 : 1;
  } finally {
    await store.close();
  }
}
