// MCPForge — `POST /api/v1/admin/catalogue/reload`: a super admin asks the
// gateway to re-load its runtime catalogue from the definitions clone. W0-P33c.
//
// Decision C of the approved W0-P33 design note (owner, 30 Sep 2026: "Reload
// endpoint (Recommended)"), docs/build-plan/w0-p33-portal-merge.md §2.4: "a
// reload endpoint on the gateway, callable only by a super admin through the
// portal's consumer. It re-runs `loadRuntimeCatalogue` on the clone and swaps
// the served catalogue only if the new one loads cleanly. Otherwise it keeps
// serving the old one and reports why."
//
// WHO MAY RELOAD. Both halves of the intersection (non-negotiable 6), checked
// after the read API's front door has already resolved a registered consumer
// AND a human:
//
//  1. The consumer: its registration allows writes AND attests a human in its
//     loop. Reloading changes what every session is served, so it is a write,
//     and it is a human's act: an autonomous agent's consumer may not do it
//     even with a super admin's token. (The portal's consumer is both.)
//  2. The human: holds a `superAdmins:` group of this deployment's git mapping
//     (W0-P31), as served by the generation the request arrived on.
//
// EVIDENCE. Every attempt that passed the front door appends one hash-chained
// `catalogue` audit row: a refusal at either half, a load that was refused,
// and a reload that happened. For a reload that happens, the row is written
// BEFORE the swap (`assembly/reload.ts`), so a reload the trail does not
// record does not happen.
//
// The request takes no body. What is loaded is whatever the definitions root
// holds; the request cannot name a path, a branch or a tool.

import { CATALOGUE_RELOAD_PATH } from '@mcpforge/shared/api/v1';
import type { CatalogueReloadRefusal, CatalogueReloadResponse } from '@mcpforge/shared/api/v1';
import type { EstablishedSession } from '../../assembly/session.js';
import type { RuntimeCatalogue } from '../../assembly/catalogue.js';
import type { ReloadOutcome } from '../../assembly/reload.js';
import type { AppendAuditCallInput, AuditCallRecord } from '../../store/audit/types.js';
import type { RuntimeStore } from '../../store/repository.js';
import { holdsQualifiedGroup } from '../../identity/subject.js';
import { ApiRefusal } from './refusal.js';

/** The tool id a `catalogue` audit row names: reloading touches no one tool. */
export const RELOAD_PSEUDO_TOOL_ID = 'forge.catalogue.reload';

/** The API-only refusal code for definitions that did not load. HTTP 409. */
export const CATALOGUE_LOAD_REFUSED = 'CATALOGUE_LOAD_REFUSED';

/** True when `pathname` is the reload path. */
export function isCatalogueReloadPath(pathname: string): boolean {
  return pathname === CATALOGUE_RELOAD_PATH;
}

/** The reload seam the launch assembly provides. */
export interface CatalogueReloadSource {
  reload<R>(
    record: (outcome: ReloadOutcome) => Promise<R>,
  ): Promise<{ readonly outcome: ReloadOutcome; readonly recorded: R }>;
}

export interface CatalogueReloadDeps {
  readonly store: Pick<RuntimeStore, 'audit' | 'transaction'>;
  readonly reloader: CatalogueReloadSource;
  /** The `superAdmins:` groups, as the generation serving this request holds them. */
  readonly superAdminGroups: readonly string[];
  /** The `/deployment` digest, over a given catalogue. */
  digest(catalogue: RuntimeCatalogue): string;
  readonly gatewayVersion: string;
  readonly now: () => Date;
}

export interface ReloadActor {
  readonly session: EstablishedSession;
  readonly subject: string;
  readonly correlationId: string;
}

/**
 * Thrown for a load that was refused: the read API renders it as its ordinary
 * `ApiError` body plus the failures (`catalogueReloadRefusalSchema`).
 */
export class CatalogueReloadRefused extends ApiRefusal {
  constructor(readonly reload: CatalogueReloadRefusal['reload']) {
    const first = reload.failures[0];
    super(
      CATALOGUE_LOAD_REFUSED,
      `The definitions did not load cleanly, so the catalogue was not reloaded (${reload.failures.length} failure${reload.failures.length === 1 ? '' : 's'}${first === undefined ? '' : `; first: [${first.ruleId}] ${first.file}: ${first.message}`}).`,
      `Nothing changed: catalogue generation ${reload.generation} is still serving. ${first?.fix ?? 'Run forge validate on the definitions clone.'}`,
    );
  }
}

type DeniedRule =
  'catalogue.consumer_not_authorized' | 'catalogue.not_super_admin' | 'catalogue.load_refused';

/**
 * Reload as `actor`. Resolves with the reload that happened, or throws an
 * `ApiRefusal`. Either way exactly one `catalogue` audit row was committed.
 */
export async function reloadCatalogue(
  deps: CatalogueReloadDeps,
  actor: ReloadActor,
): Promise<CatalogueReloadResponse> {
  // 1. The consumer half.
  const consumer = actor.session.scopeSession.consumer;
  if (!consumer.authorizations.writeAllowed || !consumer.attestation.humanInTheLoop) {
    await appendRow(
      deps,
      refusedRow(deps, actor, 'catalogue.consumer_not_authorized', 'CONSUMER_NOT_AUTHORIZED', {
        message: 'The consumer may not reload the catalogue.',
      }),
    );
    throw new ApiRefusal(
      'CONSUMER_NOT_AUTHORIZED',
      `Consumer ${consumer.consumerId} may not reload the catalogue: that needs a registration that allows writes and attests a human in the loop.`,
      'Reload from the MCPForge portal, whose registration allows writes with a human in the loop. A consumer registration is widened only through a reviewed change proposal.',
    );
  }

  // 2. The human half.
  // W0-P23: `<providerId>:<group>`, held only under the actor's own provider.
  if (!holdsQualifiedGroup(actor.session.principal, deps.superAdminGroups)) {
    await appendRow(
      deps,
      refusedRow(deps, actor, 'catalogue.not_super_admin', 'TOOL_NOT_IN_SCOPE', {
        message: 'Only a super admin may reload the catalogue.',
      }),
    );
    throw new ApiRefusal(
      'TOOL_NOT_IN_SCOPE',
      'Reloading the gateway catalogue is limited to super admins, and none of your groups is one.',
      'Ask a super admin (a member of a superAdmins group in the git mapping) to reload the catalogue; the merged change stays merged and is picked up then.',
    );
  }

  // 3. Build, check, record, and only then swap (assembly/reload.ts).
  const { outcome, recorded } = await deps.reloader.reload((o) =>
    appendRow(deps, o.ok ? reloadedRow(deps, actor, o) : loadRefusedRow(deps, actor, o)),
  );

  if (!outcome.ok) {
    throw new CatalogueReloadRefused({
      generation: outcome.generation,
      failures: outcome.failures.map((f) => ({
        ruleId: f.ruleId,
        file: f.file,
        message: f.message,
        fix: f.fix,
      })),
      auditCallId: recorded.id,
    });
  }
  return {
    asOf: deps.now().toISOString(),
    generation: outcome.generation,
    previousGeneration: outcome.previousGeneration,
    catalogueDigest: deps.digest(outcome.catalogue),
    toolCount: outcome.toolCount,
    added: [...outcome.added],
    removed: [...outcome.removed],
    changed: [...outcome.changed],
    auditCallId: recorded.id,
    next: outcome.next,
  };
}

// --- audit rows ------------------------------------------------------------------

function appendRow(deps: CatalogueReloadDeps, row: AppendAuditCallInput): Promise<AuditCallRecord> {
  return deps.store.transaction(() => deps.store.audit.append(row));
}

function reloadedRow(
  deps: CatalogueReloadDeps,
  actor: ReloadActor,
  outcome: Extract<ReloadOutcome, { ok: true }>,
): AppendAuditCallInput {
  const digest = deps.digest(outcome.catalogue);
  return {
    ...baseRow(deps, actor, {
      action: 'reload',
      fromGeneration: outcome.previousGeneration,
      toGeneration: outcome.generation,
      added: [...outcome.added],
      removed: [...outcome.removed],
      changed: [...outcome.changed],
    }),
    outcome: 'ok',
    // Indexed, so "which reload served this digest" is one lookup.
    resultKeys: [
      { keyName: 'catalogueGeneration', keyValue: String(outcome.generation) },
      { keyName: 'catalogueDigest', keyValue: digest },
    ],
  };
}

function loadRefusedRow(
  deps: CatalogueReloadDeps,
  actor: ReloadActor,
  outcome: Extract<ReloadOutcome, { ok: false }>,
): AppendAuditCallInput {
  return {
    ...baseRow(deps, actor, {
      action: 'reload',
      stillServing: outcome.generation,
      failures: outcome.failures.map((f) => ({ ruleId: f.ruleId, file: f.file })),
    }),
    outcome: 'business_error',
    errorCode: CATALOGUE_LOAD_REFUSED,
    errorMessageAgent: `The definitions did not load; generation ${outcome.generation} is still serving.`,
    deniedByRule: 'catalogue.load_refused' satisfies DeniedRule,
  };
}

function refusedRow(
  deps: CatalogueReloadDeps,
  actor: ReloadActor,
  rule: DeniedRule,
  errorCode: string,
  detail: { readonly message: string },
): AppendAuditCallInput {
  return {
    ...baseRow(deps, actor, { action: 'reload' }),
    outcome: 'policy_denied',
    errorCode,
    errorMessageAgent: detail.message,
    deniedByRule: rule,
  };
}

/**
 * The columns every `catalogue` row carries: who acted and through which
 * consumer, the same columns `approval-decision.ts` and `user-admin.ts` write.
 */
function baseRow(
  deps: CatalogueReloadDeps,
  actor: ReloadActor,
  args: Readonly<Record<string, unknown>>,
): Omit<AppendAuditCallInput, 'outcome'> {
  const at = deps.now();
  const scope = actor.session.scopeAt(at);
  const session = actor.session.scopeSession;
  const principal = actor.session.principal;
  return {
    ts: at.toISOString(),
    correlationId: actor.correlationId,
    sessionId: actor.session.sessionId,
    callerSubject: principal.subject,
    ...(principal.displayName === undefined ? {} : { callerDisplay: principal.displayName }),
    ...(principal.idp === undefined ? {} : { callerIdp: principal.idp }),
    ...(principal.amr === undefined ? {} : { callerAmr: principal.amr.join(' ') }),
    callerRoles: [...session.heldRoleIds],

    consumerId: session.consumer.consumerId,
    consumerRecordSha: session.consumerSession.recordSha,
    consumerAuthMethod: session.consumerSession.authMethod,
    consumerSessionId: session.consumerSession.consumerSessionId,
    humanInTheLoop: session.consumer.attestation.humanInTheLoop,

    toolId: RELOAD_PSEUDO_TOOL_ID,
    // A reload reaches no target system.
    isWrite: false,

    deploymentId: scope.deployment.deploymentId,
    gatewayVersion: deps.gatewayVersion,

    phase: 'catalogue',
    argsRedacted: { ...args },
  };
}
