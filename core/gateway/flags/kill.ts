// MCPForge — `forge kill`'s business logic. W0-E5, 02 §4.7 as extended by
// 02 §11.2 (Phase 5's fifth granularity, consumer).
//
// This is the seam the CLI command (`core/cli/src/commands/kill.ts`) calls
// into and nothing more: parse a `scope:target` (or bare tool id) string,
// validate it against the closed `KILL_SCOPES` set already owned by
// `core/gateway/scope/types.ts`, write one `runtime_flags` row, and append
// one audit record naming the author and the reason — for EVERY granularity,
// not only `consumer`: an unaudited kill switch on a tool or a whole
// deployment would leave the same "who did this and why" gap the task's own
// `consumer` requirement calls out, just on four other targets.

import { uuidv7, type AuditRepository, type RuntimeFlagsRepository } from '../store/index.js';
import { KILL_SCOPES, type KillScope } from '../scope/types.js';

export interface ParsedKillTarget {
  readonly scope: KillScope;
  readonly target: string;
}

export class InvalidKillTargetError extends Error {
  constructor(raw: string) {
    super(
      `"${raw}" is not a valid forge kill target. Use a bare tool id (tool scope), or one of ` +
        `${KILL_SCOPES.filter((s) => s !== 'tool')
          .map((s) => `${s}:<id>`)
          .join(', ')}.`,
    );
    this.name = 'InvalidKillTargetError';
  }
}

/** Prefixes for every non-`tool` granularity, in `KILL_SCOPES` order. */
const SCOPE_PREFIXES: ReadonlyMap<string, KillScope> = new Map([
  ['server', 'moduleServer'],
  ['moduleServer', 'moduleServer'],
  ['bindingType', 'bindingType'],
  ['consumer', 'consumer'],
  ['deployment', 'deployment'],
]);

/**
 * `jde.ap.voucher.create` -> `{ scope: 'tool', target: 'jde.ap.voucher.create' }`
 * `consumer:agent-x` -> `{ scope: 'consumer', target: 'agent-x' }`
 * `server:ebs-p2p-ap` -> `{ scope: 'moduleServer', target: 'ebs-p2p-ap' }`
 *
 * A bare string with no recognised `prefix:` is `tool` scope — 02 §4.7's
 * worked example (`forge kill jde.ap.voucher.create --reason "..."`) names a
 * tool id with no prefix at all, so `tool` is the scope a caller reaches
 * without typing anything scope-specific.
 */
export function parseKillTarget(raw: string): ParsedKillTarget {
  const trimmed = raw.trim();
  const colon = trimmed.indexOf(':');
  if (colon > 0) {
    const prefix = trimmed.slice(0, colon);
    const rest = trimmed.slice(colon + 1).trim();
    const scope = SCOPE_PREFIXES.get(prefix);
    if (scope !== undefined && rest.length > 0) {
      return { scope, target: rest };
    }
    throw new InvalidKillTargetError(raw);
  }
  if (trimmed.length === 0) {
    throw new InvalidKillTargetError(raw);
  }
  return { scope: 'tool', target: trimmed };
}

export interface ApplyKillInput {
  readonly raw: string;
  readonly reason: string;
  /** `--until`, already parsed. `undefined`/`null` — indefinite. */
  readonly until?: Date | null;
  /** `Principal.subject` of whoever ran `forge kill` — never defaulted (CLAUDE.md §3). */
  readonly actorSubject: string;
  /** Which deployment's audit chain records this action. */
  readonly deploymentId: string;
  readonly now?: Date;
  /**
   * W0-N8. Defaults to `true` — `forge kill` is a human at a terminal. An
   * automated caller (the anomaly runner's one sanctioned action, 02 §11.6)
   * passes `false`, because writing `humanInTheLoop: true` on a kill no human
   * ordered would make the audit trail lie about the single fact that
   * distinguishes the two.
   */
  readonly humanInTheLoop?: boolean;
  /**
   * W0-N8. The `consumer_id` written on the kill's own audit row — the ACTOR,
   * not the target. Defaults to `forge-cli`, the first-party operator surface.
   * The audit path is otherwise identical for a human and an automated kill:
   * same `applyKill`, same chain, same reason, same result keys. Only the
   * actor identity differs, which is exactly how it should read.
   */
  readonly actorConsumerId?: string;
  /**
   * W0-N8. Extra result keys appended to the kill's audit row, so a
   * detector-triggered kill is one hop from the `anomaly_event` that caused
   * it. Never replaces the three keys below.
   */
  readonly extraResultKeys?: readonly { readonly keyName: string; readonly keyValue: string }[];
}

export interface ApplyKillResult {
  readonly scope: KillScope;
  readonly target: string;
  readonly flagId: string;
  readonly auditCallId: string;
}

export const KILL_TOOL_ID = 'forge.kill';

/**
 * Writes the `runtime_flags` row and its audit record. Not itself wrapped in
 * `store.transaction` across the two repositories deliberately: the flag row
 * is the control that must exist as fast as possible (the poll reads it
 * unconditionally), and the audit append recomputes the deployment's chain
 * head independently — see `../store/audit/repository.ts`'s own serialising
 * queue. If the audit append fails after the flag is written, the kill switch
 * is still in force (fails toward MORE restriction, never less) and the
 * failure surfaces to the CLI caller rather than being silently absorbed.
 */
export async function applyKill(
  flags: RuntimeFlagsRepository,
  audit: AuditRepository,
  input: ApplyKillInput,
): Promise<ApplyKillResult> {
  const { scope, target } = parseKillTarget(input.raw);
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  const flag = await flags.create({
    scope,
    target,
    reason: input.reason,
    until: input.until ? input.until.toISOString() : null,
    createdBy: input.actorSubject,
    now: nowIso,
  });

  const record = await audit.append({
    ts: nowIso,
    callerSubject: input.actorSubject,
    humanInTheLoop: input.humanInTheLoop ?? true,
    // `forge kill` has no registered-consumer session; it is a first-party
    // operator action against the store itself, named so audit queries can
    // distinguish it from any agent-driven call (non-negotiable 6 governs
    // TOOL calls through the gateway; this is the gateway's own admin surface).
    consumerId: input.actorConsumerId ?? 'forge-cli',
    toolId: KILL_TOOL_ID,
    isWrite: true,
    deploymentId: input.deploymentId,
    phase: 'execute',
    outcome: 'ok',
    resultKeys: [
      { keyName: 'kill_scope', keyValue: scope },
      { keyName: 'kill_target', keyValue: target },
      { keyName: 'runtime_flag_id', keyValue: flag.id },
      ...(input.extraResultKeys ?? []),
    ],
    argsRedacted: {
      scope,
      target,
      reason: input.reason,
      until: input.until ? input.until.toISOString() : null,
    },
  });

  return { scope, target, flagId: flag.id, auditCallId: record.id };
}

/** So a caller never has to invent an id for something that never gets one. */
export function newKillCorrelationId(): string {
  return uuidv7();
}
