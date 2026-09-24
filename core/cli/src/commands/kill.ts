// MCPForge — `forge kill`. W0-E5, 02 §4.7 as extended by 02 §11.2.
//
// `forge kill <target> --reason "..." [--until <date>] --by <subject> [--deployment <id>]`
//
// Five granularities, all built now (not four-then-bolt-on, per this repo's
// established pattern — see W0-E2's scope module, which already wired the
// fifth, `consumer`, into `¬KillSwitched` from day one):
//
//   forge kill jde.ap.voucher.create --reason "..."     tool
//   forge kill server:ebs-p2p-ap --reason "..."         moduleServer
//   forge kill bindingType:plsql --reason "..."         bindingType
//   forge kill consumer:agent-x --reason "..."          consumer
//   forge kill deployment:dep-1 --reason "..."          deployment
//
// `--by` is required rather than defaulted to an OS/env identity, following
// this codebase's stated rule that there is no fallback identity anywhere
// (CLAUDE.md non-negotiable 1): a bare CLI invocation carries no
// authenticated session, so the acting `Principal.subject` must be named
// explicitly, exactly as `retention.ts`'s `actorSubject` already is for the
// same reason.
//
// The command formats; it does not implement. `applyKill`
// (`core/gateway/flags/kill.ts`) writes the `runtime_flags` row and the
// audit record; this file is argument handling, the error taxonomy, and
// human/JSON rendering — the same split as `./audit.ts` and `./identity.ts`.

import { openRuntimeStore, storeConfigFromEnv, type RuntimeStore } from '@mcpforge/gateway/store/server';
import { applyKill, InvalidKillTargetError, type ApplyKillResult } from '@mcpforge/gateway/flags';

export interface KillOptions {
  readonly json: boolean;
  readonly reason?: string;
  readonly until?: string;
  readonly by?: string;
  readonly deployment?: string;
}

export interface KillCliError {
  readonly ok: false;
  readonly code: 'INPUT_INVALID';
  readonly message: string;
  readonly next: string;
}

export interface KillReport {
  readonly ok: true;
  readonly target: string;
  readonly scope: ApplyKillResult['scope'];
  readonly resolvedTarget: string;
  readonly reason: string;
  readonly until: string | null;
  readonly by: string;
  readonly deploymentId: string;
  readonly flagId: string;
  readonly auditCallId: string;
}

const USAGE_EXIT_CODE = 64;
const DEFAULT_DEPLOYMENT_ID = 'default';

function usageError(message: string): KillCliError {
  return {
    ok: false,
    code: 'INPUT_INVALID',
    message,
    next:
      'Run "forge kill <tool-id|server:<id>|bindingType:<type>|consumer:<id>|deployment:<id>> ' +
      '--reason \\"...\\" --by <subject> [--until <date>] [--deployment <id>] [--json]".',
  };
}

function emitError(error: KillCliError, json: boolean): number {
  if (json) {
    process.stdout.write(`${JSON.stringify(error)}\n`);
  } else {
    process.stderr.write(`forge: kill — ${error.message}\n`);
    process.stderr.write(`forge: next — ${error.next}\n`);
  }
  return USAGE_EXIT_CODE;
}

function formatReportHuman(report: KillReport): string {
  const untilNote = report.until ? ` until ${report.until}` : ' (indefinite)';
  return [
    `forge kill: OK`,
    `  scope: ${report.scope}`,
    `  target: ${report.resolvedTarget}`,
    `  reason: ${report.reason}${untilNote}`,
    `  by: ${report.by}`,
    `  deployment: ${report.deploymentId}`,
    `  runtime_flags id: ${report.flagId}`,
    `  audit call id: ${report.auditCallId}`,
    `  Takes effect within the next 5-second gateway poll — no redeploy required (02 §4.7).`,
  ].join('\n');
}

export interface KillCommandDeps {
  /** Injected by tests so they kill-switch against an isolated store. */
  readonly openStore?: () => Promise<RuntimeStore>;
}

/**
 * `forge kill <target> --reason "..." --by <subject> [--until <date>] [--deployment <id>] [--json]`.
 *
 * Exit 0 on a successful kill; 64 (INPUT_INVALID) on a missing/malformed
 * argument, matching this CLI's established usage-error convention
 * (`./identity.ts`).
 */
export async function runKillCommand(
  target: string | undefined,
  opts: KillOptions,
  deps: KillCommandDeps = {},
): Promise<number> {
  const json = opts.json;
  if (!target || target.trim().length === 0) {
    return emitError(usageError('A kill target is required — a tool id, or scope:<id>.'), json);
  }
  const reason = opts.reason?.trim();
  if (!reason) {
    return emitError(usageError('--reason is required and must be non-empty.'), json);
  }
  const by = opts.by?.trim();
  if (!by) {
    return emitError(
      usageError(
        '--by <subject> is required — there is no default acting identity for a bare CLI ' +
          'invocation (CLAUDE.md non-negotiable 1: no service-account fallback).',
      ),
      json,
    );
  }

  let until: Date | null = null;
  if (opts.until !== undefined) {
    const parsed = new Date(opts.until);
    if (Number.isNaN(parsed.getTime())) {
      return emitError(usageError(`--until "${opts.until}" is not a parseable date.`), json);
    }
    until = parsed;
  }

  const deploymentId = opts.deployment?.trim() || DEFAULT_DEPLOYMENT_ID;

  const open = deps.openStore ?? (() => openRuntimeStore(storeConfigFromEnv()));
  const store = await open();
  try {
    let result: ApplyKillResult;
    try {
      result = await applyKill(store.runtimeFlags, store.audit, {
        raw: target,
        reason,
        until,
        actorSubject: by,
        deploymentId,
      });
    } catch (error) {
      if (error instanceof InvalidKillTargetError) {
        return emitError(usageError(error.message), json);
      }
      throw error;
    }

    const report: KillReport = {
      ok: true,
      target,
      scope: result.scope,
      resolvedTarget: result.target,
      reason,
      until: until ? until.toISOString() : null,
      by,
      deploymentId,
      flagId: result.flagId,
      auditCallId: result.auditCallId,
    };

    if (json) {
      process.stdout.write(`${JSON.stringify(report)}\n`);
    } else {
      process.stdout.write(`${formatReportHuman(report)}\n`);
    }
    return 0;
  } finally {
    await store.close();
  }
}
