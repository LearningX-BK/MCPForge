// MCPForge — W0-E4 DONE CRITERION: "a test enumerates every error
// construction site and fails on an empty next."
//
// THE MECHANISM (documented here, not just claimed): `scanForNextSites`
// (./site-scan.ts) walks every `.ts` file under the given roots and returns
// every `next:` VALUE-construction site it finds — this is a real, growing
// enumeration, not a fixed list of examples. Every LITERAL site (the value is
// a whole string/template literal) is checked for non-empty fixed text
// directly from that enumeration below. Every COMPUTED site (a pass-through
// or a call) is required to be in `ALLOWLISTED_COMPUTED_SITES`, each entry
// carrying a `dynamicCheck` that drives the REAL code path and inspects the
// REAL resulting value (one entry resolves to a same-file literal this same
// scan already verified, rather than re-deriving it). A computed site the
// scan finds that matches no rule fails "every computed site the scan finds
// matches an allowlisted rule" below — which is what keeps the enumeration
// honest as the codebase grows: a twelfth stage or predicate added later is
// picked up on the next run, not silently trusted.
//
// NON-VACUOUSNESS: "would this actually catch a violation?" is answered
// directly, not by inspection — see "the parser itself flags an empty next"
// below, which feeds `extractNextSites` a deliberately-broken fixture STRING
// (never a file on disk) and asserts it is flagged.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractNextSites, scanForNextSites, type NextSite } from './site-scan.js';
import { callThroughToolsCall, type WriteGate } from '../policy/index.js';
import {
  TOOLS,
  call,
  consumer,
  context,
  defaultRoles,
  entry,
  functionGrant,
  role,
} from '../policy/policy.fixtures.js';
import {
  confirmWriteGate,
  generateConfirmSigningKey,
  singleKeyKeyring,
  type WriteSafetyView,
} from '../policy/confirm/index.js';
import { resolveScope, scopeRefusalError } from '../scope/index.js';
import {
  context as scopeContext,
  CATALOGUE,
  TOOLS as SCOPE_TOOLS,
} from '../scope/scope.fixtures.js';
import { killSwitchRefusalError } from '../flags/checks.js';
import { constructReversingCall } from '../reversal/construct.js';
import {
  approvalGate,
  type ApprovalQueue,
  type RaiseApprovalInput,
} from '../policy/approval/index.js';
import type { ApprovalRequest } from '../store/runtime/types.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCAN_ROOTS = [
  join(REPO_ROOT, 'core', 'gateway'),
  join(REPO_ROOT, 'core', 'codegen', 'src', 'templates'),
  join(REPO_ROOT, 'adapters'),
  join(REPO_ROOT, 'generated'),
];

const DEAD_END_PHRASES = [
  'try again',
  'please retry',
  'retry later',
  'contact support',
  'an error occurred',
  'unknown error',
];

function assertNotDeadEnd(text: string, where: string): void {
  expect(text.trim().length, `${where}: empty next`).toBeGreaterThan(0);
  const lowered = text.toLowerCase();
  for (const phrase of DEAD_END_PHRASES) {
    expect(lowered, `${where}: dead-end phrase "${phrase}"`).not.toContain(phrase);
  }
}

// --- the parser itself flags an empty next (non-vacuousness proof) ---------

describe('extractNextSites — proves the check is not vacuous', () => {
  it('flags a deliberately-broken empty-string next', () => {
    const sites = extractNextSites('  next: "",\n', 'fixture.ts');
    expect(sites).toHaveLength(1);
    expect(sites[0]!.kind).toBe('literal');
    expect(sites[0]!.literalFixedText).toBe('');
  });

  it('flags a deliberately-broken whitespace-only template literal next', () => {
    const sites = extractNextSites('  next: `   `,\n', 'fixture.ts');
    expect(sites[0]!.literalFixedText!.trim().length).toBe(0);
  });

  it('flags a next whose only content is an interpolation slot as empty fixed text', () => {
    const sites = extractNextSites('  next: `${onlyThis}`,\n', 'fixture.ts');
    expect(sites[0]!.kind).toBe('literal');
    expect(sites[0]!.literalFixedText).toBe('');
  });

  it('does not flag a real, non-empty template literal', () => {
    const sites = extractNextSites(
      '  next: `Call forge.find for ${entry.toolId}.`,\n',
      'fixture.ts',
    );
    expect(sites[0]!.literalFixedText!.trim().length).toBeGreaterThan(0);
  });

  it('never mistakes a `next: string;` type annotation for a value site', () => {
    const sites = extractNextSites('  readonly next: string;\n  next: string;\n', 'fixture.ts');
    expect(sites).toHaveLength(0);
  });

  it('classifies a pass-through as computed, not literal', () => {
    const sites = extractNextSites('  next: outcome.next,\n', 'fixture.ts');
    expect(sites[0]!.kind).toBe('computed');
  });

  it("joins a multi-line `??` value onto one site (stage 6f's exact shape)", () => {
    const sites = extractNextSites(
      '      next:\n        verdict.next ??\n        `a real fallback`,\n',
      'fixture.ts',
    );
    expect(sites).toHaveLength(1);
    expect(sites[0]!.raw).toContain('verdict.next');
    expect(sites[0]!.raw).toContain('a real fallback');
  });
});

// --- the real, whole-tree enumeration ---------------------------------------

const SITES: readonly NextSite[] = scanForNextSites({ roots: SCAN_ROOTS });

describe('the repo-wide enumeration (core/gateway, codegen templates, adapters, generated)', () => {
  it('finds a non-trivial number of real construction sites (not vacuously empty)', () => {
    // 40 literal + 8 computed at the time this test was written; a hard floor
    // well below that proves the walk is actually finding files, not silently
    // returning nothing because a root path is wrong.
    expect(SITES.length).toBeGreaterThanOrEqual(20);
  });

  it.each(
    SITES.filter((s) => s.kind === 'literal').map((s) => [`${s.file}:${s.line}`, s] as const),
  )('LITERAL %s carries non-empty, non-dead-end fixed text', (label, site) => {
    assertNotDeadEnd(site.literalFixedText ?? '', label);
  });
});

// --- W0-F6 helpers: a real approval gate needs a queue and a keyring --------
//
// The queue port is W0-C3's, implemented here in memory for ONE reason: this
// suite must not open a SQLite file per `next` site. The gate under test is the
// real one, and its persistence is proved against real SQLite in
// ../policy/approval/approval.test.ts.

function enumKeyring() {
  return singleKeyKeyring(generateConfirmSigningKey('kid-enum-approval'));
}

function enumApprovalQueue(): ApprovalQueue {
  const rows = new Map<string, ApprovalRequest>();
  let seq = 0;
  return {
    create(input) {
      seq += 1;
      const row: ApprovalRequest = {
        id: `apr_enum_${seq}`,
        planHash: input.planHash,
        argsCanonicalHash: input.argsCanonicalHash,
        planSummary: input.planSummary ?? null,
        callerSubject: input.callerSubject,
        consumerId: input.consumerId ?? null,
        toolId: input.toolId,
        toolVersion: input.toolVersion ?? null,
        status: 'pending',
        approverSubject: null,
        decisionReason: null,
        decidedAt: null,
        createdAt: input.now ?? new Date().toISOString(),
        expiresAt: input.expiresAt,
      };
      rows.set(row.id, row);
      return Promise.resolve(row);
    },
    get: (id) => Promise.resolve(rows.get(id)),
    listPending: () =>
      Promise.resolve([...rows.values()].filter((row) => row.status === 'pending')),
    decide(input) {
      const row = rows.get(input.id);
      if (row === undefined) throw new Error(`no approval ${input.id}`);
      const decided: ApprovalRequest = {
        ...row,
        status: input.status,
        approverSubject: input.approverSubject,
        decisionReason: input.reason ?? null,
        decidedAt: input.now ?? new Date().toISOString(),
      };
      rows.set(decided.id, decided);
      return Promise.resolve(decided);
    },
  };
}

function enumRaiseInput(): RaiseApprovalInput {
  return {
    toolId: TOOLS.voucherCreate,
    toolVersion: '1.0.0',
    callerSubject: 'u-0001',
    argsCanonicalHash: 'a'.repeat(64),
    planHash: 'b'.repeat(64),
    planSummary: 'Create an AP voucher for 100. This creates an OPEN PAYABLE in JD Edwards.',
    tokenTtlSeconds: 300,
  };
}

// --- every COMPUTED site is either same-file-literal-backed or dynamically verified ---

interface ComputedSiteRule {
  /** Matches against `${file basename}:${raw}` — deliberately loose on line number,
   * which shifts with every unrelated edit; tight on file + expression shape. */
  readonly match: (site: NextSite) => boolean;
  readonly description: string;
  /** Drives the REAL code path and returns the actual `.next` the caller would see. */
  readonly dynamicCheck: () => Promise<string> | string;
}

function basename(file: string): string {
  return file.replace(/\\/g, '/').split('/').slice(-1)[0]!;
}

const ALLOWLISTED_COMPUTED_SITES: readonly ComputedSiteRule[] = [
  {
    match: (s) => basename(s.file) === 'store.ts' && s.raw === 'SIGN_IN_REFUSED.next',
    description:
      'identity/local/store.ts refuseSignIn() forwards the module-level SIGN_IN_REFUSED constant, which is itself a LITERAL site this same scan already checked above (same-file backing).',
    dynamicCheck: () => {
      const literalSite = SITES.find(
        (s) =>
          basename(s.file) === 'store.ts' &&
          s.kind === 'literal' &&
          (s.literalFixedText ?? '').includes('Re-enter the username and password'),
      );
      if (literalSite === undefined) {
        throw new Error(
          'SIGN_IN_REFUSED.next no longer resolves to a scanned same-file literal — dynamic re-check needed',
        );
      }
      return literalSite.literalFixedText!;
    },
  },
  {
    match: (s) => basename(s.file) === 'chain.ts' && s.raw === 'outcome.next',
    description:
      "chain.ts forwards a stage's own StageOutcome.next into the ForgeError it constructs; driven end to end through the real ten-stage chain below (6a unknown-tool path).",
    dynamicCheck: async () => {
      const d = await callThroughToolsCall(call('no.such.tool.exists'), context());
      if (d.outcome !== 'refused') throw new Error('expected a refusal');
      return d.error.next;
    },
  },
  {
    match: (s) => basename(s.file) === 'stages.ts' && s.raw === 'refusal.next',
    description:
      "stages.ts's refusalOutcome() forwards a W0-E2 ScopeRefusal.next; the same pass-through resolve.ts's scopeRefusalError() also does, checked below by driving the real predicate set.",
    dynamicCheck: () => {
      const resolution = resolveScope(CATALOGUE, scopeContext());
      // journalCreate is IN the catalogue but not granted by any held role in
      // the default fixture context — this hits the refusal-map branch, i.e.
      // the actual `next: refusal.next` pass-through, not the unknown-tool
      // literal branch.
      const refusal = scopeRefusalError(SCOPE_TOOLS.journalCreate, resolution, 'req_test_enum');
      if (refusal === null) throw new Error('expected a refusal');
      return refusal.next;
    },
  },
  {
    match: (s) => basename(s.file) === 'stages.ts' && s.raw === 'error.next',
    description:
      "stage6a's unknown-tool branch forwards scopeRefusalError()'s ForgeError.next; driven directly, and through the chain via a tool id in no catalogue.",
    dynamicCheck: async () => {
      const d = await callThroughToolsCall(call('no.such.tool.exists'), context());
      if (d.outcome !== 'refused') throw new Error('expected a refusal');
      return d.error.next;
    },
  },
  {
    match: (s) => basename(s.file) === 'stages.ts' && s.raw === 'verdict.next',
    description:
      "stage6e′ forwards authorizeBinding()'s BindingAuthorization.next on ELEVATED_GRANT_REQUIRED.",
    dynamicCheck: async () => {
      const d = await callThroughToolsCall(call(TOOLS.voucherCreate), context());
      if (d.outcome !== 'refused') throw new Error('expected a refusal');
      return d.error.next;
    },
  },
  {
    match: (s) => basename(s.file) === 'authorize.ts' && s.raw === 'hitl.next',
    description:
      "W0-N3: authorizeBinding()'s CONSUMER_NOT_AUTHORIZED refusal forwards elevatedWriteHumanInTheLoop()'s own next — 02 §11.4's \"or the write is refused outright\" for a consumer attesting humanInTheLoop: false. Driven here through the real chain with a real granted role, so the refusal is the attestation and nothing else.",
    dynamicCheck: async () => {
      const roles = new Map(defaultRoles());
      roles.set('p2p', role({ roleId: 'p2p', bindingGrants: [functionGrant()] }));
      const d = await callThroughToolsCall(
        call(TOOLS.voucherCreate, { amount: 100 }),
        context({ roles, consumer: consumer({ attestation: { humanInTheLoop: false } }) }),
      );
      if (d.outcome !== 'refused') throw new Error('expected a refusal');
      return d.error.next;
    },
  },
  {
    match: (s) => basename(s.file) === 'stages.ts' && s.raw.startsWith('verdict.next ?? `'),
    description:
      'stage6f falls back to a real, non-empty template literal (already checked above as its own LITERAL site) whenever the injected guardrail verdict omits `next`.',
    dynamicCheck: async () => {
      const d = await callThroughToolsCall(
        call(TOOLS.voucherSearch),
        context({
          runtime: {
            guardrails: {
              evaluate: () => ({ breached: true, message: 'company 00200 is not allowed' }),
            },
          },
        }),
      );
      if (d.outcome !== 'refused') throw new Error('expected a refusal');
      return d.error.next;
    },
  },
  {
    match: (s) =>
      basename(s.file) === 'stages.ts' && s.raw.startsWith('verdict.next ?? defaultWriteNext'),
    description:
      'stage6g falls back to defaultWriteNext(code, toolId) — a pure function whose every branch is a non-empty template literal — whenever the injected write-gate verdict omits `next`.',
    dynamicCheck: async () => {
      const writeGate: WriteGate = {
        evaluate: () => ({ kind: 'refuse', code: 'PLAN_REQUIRED', message: 'no confirm token' }),
      };
      const d = await callThroughToolsCall(
        call(TOOLS.voucherCancel),
        context({ runtime: { writeGate } }),
      );
      if (d.outcome !== 'refused') throw new Error('expected a refusal');
      return d.error.next;
    },
  },
  {
    match: (s) => basename(s.file) === 'gate.ts' && s.raw.startsWith('nextForMismatch('),
    description:
      "W0-F2: confirm/gate.ts's PLAN_ARGUMENT_MISMATCH refusal builds its next from nextForMismatch(toolId, changedArguments), which NAMES the arguments that changed since the plan (02 §3.1.1). Driven here through the real gate: plan a 100.00 amount, present 100000.00.",
    dynamicCheck: async () => {
      const view: WriteSafetyView = {
        toolId: TOOLS.voucherCreate,
        toolVersion: '1.0.0',
        planTemplate: 'Create an AP voucher for {amount}. This creates an OPEN PAYABLE.',
        tokenTtlSeconds: 300,
        humanApprovalRequired: false,
        reversal: { class: 'compensating-tool', tool: TOOLS.voucherCancel, windowHours: 720 },
        dryRunStrategy: 'validate-pair',
        entity: 'voucher',
        verb: 'create',
      };
      const gate = confirmWriteGate({
        writeSafetyFor: (id) => (id === view.toolId ? view : undefined),
        dryRun: { plan: () => ({}) },
        keyring: singleKeyKeyring(generateConfirmSigningKey('kid-enum')),
      });
      const ctx = context();
      const voucher = entry(TOOLS.voucherCreate);
      const planned = await gate.evaluate(
        { ...call(TOOLS.voucherCreate, { amount: 100.0 }), entryPoint: 'tools/call' },
        voucher,
        ctx,
      );
      if (planned.kind !== 'respond') throw new Error('expected a plan response');
      const refused = await gate.evaluate(
        {
          ...call(TOOLS.voucherCreate, {
            amount: 100000.0,
            confirm: String(planned.response['confirmToken']),
          }),
          entryPoint: 'tools/call',
        },
        voucher,
        ctx,
      );
      if (refused.kind !== 'refuse') throw new Error('expected a mismatch refusal');
      if (!(refused.next ?? '').includes('amount')) {
        throw new Error('the mismatch next no longer names the changed argument');
      }
      return refused.next ?? '';
    },
  },
  {
    match: (s) =>
      basename(s.file) === 'gate.ts' &&
      s.file.includes('approval') &&
      s.raw.startsWith('awaitingNext('),
    description:
      "W0-F6: approval/gate.ts's `awaiting_human_approval` next is built by awaitingNext(toolId, approvalId, approvalUrl) — it must NAME the human action, the approval link and the tool that reports the decision (02 §3.1.1). Driven here through the real approval gate over the real repository port.",
    dynamicCheck: async () => {
      const gate = approvalGate({ queue: enumApprovalQueue(), keyring: enumKeyring() });
      const raised = await gate.raise(enumRaiseInput());
      const polled = await gate.status({ approvalId: raised.approvalId, subject: 'u-0001' });
      if (polled.kind !== 'pending') throw new Error('expected a pending poll');
      if (polled.next !== raised.next) {
        throw new Error('raise and status no longer agree about the awaiting next');
      }
      if (!raised.next.includes(raised.approvalId)) {
        throw new Error('the awaiting next no longer names the approval id');
      }
      return raised.next;
    },
  },
  {
    match: (s) =>
      basename(s.file) === 'gate.ts' &&
      s.file.includes('approval') &&
      s.raw.startsWith('mine ? approvedNext('),
    description:
      "W0-F6: approval/gate.ts's approved status poll answers the REQUESTER with approvedNext(toolId) (call again with confirm=) and everyone else with a sentence naming the requester — 03 §7.4's 'the approver does not execute; the requester does'. Both branches are driven here; the requester's is returned.",
    dynamicCheck: async () => {
      const gate = approvalGate({ queue: enumApprovalQueue(), keyring: enumKeyring() });
      const raised = await gate.raise(enumRaiseInput());
      const decided = await gate.decide({
        approvalId: raised.approvalId,
        approverSubject: 'u-9002',
        decision: 'approved',
      });
      if (decided.kind !== 'approved') throw new Error('expected an approval');
      const theirs = await gate.status({ approvalId: raised.approvalId, subject: 'u-9002' });
      if (theirs.kind !== 'approved' || theirs.confirmToken !== undefined) {
        throw new Error("the approver was handed the requester's token");
      }
      assertNotDeadEnd(theirs.next, 'approval status, non-requester branch');
      const mine = await gate.status({ approvalId: raised.approvalId, subject: 'u-0001' });
      if (mine.kind !== 'approved' || mine.confirmToken === undefined) {
        throw new Error('the requester was not handed their token');
      }
      return mine.next;
    },
  },
  {
    match: (s) =>
      basename(s.file) === 'gate.ts' && s.file.includes('confirm') && s.raw === 'raised.next',
    description:
      "W0-F6: confirm/gate.ts's awaiting_human_approval response forwards the approval gate's own `next` (the rule above proves that value). Driven here through the REAL stage-6g gate with a real approval gate behind it, which is also where 'no confirmToken is minted at plan time' is visible.",
    dynamicCheck: async () => {
      const view: WriteSafetyView = {
        toolId: TOOLS.voucherCreate,
        toolVersion: '1.0.0',
        planTemplate: 'Create an AP voucher for {amount}. This creates an OPEN PAYABLE.',
        tokenTtlSeconds: 300,
        humanApprovalRequired: true,
        reversal: { class: 'compensating-tool', tool: TOOLS.voucherCancel, windowHours: 720 },
        dryRunStrategy: 'validate-pair',
        entity: 'voucher',
        verb: 'create',
      };
      const gate = confirmWriteGate({
        writeSafetyFor: (id) => (id === view.toolId ? view : undefined),
        dryRun: { plan: () => ({}) },
        keyring: enumKeyring(),
        approval: approvalGate({ queue: enumApprovalQueue(), keyring: enumKeyring() }),
      });
      const planned = await gate.evaluate(
        { ...call(TOOLS.voucherCreate, { amount: 100.0 }), entryPoint: 'tools/call' },
        entry(TOOLS.voucherCreate),
        context(),
      );
      if (planned.kind !== 'respond') throw new Error('expected an awaiting-approval response');
      if (planned.response['confirmToken'] !== undefined) {
        throw new Error('a confirm token was minted before a human approved');
      }
      return String(planned.response['next']);
    },
  },
  {
    match: (s) => basename(s.file) === 'resolve.ts' && s.raw === 'refusal.next',
    description:
      "scope/resolve.ts's scopeRefusalError() forwards a ScopePredicate's own refusal.next; driven directly against the real predicate set for a tool no predicate admits.",
    dynamicCheck: () => {
      const resolution = resolveScope(CATALOGUE, scopeContext());
      const refusal = scopeRefusalError(SCOPE_TOOLS.journalCreate, resolution, 'req_test_enum');
      if (refusal === null) throw new Error('expected a refusal');
      return refusal.next;
    },
  },
  {
    match: (s) => basename(s.file) === 'checks.ts' && s.raw === 'outcome.next',
    description:
      "W0-E5's killSwitchRefusalError() forwards notKillSwitchedPredicate's own refusal.next; driven directly against a real tool-scope kill switch.",
    dynamicCheck: () => {
      const entry = CATALOGUE.find((e) => e.toolId === SCOPE_TOOLS.journalCreate);
      if (entry === undefined) throw new Error('fixture catalogue entry not found');
      const ctx = scopeContext({
        flags: [{ scope: 'tool', target: entry.toolId, reason: 'binding regression', until: null }],
      });
      const error = killSwitchRefusalError(entry, ctx, 'req_test_enum');
      if (error === null) throw new Error('expected a refusal');
      return error.next;
    },
  },
  {
    match: (s) => basename(s.file) === 'construct.ts' && s.raw === 'nextAction',
    description:
      'W0-F5: reversal/construct.ts funnels all nine refusal reasons through one refuse(reason, message, next) helper, so the `next` reaches it as a parameter. Driven here through the real constructor for the reason that matters most — `irreversible`, where 03 §7.5 requires the REASON in place of a tooltip and there is no tool-shaped way forward at all.',
    dynamicCheck: () => {
      const result = constructReversingCall({
        record: {
          id: 'call-enum',
          toolId: 'jde.ap.payment.release',
          isWrite: true,
          phase: 'execute',
          outcome: 'ok',
          ts: '2026-09-03T12:00:00.000Z',
          reversalClass: 'irreversible',
          reversalToolId: null,
          resultKeys: [],
          targetSystem: 'JD Edwards',
        } as never,
        contract: { class: 'irreversible' },
        now: new Date('2026-09-03T12:00:00.000Z'),
        alreadyReversedBy: null,
      });
      if (result.ok) throw new Error('expected an irreversible refusal');
      return result.next;
    },
  },
  {
    match: (s) => basename(s.file) === 'errors.ts' && s.file.includes('adapters') && s.line === 44,
    description:
      "adapters/function/src/errors.ts's targetTimeout() branches its next on descriptor.write — driven here through the REAL executor + a real timing-out in-process AIS fake, write branch (a write tool must never be told to retry blind).",
    dynamicCheck: async () => {
      const { createFunctionExecutor } = await import('@mcpforge/adapter-function');
      const { createMockAisServer } = await import('@mcpforge/adapter-function/testing');
      const client = createMockAisServer({ hang: true });
      const executor = createFunctionExecutor({ client });
      const descriptor = {
        toolId: 'jde.ap.voucher.create',
        toolVersion: '1.0.0',
        write: true,
        ref: 'ORCH_AP_VOUCHER_CREATE',
        refVersion: null,
        inputMapping: {},
        execution: { timeoutMs: 5, maxConcurrency: 4, responseBytesMax: 1_000_000 },
      };
      const validate = Object.assign(() => true, { errors: null });
      try {
        await executor.execute(descriptor as never, {
          args: {},
          correlationId: 'req_enum_timeout',
          validate: validate as never,
        });
      } catch (err) {
        return (err as { next: string }).next;
      }
      throw new Error('expected the hung target to time out');
    },
  },
  {
    match: (s) => basename(s.file) === 'errors.ts' && s.file.includes('adapters') && s.line === 70,
    description:
      "adapters/function/src/errors.ts's responseTooLarge() branches its next on descriptor.write — driven here through the REAL executor + a real oversized in-process AIS fake, non-write branch.",
    dynamicCheck: async () => {
      const { createFunctionExecutor } = await import('@mcpforge/adapter-function');
      const { createMockAisServer } = await import('@mcpforge/adapter-function/testing');
      const client = createMockAisServer({ bodyBytes: 1000 });
      const executor = createFunctionExecutor({ client });
      const descriptor = {
        toolId: 'jde.ap.voucher.search',
        toolVersion: '1.0.0',
        write: false,
        ref: 'ORCH_AP_VOUCHER_SEARCH',
        refVersion: null,
        inputMapping: {},
        execution: { timeoutMs: 5000, maxConcurrency: 4, responseBytesMax: 100 },
      };
      const validate = Object.assign(() => true, { errors: null });
      try {
        await executor.execute(descriptor as never, {
          args: {},
          correlationId: 'req_enum_cap',
          validate: validate as never,
        });
      } catch (err) {
        return (err as { next: string }).next;
      }
      throw new Error('expected the oversized response to be capped');
    },
  },
  // --- W0-H3, 02 §3.5's runtime identity echo. Three refusal sites, each
  // branching or interpolating its `next`, each driven through the REAL
  // executor against a real in-process AIS fake that returns (or withholds)
  // an executing user.
  {
    match: (s) => basename(s.file) === 'errors.ts' && s.file.includes('adapters') && s.line === 199,
    description:
      "adapters/function/src/errors.ts's identityEchoMismatch() branches its next on descriptor.write — driven through the REAL executor against a fake that executes as a service account, write branch (never told to retry blind; told to establish what was created).",
    dynamicCheck: () => echoRefusalNext({ executesAs: 'JDE_SVC' }),
  },
  {
    match: (s) => basename(s.file) === 'errors.ts' && s.file.includes('adapters') && s.line === 223,
    description:
      "adapters/function/src/errors.ts's identityEchoMissing() branches its next on descriptor.write — driven through the REAL executor against a fake composed WITHOUT the echo step; an unanswerable identity question is refused, never assumed fine.",
    dynamicCheck: () => echoRefusalNext({}),
  },
  // (identityUnresolvedForEcho()'s `next` is a single template literal, so the
  // scan classifies it as a LITERAL site and checks it above — no rule needed.)
];

/**
 * Drives the real `function` executor's identity-echo step and returns the real
 * refusal's `next`. `principalSubject` is passed through so the no-subject site
 * can be reached; the descriptor is a write tool with `echoOn: write`.
 */
async function echoRefusalNext(
  behaviour: { executesAs?: string },
  principalSubject: string | undefined = 'bikash',
): Promise<string> {
  const { createFunctionExecutor } = await import('@mcpforge/adapter-function');
  const { createMockAisServer } = await import('@mcpforge/adapter-function/testing');
  const client = createMockAisServer(behaviour);
  const executor = createFunctionExecutor({ client });
  const descriptor = {
    toolId: 'jde.ap.voucher.create',
    toolVersion: '1.0.0',
    write: true,
    ref: 'ORCH_AP_VOUCHER_CREATE',
    refVersion: null,
    inputMapping: {},
    execution: { timeoutMs: 5000, maxConcurrency: 4, responseBytesMax: 1_000_000 },
    identity: { echoOn: 'write', probe: 'MCPFORGE_PROBE_WHOAMI' },
  };
  const validate = Object.assign(() => true, { errors: null });
  try {
    await executor.execute(descriptor as never, {
      args: {},
      correlationId: 'req_enum_echo',
      validate: validate as never,
      ...(principalSubject === undefined ? {} : { principalSubject }),
    });
  } catch (err) {
    return (err as { next: string }).next;
  }
  throw new Error('expected the identity echo to refuse');
}

describe('every COMPUTED next-construction site is accounted for', () => {
  const computedSites = SITES.filter((s) => s.kind === 'computed');

  it('the scan actually found the computed sites this allowlist expects (not vacuous)', () => {
    expect(computedSites.length).toBeGreaterThanOrEqual(8);
  });

  it('every computed site the scan finds matches an allowlisted rule', () => {
    const unmatched = computedSites.filter(
      (site) => !ALLOWLISTED_COMPUTED_SITES.some((rule) => rule.match(site)),
    );
    expect(
      unmatched.map((s) => `${s.file}:${s.line} -> ${s.raw}`),
      'a computed `next:` site was added with no allowlist rule and no dynamic proof — classify it in enumeration.test.ts',
    ).toEqual([]);
  });

  it('every allowlisted rule actually matched at least one real site (the allowlist is not stale)', () => {
    for (const rule of ALLOWLISTED_COMPUTED_SITES) {
      const matched = computedSites.some((site) => rule.match(site));
      expect(matched, `no site in the current tree matches: ${rule.description}`).toBe(true);
    }
  });

  it.each(ALLOWLISTED_COMPUTED_SITES.map((r) => [r.description, r] as const))(
    '%s — dynamically resolves to a non-empty, non-dead-end next',
    async (description, rule) => {
      const resolved = await rule.dynamicCheck();
      assertNotDeadEnd(resolved, description);
    },
  );
});
