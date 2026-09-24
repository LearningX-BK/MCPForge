// MCPForge — W0-F7(a): a completed write reversed via its declared reversal,
// linked in the audit trail. 01 §10.4 criterion 7(a).
//
// Drives the REAL chain, the REAL confirm gate, the REAL write dispatcher and
// a REAL SQLite store — the reversal is itself a write and runs the full
// plan -> confirm -> execute sequence a second time, exactly as W0-F5's own
// suite proved (`core/gateway/reversal/reversal.test.ts`, whose wiring this
// reuses). The only mock is the target system.

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RuntimeStore } from '../../core/gateway/store/repository.js';
import { reverseCall } from '../../core/gateway/reversal/reverse.js';
import { runPolicyChain } from '../../core/gateway/policy/chain.js';
import {
  APPROVER_SUBJECT,
  CANCEL_VIEW,
  CREATE_ARGS,
  CREATE_VIEW,
  REGISTRY,
  TOOLS,
  cleanupStoreDir,
  ctxFor,
  dispatcherFor,
  executorOver,
  mockTarget,
  openStore,
  planConfirmExecute,
  policyCall,
  type WriteRun,
} from './support/store-world.js';
import { withEvidence } from './support/evidence.js';

let store: RuntimeStore;

beforeEach(async () => {
  store = await openStore();
});
afterEach(async () => {
  await store.close();
});
afterAll(() => {
  cleanupStoreDir();
});

describe('W0-F7(a) — a live reversal, linked in the audit trail', () => {
  it('reverses a completed jde.ap.voucher.create via jde.ap.voucher.cancel, both ends linked', async () => {
    await withEvidence(
      'a',
      '(a) A live reversal — a completed write was reversed using its declared reversal, and the reversal appears in the audit trail linked to the original call.',
      'reverses a completed jde.ap.voucher.create via jde.ap.voucher.cancel, both ends linked',
      async () => {
        const target = mockTarget();
        const dispatcher = dispatcherFor(store, target);
        const ctx = ctxFor(store);

        const original = await planConfirmExecute(ctx, dispatcher, TOOLS.voucherCreate, {
          ...CREATE_ARGS,
        });
        // The forward write's own manifest posture: no approval detour, and the
        // reversal contract that makes this test possible at all.
        expect(original.approvalId).toBeNull();

        const reversalRuns: WriteRun[] = [];
        const report = await reverseCall(original.callId, {
          audit: store.audit,
          registry: REGISTRY,
          executor: executorOver(ctx, dispatcher, reversalRuns),
          now: () => new Date('2026-09-04T09:00:00.000Z'),
        });

        expect(report.refusal).toBeNull();
        expect(report.executed?.ok).toBe(true);
        const reversalCallId = report.executed!.ok ? report.executed!.callId : '';
        expect(reversalCallId.length).toBeGreaterThan(0);

        // Both ends of the edge, read back from the store — not from the report's
        // own in-memory copy.
        const forward = await store.audit.reversalLinks(original.callId);
        const backward = await store.audit.reversalLinks(reversalCallId);
        expect(forward?.reversedByCallId).toBe(reversalCallId);
        expect(backward?.reversesCallId).toBe(original.callId);

        const originalRow = await store.audit.get(original.callId);
        const reversalRow = await store.audit.get(reversalCallId);
        expect(originalRow!.reversalClass).toBe('compensating-tool');
        expect(originalRow!.reversalToolId).toBe(TOOLS.voucherCancel);
        expect(reversalRow!.toolId).toBe(TOOLS.voucherCancel);
        expect(reversalRow!.phase).toBe('reverse');
        expect(reversalRow!.reversesCallId).toBe(original.callId);

        // The chain hash still verifies with both rows in it — the reversal did
        // not just get recorded, it got recorded WITHOUT breaking the audit's
        // own tamper-evidence.
        const verified = await store.audit.verifyChain('ltm-dev');
        expect(verified.firstBreak).toBeNull();
        expect(verified.rowsChecked).toBe(2);

        // [W0-F8] The reversing tool's REAL posture was exercised, not a
        // fixture's softer one: `jde.ap.voucher.cancel` declares
        // `humanApprovalRequired: true` (forced by `reversal.class:
        // irreversible`), so the reversal leg stopped for a named approver who
        // was NOT the requester, and only then was a confirm token minted.
        expect(reversalRuns).toHaveLength(1);
        const reversalApprovalId = reversalRuns[0]!.approvalId;
        expect(reversalApprovalId).toBeTruthy();
        const cancelApprovalRow = await store.approvals.get(reversalApprovalId!);
        expect(cancelApprovalRow!.status).toBe('approved');
        expect(cancelApprovalRow!.approverSubject).toBe(APPROVER_SUBJECT);
        expect(cancelApprovalRow!.callerSubject).not.toBe(APPROVER_SUBJECT);
        expect(CANCEL_VIEW.writeSafety!.humanApprovalRequired).toBe(true);
        expect(CANCEL_VIEW.writeSafety!.reversalClass).toBe('irreversible');
        expect(CANCEL_VIEW.writeSafety!.idempotencyScopeHours).toBe(24);

        return {
          originalToolId: TOOLS.voucherCreate,
          reversingToolId: TOOLS.voucherCancel,
          originalCallId: original.callId,
          reversalCallId,
          reversalClassDeclared: originalRow!.reversalClass,
          resultKeysUsed: originalRow!.resultKeys,
          reversalArgs: target.invocations[1]!.args,
          auditChainVerified: verified.firstBreak === null,
          auditRowsChecked: verified.rowsChecked,
          // [W0-F8] The facts this evidence was previously silent about, read
          // from the SHIPPED manifests via codegen's own reader and
          // cross-checked against generated/tools/**/tool.ts at load.
          writeSafetySource:
            'manifests/jde/fin/ap/voucher.{create,cancel}.tool.yaml, read with codegen readTool and asserted equal to generated/tools/<id>/tool.ts',
          guardrailEvaluator:
            'core/gateway/policy/guardrails/gate.ts — the real stage-6f evaluator, not a stub',
          forwardToolReversalClass: CREATE_VIEW.writeSafety!.reversalClass,
          forwardToolHumanApprovalRequired: CREATE_VIEW.writeSafety!.humanApprovalRequired,
          reversingToolReversalClass: CANCEL_VIEW.writeSafety!.reversalClass,
          reversingToolHumanApprovalRequired: CANCEL_VIEW.writeSafety!.humanApprovalRequired,
          reversingToolIdempotencyScopeHours: CANCEL_VIEW.writeSafety!.idempotencyScopeHours,
          reversingToolGuardrails: CANCEL_VIEW.writeSafety!.guardrails,
          reversalApprovalId: reversalApprovalId,
          reversalApproverSubject: cancelApprovalRow!.approverSubject,
          reversalRequesterSubject: cancelApprovalRow!.callerSubject,
        };
      },
    );
  });

  // [W0-F8] The guard on the guard. The criterion-(a) world is only evidence if
  // the guardrail evaluator in it is the REAL one — the previous false pass came
  // from a stub that answered `{breached:false}` for everything, so nothing in
  // the suite would have noticed. This asserts the live evaluator by driving the
  // ceiling `voucher.create`'s own manifest declares: same world, same context,
  // one argument over the line, refused at stage 6f before any plan is minted.
  it('the SAME world refuses a create above the ceiling its manifest declares — the real evaluator is wired', async () => {
    const target = mockTarget();
    const dispatcher = dispatcherFor(store, target);
    const ctx = ctxFor(store);

    const ceiling = CREATE_VIEW.writeSafety!.guardrails.find((g) => g.kind === 'maxNumeric');
    expect(ceiling).toBeDefined();

    const decision = await runPolicyChain(
      policyCall(TOOLS.voucherCreate, { ...CREATE_ARGS, amount: (ceiling!.value as number) + 1 }),
      ctx,
    );

    expect(decision.outcome).toBe('refused');
    if (decision.outcome !== 'refused') throw new Error('unreachable');
    expect(decision.stage).toBe('6f');
    expect(decision.error.code).toBe('POLICY_GUARDRAIL_BREACH');
    expect(decision.stagesRun).not.toContain('6g');
    expect(target.invocations).toHaveLength(0);
    void dispatcher;
  });
});
