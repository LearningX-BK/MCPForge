// MCPForge — W0-J16: the default Activity data source.
//
// Same seam as `approvals/fixtures.ts` and `build/fixtures.ts`: no live
// gateway `AuditRepository` query and no wired API client exist in the
// portal yet, so these are injectable functions returning realistic
// fixtures, not a hardcoded render. Swapping them for real
// `AuditRepository.listChain()` / `.get()` / `.verifyChain()` calls behind an
// HTTP or server-action boundary touches no component in this directory.
//
// Fixture coverage, deliberately covering every saved view and every call
// detail field this task's `done:` names:
//   1. a write execute, this week, by the "current" user — "everything this
//      person did this week"
//   2. a plan with no matching execute (abandoned intent) — same tool, never
//      confirmed
//   3. an execute that carries a result key, later reversed — the reverse
//      link renders from BOTH ends
//   4. the reversing call itself (phase: reverse)
//   5. a read call, older than a week — excluded from view 1, present in
//      "everything"
//   6. a policy-denied reject — outcome variety in the table
import type { ActivityCallDetail, ActivityCallSummary, AuditChainVerification } from './types';

export const CURRENT_USER_SUBJECT = 'priya.raman@example.com';
const DEPLOYMENT_ID = 'dep_local_dev';

// A FIXED anchor, not `Date.now()`: this module is evaluated once in the
// server bundle (SSR) and once more in the client bundle (hydration) — two
// separate JS executions a few seconds apart in real wall-clock time — so a
// wall-clock `NOW` produced a genuine hydration mismatch on every `ts` field
// derived from it. A fixture's timestamps only need to look realistic, not
// be actually current, so a fixed moment removes the mismatch outright.
const NOW = new Date('2026-09-15T12:00:00.000Z').getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// `from` defaults to the fixed anchor (page renders stay deterministic) but a
// caller's `now` is honoured. Before W0-P10 the loaders discarded `now`
// (`void now`), so a test passing `Date.now()` compared wall-clock time
// against 15 Sep timestamps and broke once the real clock moved on.
function iso(msAgo: number, from: number = NOW): string {
  return new Date(from - msAgo).toISOString();
}

/** The full detail records. Summaries are derived from these — one source of truth. */
export function loadActivityCallDetails(now: number = NOW): readonly ActivityCallDetail[] {
  return [
    {
      id: 'call_a1f9e0',
      ts: iso(2 * DAY, now),
      correlationId: 'corr_7d2c1a',
      sessionId: 'sess_9f21',
      callerSubject: CURRENT_USER_SUBJECT,
      callerDisplay: 'Priya Raman',
      toolId: 'jde.ap.voucher.create',
      toolVersion: '1.0.0',
      verb: 'create',
      isWrite: true,
      phase: 'execute',
      outcome: 'ok',
      targetEnv: 'prod',
      targetSystem: 'jde',
      targetObject: 'voucher',
      latencyMsTotal: 842,
      resultKeys: [
        { keyName: 'document_number', keyValue: '00123456' },
        { keyName: 'document_type', keyValue: 'PV' },
        { keyName: 'document_company', keyValue: '00100' },
      ],
      reversedByCallId: 'call_rv3391',
      deploymentId: DEPLOYMENT_ID,
      consumerId: 'con_portal_agent',
      humanInTheLoop: true,
      serverId: 'jde-ap',
      bindingType: 'plsql',
      sensitivityClass: 'financial',
      planAsShown:
        'This creates an OPEN PAYABLE of 18,400.00 GBP in JD Edwards, against supplier 4501 — Acme Freight Ltd, company 00100.',
      confirmTokenHash: 'sha256:9c2f4a1e7b6d0c35e4a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60',
      planHash: 'sha256:6f2a9c1e4b7d0a35c8f1e2d3b4a5968712abf034e5d6c7b8a9102938475afcd',
      argsHash: 'sha256:1a2b3c4d5e6f708192a3b4c5d6e7f809102a3b4c5d6e7f8091a2b3c4d5e6f70',
      idempotencyKey: 'idem_04e8c1',
      replayed: false,
      args: [
        { field: 'supplierNumber', redacted: false, value: '4501' },
        { field: 'amount', redacted: false, value: '18400.00' },
        { field: 'companyId', redacted: false, value: '00100' },
        { field: 'remitBankAccount', redacted: true, hash: 'b6f2e19a7c31' },
      ],
      identityCarrying: false,
      targetIdentityObserved: null,
      identityMatch: false,
      compensatingControl: 'wrapper_schema',
      identityProbeRef: 'probe_2026-08-19T03-00Z',
      identityProbedAt: '2026-08-19T03:00:00Z',
      identityBindingType: 'plsql',
      approval: {
        approvalId: 'apr_9f21c0',
        href: '/approvals/apr_9f21c0',
        state: 'approved',
        decidedBy: 'meera.rao@example.com',
      },
      reversalClass: 'compensating-tool',
      reversalToolId: 'jde.ap.voucher.cancel',
      prevHash: 'sha256:0000000000000000000000000000000000000000000000000000000000gen',
      rowHash: 'sha256:aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222',
      chainPosition: 0,
      credentialRefs: [{ secretRef: 'secretRef://binding/ebs-p2p-ap/wrapper-schema', version: '3' }],
    },
    {
      id: 'call_rv3391',
      ts: iso(1 * DAY, now),
      correlationId: 'corr_1b7f9c',
      callerSubject: CURRENT_USER_SUBJECT,
      callerDisplay: 'Priya Raman',
      toolId: 'jde.ap.voucher.cancel',
      toolVersion: '1.0.0',
      verb: 'cancel',
      isWrite: true,
      phase: 'reverse',
      outcome: 'ok',
      targetEnv: 'prod',
      targetSystem: 'jde',
      targetObject: 'voucher',
      latencyMsTotal: 610,
      resultKeys: [{ keyName: 'document_number', keyValue: '00123456' }],
      reversesCallId: 'call_a1f9e0',
      deploymentId: DEPLOYMENT_ID,
      consumerId: 'con_portal_agent',
      humanInTheLoop: true,
      serverId: 'jde-ap',
      bindingType: 'plsql',
      sensitivityClass: 'financial',
      planAsShown: 'This cancels the OPEN PAYABLE 00123456 (PV, company 00100) in JD Edwards.',
      confirmTokenHash: 'sha256:2b3c4d5e6f708192a3b4c5d6e7f809102a3b4c5d6e7f8091a2b3c4d5e6f7081',
      planHash: 'sha256:7081920a3b4c5d6e7f809102a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d',
      argsHash: 'sha256:5e6f708192a3b4c5d6e7f809102a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4',
      replayed: false,
      args: [{ field: 'documentNumber', redacted: false, value: '00123456' }],
      identityCarrying: false,
      identityMatch: false,
      compensatingControl: 'wrapper_schema',
      identityProbeRef: 'probe_2026-08-19T03-00Z',
      identityProbedAt: '2026-08-19T03:00:00Z',
      identityBindingType: 'plsql',
      prevHash: 'sha256:aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222',
      rowHash: 'sha256:bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222cccc3333',
      chainPosition: 1,
      credentialRefs: [{ secretRef: 'secretRef://binding/ebs-p2p-ap/wrapper-schema', version: '3' }],
    },
    {
      // Abandoned intent: phase 'plan', no matching execute exists anywhere
      // in this fixture set for its correlationId.
      id: 'call_pln7a02',
      ts: iso(3 * HOUR, now),
      correlationId: 'corr_pln7a02',
      callerSubject: 'daniel.owusu@example.com',
      callerDisplay: 'Daniel Owusu',
      toolId: 'jde.ap.voucher.create',
      toolVersion: '1.0.0',
      verb: 'create',
      isWrite: true,
      phase: 'plan',
      outcome: 'ok',
      targetEnv: 'prod',
      targetSystem: 'jde',
      targetObject: 'voucher',
      resultKeys: [],
      deploymentId: DEPLOYMENT_ID,
      consumerId: 'con_agent_client',
      humanInTheLoop: true,
      serverId: 'jde-ap',
      bindingType: 'plsql',
      sensitivityClass: 'financial',
      planAsShown:
        'This creates an OPEN PAYABLE of 92,000.00 GBP in JD Edwards, against supplier 4501 — Acme Freight Ltd, company 00100.',
      planHash: 'sha256:c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b',
      argsHash: 'sha256:d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c',
      args: [
        { field: 'supplierNumber', redacted: false, value: '4501' },
        { field: 'amount', redacted: false, value: '92000.00' },
      ],
      prevHash: 'sha256:cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222cccc3333dddd4444',
      rowHash: 'sha256:dddd4444eeee5555ffff6666aaaa1111bbbb2222cccc3333dddd4444eeee5555',
      chainPosition: 2,
      credentialRefs: [],
    },
    {
      // Read call, older than a week — present in "everything", excluded
      // from "this week".
      id: 'call_rd8b41',
      ts: iso(10 * DAY, now),
      correlationId: 'corr_rd8b41',
      callerSubject: CURRENT_USER_SUBJECT,
      callerDisplay: 'Priya Raman',
      toolId: 'jde.ar.invoice.search',
      toolVersion: '1.0.0',
      verb: 'search',
      isWrite: false,
      phase: 'execute',
      outcome: 'ok',
      targetEnv: 'prod',
      targetSystem: 'jde',
      targetObject: 'invoice',
      latencyMsTotal: 220,
      resultKeys: [],
      deploymentId: DEPLOYMENT_ID,
      consumerId: 'con_portal_agent',
      humanInTheLoop: true,
      serverId: 'jde-ar',
      bindingType: 'rest',
      sensitivityClass: 'internal',
      args: [{ field: 'customerNumber', redacted: false, value: '9001' }],
      prevHash: 'sha256:eeee5555ffff6666aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666',
      rowHash: 'sha256:ffff6666aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111',
      chainPosition: 3,
      credentialRefs: [],
    },
    {
      // A write execute, still within its reversal window, not yet reversed
      // — this is the row `ReversalAction` renders as a live, actionable
      // control rather than a "reversed by …" link.
      id: 'call_ex4402',
      ts: iso(1 * HOUR, now),
      correlationId: 'corr_ex4402',
      callerSubject: CURRENT_USER_SUBJECT,
      callerDisplay: 'Priya Raman',
      toolId: 'jde.ap.voucher.create',
      toolVersion: '1.0.0',
      verb: 'create',
      isWrite: true,
      phase: 'execute',
      outcome: 'ok',
      targetEnv: 'prod',
      targetSystem: 'jde',
      targetObject: 'voucher',
      latencyMsTotal: 710,
      resultKeys: [
        { keyName: 'document_number', keyValue: '00129900' },
        { keyName: 'document_type', keyValue: 'PV' },
      ],
      deploymentId: DEPLOYMENT_ID,
      consumerId: 'con_portal_agent',
      humanInTheLoop: true,
      serverId: 'jde-ap',
      bindingType: 'plsql',
      sensitivityClass: 'financial',
      planAsShown:
        'This creates an OPEN PAYABLE of 4,200.00 GBP in JD Edwards, against supplier 4711 — Meridian Supplies, company 00100.',
      confirmTokenHash: 'sha256:44e8c1b6f2e19a7c31d0a35c8f1e2d3b4a5968712abf034e5d6c7b8a9102938',
      planHash: 'sha256:e19a7c31d0a35c8f1e2d3b4a5968712abf034e5d6c7b8a9102938475afcd001',
      argsHash: 'sha256:9a7c31d0a35c8f1e2d3b4a5968712abf034e5d6c7b8a9102938475afcd0011a',
      replayed: false,
      args: [
        { field: 'supplierNumber', redacted: false, value: '4711' },
        { field: 'amount', redacted: false, value: '4200.00' },
      ],
      identityCarrying: false,
      identityMatch: false,
      compensatingControl: 'wrapper_schema',
      identityProbeRef: 'probe_2026-08-19T03-00Z',
      identityProbedAt: '2026-08-19T03:00:00Z',
      identityBindingType: 'plsql',
      approval: { approvalId: 'apr_2b7e14', href: '/approvals/apr_2b7e14', state: 'approved', decidedBy: 'meera.rao@example.com' },
      reversalClass: 'compensating-tool',
      reversalToolId: 'jde.ap.voucher.cancel',
      prevHash: 'sha256:1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222cccc',
      rowHash: 'sha256:2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222cccc3333dddd',
      chainPosition: 5,
      credentialRefs: [{ secretRef: 'secretRef://binding/ebs-p2p-ap/wrapper-schema', version: '3' }],
    },
    {
      // Policy-denied reject, this week, different caller — outcome variety.
      id: 'call_dn5c17',
      ts: iso(5 * HOUR, now),
      correlationId: 'corr_dn5c17',
      callerSubject: 'daniel.owusu@example.com',
      callerDisplay: 'Daniel Owusu',
      toolId: 'jde.ap.voucher.approve',
      toolVersion: '1.0.0',
      verb: 'approve',
      isWrite: true,
      phase: 'reject',
      outcome: 'policy_denied',
      targetEnv: 'prod',
      targetSystem: 'jde',
      targetObject: 'voucher',
      resultKeys: [],
      deploymentId: DEPLOYMENT_ID,
      consumerId: 'con_agent_client',
      humanInTheLoop: true,
      serverId: 'jde-ap',
      bindingType: 'plsql',
      sensitivityClass: 'financial',
      errorCode: 'POLICY_GUARDRAIL_BREACH',
      errorMessageAgent:
        'Separation-of-duties conflict: the same person requested and would approve this voucher.',
      deniedByRule: 'sodConflict',
      args: [{ field: 'documentNumber', redacted: false, value: '00123456' }],
      prevHash: 'sha256:aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222',
      rowHash: 'sha256:1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222cccc',
      chainPosition: 4,
      credentialRefs: [],
    },
  ];
}

function toSummary(detail: ActivityCallDetail): ActivityCallSummary {
  return {
    id: detail.id,
    ts: detail.ts,
    callerSubject: detail.callerSubject,
    callerDisplay: detail.callerDisplay,
    toolId: detail.toolId,
    verb: detail.verb,
    isWrite: detail.isWrite,
    phase: detail.phase,
    outcome: detail.outcome,
    targetEnv: detail.targetEnv,
    latencyMsTotal: detail.latencyMsTotal,
    resultKeys: detail.resultKeys,
    reversedByCallId: detail.reversedByCallId,
    reversesCallId: detail.reversesCallId,
    deploymentId: detail.deploymentId,
  };
}

export function loadActivityCalls(now: number = NOW): readonly ActivityCallSummary[] {
  return loadActivityCallDetails(now).map(toSummary);
}

export function getActivityCall(
  callId: string,
  now: number = NOW,
): ActivityCallDetail | undefined {
  return loadActivityCallDetails(now).find((c) => c.id === callId);
}

/**
 * The `sha256[:12]` marker rendered for a redacted arg — see `types.ts`'s
 * header. Not a hashing function; `hash` is already computed upstream.
 */
export function redactedAnnouncement(hash: string): string {
  return `Redacted value, hash ${hash}`;
}

/**
 * Stand-in for `AuditRepository.verifyChain()` — see the file header seam
 * note. Consistent with `loadActivityCallDetails()`'s own chain: 5 rows,
 * genesis origin, no break.
 */
export function loadIntegrityVerification(now: number = NOW): AuditChainVerification {
  const details = loadActivityCallDetails(now);
  return {
    deploymentId: DEPLOYMENT_ID,
    status: 'intact',
    rowsChecked: details.length,
    origin: {
      kind: 'genesis',
      firstRowId: details[0]!.id,
      firstRowPrevHash: details[0]!.prevHash,
    },
    firstBreak: null,
  };
}
