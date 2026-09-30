// MCPForge — the read-only governance API, `/api/v1/**`. W0-P3a.
//
// W0-P2 §7 decided the surface (Option C); W0-P3 (owner decisions, 27 Sep
// 2026) fixed the eight endpoints, the shared zod contract
// (`@mcpforge/shared/api/v1`) and the row filter. This module serves exactly
// that and nothing more:
//
//  - GET only, with TWO exceptions. Any other method is 405 with a `next`.
//    The first is W0-P25's `POST /api/v1/approvals/{id}/decision` (owner
//    decision, 30 Sep 2026), served by ./approval-decision.ts. The second is
//    W0-P28's local user administration under `/api/v1/admin/users` (owner
//    decision, 30 Sep 2026), served by ./user-admin.ts. Both sit behind the
//    same front door. No other write may be added without a fresh decision
//    (W0-P2 §7 item 1).
//  - No tool discovery and no invocation: nothing here reads a tool's
//    description, schema or card, and nothing calls the policy chain's
//    execute path. Agents reach tools through `/mcp` only.
//  - EVERY request runs the same front door as `/mcp` (non-negotiable 6):
//    `[2a]` consumer authentication through the SAME `ConsumerAuthGate`,
//    then `[2]/[3]` the human through the SAME session assembly's
//    `establish`. Neither alone is enough, and there is no consumer-only or
//    human-only read. `establish` is pure (it writes no row and holds no
//    slot), so running it per request costs a verification, not a session.
//  - What a response contains is the READ AUTHORITY
//    (`scope/resolve.ts`'s `resolveReadAuthority`: Deployed ∩ Granted ∩
//    ConsumerAuthorized) plus the viewer's own rows. It is applied in SQL,
//    so no invisible row is read into this process. A call or approval the
//    viewer may not read is a 404, identical to one that does not exist:
//    whether someone else's row exists is not the viewer's to learn.
//  - Integrity verification and usage are aggregates. Every signed-in
//    viewer sees them, and they carry no row contents.
//  - Every refusal carries a non-empty `next` (non-negotiable 5).

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { loadProbeReport, probeReportPath, type ProbeReport } from '@mcpforge/probe';
import {
  API_V1_PAGE_DEFAULT,
  API_V1_PAGE_MAX,
  API_V1_PREFIX,
  AUDIT_OUTCOMES,
  isSelfApproved,
  USAGE_WINDOWS,
  type ApiError,
  type ApprovalDetailResponse,
  type ApprovalsResponse,
  type AuditVerifyResponse,
  type CallDetail,
  type CallDetailResponse,
  type CallSummary,
  type CallsPage,
  type ConsumerUsageResponse,
  type DeploymentResponse,
  type EnablementResponse,
  type RuntimeApproval,
  type UsageBucket,
  type UsageWindow,
} from '@mcpforge/shared/api/v1';
import type { EstablishedSession, SessionAssembly } from '../../assembly/session.js';
import type { RuntimeCatalogue } from '../../assembly/catalogue.js';
import type { ConsumerRegistry } from '../../consumer/index.js';
import { resolveReadAuthority } from '../../scope/resolve.js';
import type { RuntimeStore } from '../../store/repository.js';
import type { AuditCallRecord, AuditOutcome } from '../../store/audit/types.js';
import type { ApprovalRequest } from '../../store/runtime/types.js';
import type { ConsumerUsageBucket } from '../../store/usage/types.js';
import type { ConsumerAuthGate } from '../../transport/http.js';
import { identityRequestFrom } from '../../transport/session-binding.js';
import type { ApprovalGate } from '../../policy/approval/index.js';
import {
  DECISION_BODY_MAX_BYTES,
  decideApproval,
  decisionPathApprovalId,
} from './approval-decision.js';
import { verifiedPlanBody } from './plan-body.js';
import { ApiRefusal, STATUS_BY_CODE } from './refusal.js';
import {
  ADMIN_BODY_MAX_BYTES,
  adminUsersRoute,
  changeAdminUser,
  createAdminUser,
  listAdminUsers,
  type UserAdminDeps,
} from './user-admin.js';

export interface ReadApiOptions {
  readonly repoRoot: string;
  readonly store: RuntimeStore;
  readonly catalogue: RuntimeCatalogue;
  readonly consumerAuth: ConsumerAuthGate;
  readonly sessions: Pick<SessionAssembly, 'establish' | 'deployment'>;
  readonly consumers: ConsumerRegistry;
  readonly identityProviderKind: string;
  readonly gatewayVersion?: string;
  /** Defaults to `.mcpforge/probe-report.json` when present. */
  readonly loadProbe?: () => ProbeReport | null;
  readonly now?: () => Date;
  /**
   * W0-P25 — the gateway's ONE approval gate, the same instance stage 6g
   * raises through. Absent, the decision path is refused like any other
   * write method: nothing here can decide without the gate.
   */
  readonly approvals?: ApprovalGate;
  /**
   * W0-P28 — local user administration. Absent (no local user store, or no
   * mapping), every `/api/v1/admin/users` path is refused as not served.
   */
  readonly userAdmin?: Omit<UserAdminDeps, 'store' | 'gatewayVersion' | 'now'>;
  /**
   * W0-P32 — the `superAdmins:` groups from the git mapping. A member may
   * decide their own approval request, always flagged self-approved. Absent
   * means nobody may.
   */
  readonly superAdminGroups?: readonly string[];
}

export interface ReadApi {
  /** True for any path under `/api/v1`. The transport routes those here and nowhere else. */
  handles(pathname: string): boolean;
  handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void>;
}

interface Viewer {
  readonly session: EstablishedSession;
  readonly subject: string;
  readonly visibleToolIds: readonly string[];
  readonly visible: ReadonlySet<string>;
  readonly correlationId: string;
}

export function createReadApi(options: ReadApiOptions): ReadApi {
  const now = options.now ?? (() => new Date());
  const entries = options.catalogue.entries;
  const gatewayVersion = options.gatewayVersion ?? packageVersion();
  const catalogueDigest = digestCatalogue(options.repoRoot, options.catalogue);
  const loadProbe =
    options.loadProbe ??
    (() =>
      existsSync(probeReportPath(options.repoRoot)) ? loadProbeReport(options.repoRoot) : null);

  async function authenticate(req: IncomingMessage, correlationId: string): Promise<Viewer> {
    const auth = await options.consumerAuth.authenticate(req.headers, correlationId);
    if (!auth.ok) {
      const e = auth.error.toJSON();
      throw new ApiRefusal(e.code, e.message, e.next);
    }
    const established = await options.sessions.establish({
      auth,
      request: identityRequestFrom(req.headers),
      sessionId: `api-v1-${correlationId}`,
      correlationId,
    });
    if (!established.ok) {
      const e = established.error.toJSON();
      throw new ApiRefusal(e.code, e.message, e.next);
    }
    const session = established.session;
    const visibleToolIds = resolveReadAuthority(entries, session.scopeAt(now())).visible;
    return {
      session,
      subject: session.principal.subject,
      visibleToolIds,
      visible: new Set(visibleToolIds),
      correlationId,
    };
  }

  const mayRead = (viewer: Viewer, toolId: string, callerSubject: string): boolean =>
    viewer.visible.has(toolId) || callerSubject === viewer.subject;

  const notFound = (what: string, id: string): ApiRefusal =>
    new ApiRefusal(
      'NOT_FOUND',
      `No ${what} ${id} that you may read.`,
      `Check the id, or open the list at ${API_V1_PREFIX}/${what === 'call' ? 'calls' : 'approvals'}. Records outside your roles and this consumer's authorizations are not shown; ask an approver or auditor who holds that scope.`,
    );

  // --- handlers ---------------------------------------------------------------

  async function listCalls(viewer: Viewer, url: URL): Promise<CallsPage> {
    const limit = pageLimit(url);
    const outcome = url.searchParams.get('outcome') ?? undefined;
    if (outcome !== undefined && !(AUDIT_OUTCOMES as readonly string[]).includes(outcome)) {
      throw new ApiRefusal(
        'INPUT_INVALID',
        `outcome "${outcome}" is not an audit outcome.`,
        `Use one of: ${AUDIT_OUTCOMES.join(', ')}, or omit it.`,
      );
    }
    const toolId = url.searchParams.get('tool') ?? undefined;
    const consumerId = url.searchParams.get('consumer') ?? undefined;
    const beforeId = url.searchParams.get('cursor') ?? undefined;
    const rows = await options.store.audit.listRecent({
      visibleToolIds: viewer.visibleToolIds,
      ownSubject: viewer.subject,
      limit: limit + 1,
      ...(toolId === undefined ? {} : { toolId }),
      ...(consumerId === undefined ? {} : { consumerId }),
      ...(outcome === undefined ? {} : { outcome: outcome as AuditOutcome }),
      ...(beforeId === undefined ? {} : { beforeId }),
    });
    const page = rows.slice(0, limit);
    return {
      asOf: now().toISOString(),
      items: page.map(toSummary),
      nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async function getCall(viewer: Viewer, callId: string): Promise<CallDetailResponse> {
    const record = await options.store.audit.get(callId);
    if (record === undefined || !mayRead(viewer, record.toolId, record.callerSubject)) {
      throw notFound('call', callId);
    }
    return { asOf: now().toISOString(), call: await toDetail(record) };
  }

  async function verifyAudit(): Promise<AuditVerifyResponse> {
    const deployments = await options.store.audit.listDeployments();
    const chains = [];
    for (const deploymentId of deployments) {
      const v = await options.store.audit.verifyChain(deploymentId);
      chains.push({
        deploymentId: v.deploymentId,
        status: v.status,
        rowsChecked: v.rowsChecked,
        origin:
          v.origin === null
            ? null
            : {
                kind: v.origin.kind,
                firstRowId: v.origin.firstRowId,
                attestationCallId: v.origin.attestation?.callId ?? null,
              },
        firstBreak:
          v.firstBreak === null
            ? null
            : {
                rowId: v.firstBreak.rowId,
                position: v.firstBreak.position,
                reason: v.firstBreak.reason,
                message: v.firstBreak.message,
                next: v.firstBreak.next,
              },
      });
    }
    return { asOf: now().toISOString(), chains };
  }

  async function listApprovals(viewer: Viewer, url: URL): Promise<ApprovalsResponse> {
    const status = url.searchParams.get('status') ?? 'pending';
    if (status !== 'pending' && status !== 'decided') {
      throw new ApiRefusal(
        'INPUT_INVALID',
        `status "${status}" is not an approvals view.`,
        'Use ?status=pending (the queue) or ?status=decided (history).',
      );
    }
    const limit = pageLimit(url);
    let items: ApprovalRequest[];
    if (status === 'pending') {
      // The queue is small by construction (it expires); filter after read,
      // then cap. `listPending` has no authority parameter of its own.
      const pending = await options.store.approvals.listPending();
      items = pending.filter((a) => mayRead(viewer, a.toolId, a.callerSubject)).slice(0, limit);
    } else {
      items = await options.store.approvals.listDecided({
        visibleToolIds: viewer.visibleToolIds,
        ownSubject: viewer.subject,
        limit,
      });
    }
    return { asOf: now().toISOString(), status, items: items.map(toApproval) };
  }

  async function getApproval(viewer: Viewer, id: string): Promise<ApprovalDetailResponse> {
    const approval = await options.store.approvals.get(id);
    if (approval === undefined || !mayRead(viewer, approval.toolId, approval.callerSubject)) {
      throw notFound('approval', id);
    }
    const checked = verifiedPlanBody(approval);
    return {
      asOf: now().toISOString(),
      approval: toApproval(approval),
      planBody: checked.status === 'verified' ? checked.body : null,
      planBodyStatus: checked.status,
    };
  }

  async function consumerUsage(url: URL): Promise<ConsumerUsageResponse> {
    const window = (url.searchParams.get('window') ?? '24h') as UsageWindow;
    if (!USAGE_WINDOWS.includes(window)) {
      throw new ApiRefusal(
        'INPUT_INVALID',
        `window "${String(window)}" is not a usage window.`,
        `Use one of: ${USAGE_WINDOWS.join(', ')}.`,
      );
    }
    const granularity: 'hour' | 'day' = window === '24h' ? 'hour' : 'day';
    const count = window === '24h' ? 24 : 7;
    const stepMs = window === '24h' ? 3_600_000 : 86_400_000;
    const at = now();
    const consumers = [];
    for (const loaded of options.consumers.consumers) {
      const id = loaded.record.id;
      const buckets: UsageBucket[] = [];
      for (let i = count - 1; i >= 0; i--) {
        const start = options.store.usage.bucketStartFor(
          granularity,
          new Date(at.getTime() - i * stepMs).toISOString(),
        );
        const bucket = await options.store.usage.getBucket(id, granularity, start);
        buckets.push(toBucket(start, bucket));
      }
      const events = await options.store.anomalies.list({ consumerId: id, limit: 50 });
      consumers.push({
        consumerId: id,
        granularity,
        buckets,
        limits: {
          callsPerMinute: loaded.record.limits.callsPerMinute,
          writesPerDay: loaded.record.limits.writesPerDay,
        },
        events: events.map((e) => ({
          id: e.id,
          ts: e.ts,
          detectorId: e.detectorId,
          severity: e.severity,
          window: e.window,
          observed: e.observed,
          threshold: e.threshold,
          state: e.state,
          auditCallIds: [...e.auditCallIds],
        })),
      });
    }
    return { asOf: at.toISOString(), window, consumers };
  }

  function enablement(viewer: Viewer): EnablementResponse {
    const report = loadProbe();
    const byTool = new Map((report?.tools ?? []).map((t) => [t.toolId, t]));
    const tools = entries
      .filter((e) => viewer.visible.has(e.toolId))
      .map((e) => {
        const t = byTool.get(e.toolId);
        const failing = t?.checks.find((c) => c.result === 'fail');
        return {
          toolId: e.toolId,
          status: t?.status ?? null,
          bindingType: e.bindingType,
          failingCheck: failing === undefined ? null : failing.name,
          remediation: t?.remediation ?? null,
          owningTeam: t?.owningTeam ?? null,
        };
      });
    return {
      asOf: now().toISOString(),
      probe:
        report === null
          ? null
          : {
              deploymentId: report.target.deploymentId,
              environmentClass: report.target.environmentClass,
              finishedAt: report.finishedAt,
              toolCount: report.summary.toolCount,
            },
      tools,
    };
  }

  async function deployment(): Promise<DeploymentResponse> {
    const flags = await options.store.runtimeFlags.listActive();
    const d = options.store.descriptor;
    return {
      asOf: now().toISOString(),
      deploymentId: options.sessions.deployment.deployment,
      packageIds: [...options.sessions.deployment.packageIds],
      gatewayVersion,
      catalogueDigest,
      toolCount: options.catalogue.toolIds.length,
      store: { kind: d.kind, label: d.label, ephemeral: d.ephemeral },
      identityProviderKind: options.identityProviderKind,
      killFlags: flags.map((f) => ({
        id: f.id,
        scope: f.scope,
        target: f.target,
        reason: f.reason,
        until: f.until,
        createdBy: f.createdBy,
        createdAt: f.createdAt,
      })),
    };
  }

  async function route(viewer: Viewer, url: URL): Promise<unknown> {
    const parts = url.pathname.slice(API_V1_PREFIX.length).split('/').filter(Boolean);
    const [a, b, c] = parts.map(decodeURIComponent);
    if (a === 'calls' && b === undefined) return listCalls(viewer, url);
    if (a === 'calls' && b !== undefined && c === undefined) return getCall(viewer, b);
    if (a === 'audit' && b === 'verify' && c === undefined) return verifyAudit();
    if (a === 'approvals' && b === undefined) return listApprovals(viewer, url);
    if (a === 'approvals' && b !== undefined && c === undefined) return getApproval(viewer, b);
    if (a === 'consumers' && b === 'usage' && c === undefined) return consumerUsage(url);
    if (a === 'enablement' && b === undefined) return enablement(viewer);
    if (a === 'deployment' && b === undefined) return deployment();
    throw new ApiRefusal(
      'NOT_FOUND',
      `${url.pathname} is not an /api/v1 endpoint.`,
      'The read API serves /calls, /calls/{id}, /audit/verify, /approvals, /approvals/{id}, /consumers/usage, /enablement and /deployment, POST /approvals/{id}/decision, and /admin/users for identity admins. Agents reach tools through /mcp only.',
    );
  }

  return {
    handles(pathname) {
      return pathname === API_V1_PREFIX || pathname.startsWith(`${API_V1_PREFIX}/`);
    },

    async handle(req, res, url) {
      const correlationId = randomUUID();
      try {
        const adminRoute = adminUsersRoute(url.pathname);
        if (adminRoute !== undefined) {
          await handleAdmin(req, res, adminRoute, correlationId);
          return;
        }
        const decisionFor = decisionPathApprovalId(url.pathname);
        const gate = options.approvals;
        if (decisionFor !== undefined && gate !== undefined && req.method === 'POST') {
          // The front door runs before the body is even read.
          const viewer = await authenticate(req, correlationId);
          const body = await readBoundedJson(req, DECISION_BODY_MAX_BYTES);
          const decided = await decideApproval(
            {
              store: options.store,
              catalogue: options.catalogue,
              gate,
              gatewayVersion,
              now,
              superAdminGroups: options.superAdminGroups ?? [],
            },
            viewer,
            decisionFor,
            body,
          );
          send(res, 200, decided);
          return;
        }
        if (req.method !== 'GET') {
          res.setHeader('allow', decisionFor !== undefined && gate !== undefined ? 'POST' : 'GET');
          throw new ApiRefusal(
            'METHOD_NOT_ALLOWED',
            `${req.method ?? 'This method'} is not served: /api/v1 is read-only.`,
            'Runtime writes go through /mcp and the write path (plan, confirm, execute); definitional changes go through a git change proposal. Use GET here. The one exception is deciding a runtime approval: POST /api/v1/approvals/{id}/decision.',
          );
        }
        // The front door runs BEFORE routing, so an unauthenticated caller
        // cannot even learn which paths exist.
        const viewer = await authenticate(req, correlationId);
        const body = await route(viewer, url);
        send(res, 200, body);
      } catch (error) {
        const refusal =
          error instanceof ApiRefusal
            ? error
            : new ApiRefusal(
                'INTERNAL',
                'The read API could not complete this request.',
                `Report correlationId ${correlationId} to the MCPForge operator; nothing was changed by this request.`,
              );
        const payload: ApiError = {
          error: {
            code: refusal.code,
            message: refusal.message,
            next: refusal.next,
            correlationId,
          },
        };
        send(res, STATUS_BY_CODE[refusal.code] ?? 500, payload);
      }
    },
  };

  /**
   * W0-P28 — `/api/v1/admin/users` (GET list, POST create) and
   * `/api/v1/admin/users/{subject}` (POST change). The front door runs first,
   * before the method is checked or the body read, exactly as for the reads.
   */
  async function handleAdmin(
    req: IncomingMessage,
    res: ServerResponse,
    route: NonNullable<ReturnType<typeof adminUsersRoute>>,
    correlationId: string,
  ): Promise<void> {
    const allow = route.kind === 'collection' ? 'GET, POST' : 'POST';
    const allowed = req.method === 'POST' || (route.kind === 'collection' && req.method === 'GET');
    if (!allowed) {
      res.setHeader('allow', allow);
      throw new ApiRefusal(
        'METHOD_NOT_ALLOWED',
        `${req.method ?? 'This method'} is not served on ${API_V1_PREFIX}/admin/users.`,
        `Use ${allow} here: GET /api/v1/admin/users lists accounts, POST it creates one, and POST /api/v1/admin/users/{subject} changes one.`,
      );
    }
    const viewer = await authenticate(req, correlationId);
    const admin = options.userAdmin;
    if (admin === undefined) {
      throw new ApiRefusal(
        'NOT_FOUND',
        'Local user administration is not served by this gateway.',
        'This deployment has no local user store to administer; accounts come from its identity provider. Change group membership there.',
      );
    }
    const deps: UserAdminDeps = { ...admin, store: options.store, gatewayVersion, now };
    const actor = { session: viewer.session, subject: viewer.subject, correlationId };
    if (req.method === 'GET') {
      send(res, 200, await listAdminUsers(deps, actor));
      return;
    }
    const body = await readBoundedJson(req, ADMIN_BODY_MAX_BYTES);
    const changed =
      route.kind === 'collection'
        ? await createAdminUser(deps, actor, body)
        : await changeAdminUser(deps, actor, route.subject, body);
    send(res, 200, changed);
  }

  async function toDetail(r: AuditCallRecord): Promise<CallDetail> {
    const approval =
      r.planHash === null ? undefined : await findApprovalForPlan(r.planHash, r.toolId);
    const replayOf = r.replayed === true ? await findReplayOriginal(r) : null;
    return {
      ...toSummary(r),
      correlationId: r.correlationId,
      sessionId: r.sessionId,
      parentCallId: r.parentCallId,
      callerIdp: r.callerIdp,
      callerAmr: r.callerAmr,
      callerRoles: [...r.callerRoles],
      onBehalfOf: r.onBehalfOf,
      consumerRecordSha: r.consumerRecordSha,
      consumerAuthMethod: r.consumerAuthMethod,
      consumerSessionId: r.consumerSessionId,
      humanInTheLoop: r.humanInTheLoop,
      toolVersion: r.toolVersion,
      manifestSha: r.manifestSha,
      serverId: r.serverId,
      packageId: r.packageId,
      bindingType: r.bindingType,
      archetype: r.archetype,
      entity: r.entity,
      sensitivityClass: r.sensitivityClass,
      targetSystem: r.targetSystem,
      targetObject: r.targetObject,
      gatewayVersion: r.gatewayVersion,
      bundleVersion: r.bundleVersion,
      confirmTokenHash: r.confirmTokenHash,
      planHash: r.planHash,
      argsHash: r.argsHash,
      idempotencyKey: r.idempotencyKey,
      replayed: r.replayed,
      argsRedacted: r.argsRedacted,
      rowCount: r.rowCount,
      bytesOut: r.bytesOut,
      errorCode: r.errorCode,
      errorMessageAgent: r.errorMessageAgent,
      deniedByRule: r.deniedByRule,
      identityCarrying: r.identityCarrying,
      targetIdentityObserved: r.targetIdentityObserved,
      identityMatch: r.identityMatch,
      compensatingControl: r.compensatingControl,
      reversalClass: r.reversalClass,
      reversalToolId: r.reversalToolId,
      latencyMsGateway: r.latencyMsGateway,
      latencyMsTarget: r.latencyMsTarget,
      prevHash: r.prevHash,
      rowHash: r.rowHash,
      credentialRefs: r.credentialRefs.map((c) => ({ secretRef: c.secretRef, version: c.version })),
      replayOf,
      approval:
        approval === undefined
          ? null
          : {
              approvalId: approval.id,
              status: approval.status,
              approverSubject: approval.approverSubject,
              selfApproved: isSelfApproved(approval),
            },
    };
  }

  /**
   * W0-P3d — the execution a replayed call returned the result of. The
   * idempotency record for the replay's key names the original call id (02
   * §3.1.2). The original is the same caller's call to the same tool, so it
   * is inside whatever authority let this replay be read; it is checked
   * anyway, and a missing record, a missing row or a mismatch is `null`.
   */
  async function findReplayOriginal(
    r: AuditCallRecord,
  ): Promise<{ callId: string; ts: string } | null> {
    if (r.idempotencyKey === null) return null;
    const record = await options.store.idempotency.get(r.idempotencyKey);
    if (record?.callId == null || record.callId === r.id) return null;
    const original = await options.store.audit.get(record.callId);
    if (
      original === undefined ||
      original.toolId !== r.toolId ||
      original.callerSubject !== r.callerSubject
    ) {
      return null;
    }
    return { callId: original.id, ts: original.ts };
  }

  /**
   * The approval a write went through is keyed by its plan hash (02 §3.1.1).
   * There is no index from plan hash to approval yet, so this scans the
   * pending queue and the recent decided history for this one tool; a miss
   * is `null`, never a guess.
   */
  async function findApprovalForPlan(
    planHash: string,
    toolId: string,
  ): Promise<ApprovalRequest | undefined> {
    const pending = await options.store.approvals.listPending();
    const hit = pending.find((a) => a.planHash === planHash);
    if (hit !== undefined) return hit;
    const decided = await options.store.approvals.listDecided({
      visibleToolIds: [toolId],
      limit: API_V1_PAGE_MAX,
    });
    return decided.find((a) => a.planHash === planHash);
  }
}

// --- mapping -------------------------------------------------------------------

function toSummary(r: AuditCallRecord): CallSummary {
  return {
    id: r.id,
    ts: r.ts,
    callerSubject: r.callerSubject,
    callerDisplay: r.callerDisplay,
    consumerId: r.consumerId,
    toolId: r.toolId,
    verb: r.verb,
    isWrite: r.isWrite,
    phase: r.phase,
    outcome: r.outcome,
    targetEnv: r.targetEnv,
    latencyMsTotal: r.latencyMsTotal,
    resultKeys: r.resultKeys.map((k) => ({ keyName: k.keyName, keyValue: k.keyValue })),
    reversesCallId: r.reversesCallId,
    reversedByCallId: r.reversedByCallId,
    deploymentId: r.deploymentId,
  };
}

function toApproval(a: ApprovalRequest): RuntimeApproval {
  return {
    id: a.id,
    planHash: a.planHash,
    argsCanonicalHash: a.argsCanonicalHash,
    planSummary: a.planSummary,
    callerSubject: a.callerSubject,
    consumerId: a.consumerId,
    toolId: a.toolId,
    toolVersion: a.toolVersion,
    status: a.status,
    approverSubject: a.approverSubject,
    decisionReason: a.decisionReason,
    decidedAt: a.decidedAt,
    createdAt: a.createdAt,
    expiresAt: a.expiresAt,
    selfApproved: isSelfApproved(a),
  };
}

function toBucket(bucketStart: string, b: ConsumerUsageBucket | undefined): UsageBucket {
  return {
    bucketStart,
    calls: b?.calls ?? 0,
    writes: b?.writes ?? 0,
    plansMinted: b?.plansMinted ?? 0,
    plansConfirmed: b?.plansConfirmed ?? 0,
    plansNeverConfirmed: b?.plansNeverConfirmed ?? 0,
    refusals: (b?.refusals ?? []).map((r) => ({ errorCode: r.errorCode, count: r.count })),
    distinctTools: b?.distinctTools ?? 0,
    distinctSubjects: b?.distinctSubjects ?? 0,
    p95LatencyMs: b?.p95LatencyMs ?? null,
    identityMismatches: b?.identityMismatches ?? 0,
  };
}

function pageLimit(url: URL): number {
  const raw = url.searchParams.get('limit');
  if (raw === null) return API_V1_PAGE_DEFAULT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new ApiRefusal(
      'INPUT_INVALID',
      `limit "${raw}" is not a positive integer.`,
      `Use ?limit= between 1 and ${API_V1_PAGE_MAX}, or omit it for ${API_V1_PAGE_DEFAULT}.`,
    );
  }
  return Math.min(n, API_V1_PAGE_MAX);
}

/**
 * A POST body, parsed. Bounded: a larger body than `maxBytes` is refused
 * unread rather than buffered. Malformed JSON is `INPUT_INVALID`, never a
 * 500. Neither refusal echoes any of the body (it may hold a password).
 */
async function readBoundedJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > maxBytes) {
      throw new ApiRefusal(
        'INPUT_INVALID',
        `The request body is larger than ${maxBytes} bytes.`,
        'Send only the fields the endpoint takes: a decision and a reason of at most 2000 characters, or a user change with a password of at most 1024 characters.',
      );
    }
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim().length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiRefusal(
      'INPUT_INVALID',
      'The request body is not JSON.',
      'Send a JSON object body with content-type application/json, containing only the fields the endpoint takes.',
    );
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res
    .writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    .end(JSON.stringify(body));
}

function packageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** sha256 over each served tool's id and manifest bytes, in tool-id order. */
function digestCatalogue(repoRoot: string, catalogue: RuntimeCatalogue): string {
  const hash = createHash('sha256');
  for (const toolId of catalogue.toolIds) {
    const tool = catalogue.tools.get(toolId);
    hash.update(`${toolId}\n`);
    if (tool !== undefined) hash.update(readFileSync(join(repoRoot, tool.manifestFile)));
  }
  return `sha256:${hash.digest('hex')}`;
}
