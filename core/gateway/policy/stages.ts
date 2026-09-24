// MCPForge — the ten stages, in the documented order. W0-E3.
// 02 §4.2 step [6], as extended by 02 §11.4.2.
//
//   6a   tool in resolved scope?                              -> TOOL_NOT_IN_SCOPE
//   6a′  consumer still active and within its authorizations  -> CONSUMER_NOT_AUTHORIZED / CONSUMER_SUSPENDED
//   6b   tool enabled by probe + kill switch?                 -> TOOL_DISABLED
//   6c   rate limit / concurrency                             -> RATE_LIMITED
//   6d   argument validation (compiled Ajv)                   -> INPUT_INVALID
//   6e   sensitivity vs role ceiling                          -> POLICY_GUARDRAIL_BREACH
//   6e′  binding-type authorization                           -> ELEVATED_GRANT_REQUIRED
//   6f   guardrails incl. SoD                                 -> POLICY_GUARDRAIL_BREACH
//   6g   write? plan-or-confirm state machine                 -> PLAN_REQUIRED / PLAN_ARGUMENT_MISMATCH / APPROVAL_REQUIRED
//   6h   idempotency lookup                                   -> replay
//
// (02 §11.4: 6e′ sits "immediately after 6e and before 6f", and it "must sit
// before 6g so an unauthorized binding type can never mint a plan token".
// ./policy.chain.test.ts asserts both placements from the array itself.)
//
// HOW 6a, 6a′ AND 6b SPLIT ONE RESOLVER — a decision, made explicitly.
//
// W0-E2's `visible(session)` is a six-way intersection, and three of the chain's
// stages re-ask parts of it with three DIFFERENT error codes: 6a says "you are
// not granted this", 6a′ says "your client may not" and 6b says "this tool is
// disabled". 02 §11.3 is explicit that the first two must never share wording.
// So each stage calls `resolveScope` — the full, frozen six, never a subset;
// `applyPredicates` has no production call site and does not acquire one here —
// and acts only on a refusal owned by ITS predicates, deferring the others to
// the stage that owns them. The consequence is the one the documents want: a
// consumer-refused tool is refused at 6a′ with `CONSUMER_NOT_AUTHORIZED`, not at
// 6a with `TOOL_NOT_IN_SCOPE`.
//
// This is a RE-CHECK, not a read of what `tools/list` returned. 02 §4.2: "steps
// 4 and 6a are deliberately two independent checks of the same fact." Nothing in
// this file consults a listed set, and nothing caches a resolution between
// calls.

import {
  resolveScope,
  scopeRefusalError,
  sensitivityWithinCeiling,
  type ScopePredicateName,
  type ScopeRefusal,
} from '../scope/index.js';
import { authorizeBinding } from './binding-auth/index.js';
import { replayedResponse } from './idempotency/replay.js';
import {
  CONTINUE,
  type PolicyCatalogueEntry,
  type PolicyContext,
  type PolicyRoleView,
  type PolicyStage,
  type StageOutcome,
} from './types.js';

/** Which stage owns which of W0-E2's six predicates. Every predicate is owned exactly once. */
const STAGE_PREDICATES: Readonly<Record<'6a' | '6a′' | '6b', readonly ScopePredicateName[]>> = {
  '6a': ['Deployed', 'Granted', 'Activated'],
  '6a′': ['ConsumerAuthorized'],
  '6b': ['ProbeEnabled', 'NotKillSwitched'],
};

/**
 * Re-resolve THIS tool at call time, with the full frozen six, and return the
 * refusal if there is one. A tool that is visible returns `null`.
 */
function callTimeRefusal(entry: PolicyCatalogueEntry, ctx: PolicyContext): ScopeRefusal | null {
  const resolution = resolveScope([entry], ctx.scope);
  if (resolution.visible.includes(entry.toolId)) return null;
  const refusal = resolution.refusals.get(entry.toolId);
  if (refusal === undefined) {
    // Structurally unreachable: a tool is either visible or refused. If it ever
    // happens, throwing is correct — ./chain.ts turns a throw into a denial.
    throw new Error(
      `scope resolution returned neither a visible tool nor a refusal for ${entry.toolId}`,
    );
  }
  return refusal;
}

function refusalOutcome(refusal: ScopeRefusal): StageOutcome {
  return {
    kind: 'refuse',
    code: refusal.code,
    message: refusal.reason,
    condition: refusal.reason,
    next: refusal.next,
  };
}

/** The catalogue entry for a tool id, or `undefined`. */
function entryFor(ctx: PolicyContext, toolId: string): PolicyCatalogueEntry | undefined {
  return ctx.catalogue.find((e) => e.toolId === toolId);
}

/**
 * The roles that both (a) the human holds and (b) whose compiled scope contains
 * this tool. These are the roles whose ceiling and grants may speak for the
 * call; a role the caller does not hold never authorizes anything, and a role
 * that does not grant the tool has said nothing about it.
 */
function grantingRoles(entry: PolicyCatalogueEntry, ctx: PolicyContext): readonly PolicyRoleView[] {
  const out: PolicyRoleView[] = [];
  for (const roleId of ctx.scope.session.heldRoleIds) {
    if (ctx.scope.roleScopes.get(roleId)?.has(entry.toolId) !== true) continue;
    const view = ctx.roles.get(roleId);
    // A role with no policy view contributes NOTHING — it cannot raise a
    // ceiling or supply a grant. An unreadable role never widens.
    if (view === undefined) continue;
    out.push(view);
  }
  return out;
}

// --- 6a --------------------------------------------------------------------

export const stage6a: PolicyStage = {
  id: '6a',
  name: 'tool in resolved scope',
  evaluate(call, ctx, state) {
    const entry = entryFor(ctx, call.toolId);
    if (entry === undefined) {
      // Not in this deployment's catalogue at all. W0-E2's own refusal builder
      // owns the wording, including the deliberate choice of TOOL_NOT_IN_SCOPE
      // over INPUT_INVALID: whether a tool exists elsewhere in the estate is not
      // something a caller outside its scope is entitled to learn.
      const error = scopeRefusalError(call.toolId, resolveScope([], ctx.scope), call.correlationId);
      if (error === null) {
        throw new Error(`unknown tool ${call.toolId} produced no scope refusal`);
      }
      return {
        kind: 'refuse',
        code: error.code,
        message: error.message,
        condition: error.condition,
        next: error.next,
      };
    }

    state.entry = entry;

    const refusal = callTimeRefusal(entry, ctx);
    if (refusal !== null && STAGE_PREDICATES['6a'].includes(refusal.predicate)) {
      return refusalOutcome(refusal);
    }
    return CONTINUE;
  },
};

// --- 6a′ -------------------------------------------------------------------

export const stage6aPrime: PolicyStage = {
  id: '6a′',
  name: 'consumer active and within its declared authorizations',
  evaluate(call, ctx, state) {
    const consumer = ctx.scope.session.consumer;

    // The tool-independent half: is the registration still usable at all? 02
    // §11.2 — an unregistered, suspended, expired or retired consumer holds no
    // session. `[2a]` refuses it at session establishment (W0-N2); this stage
    // re-asks at call time, because a consumer can be suspended mid-session
    // (W0-E8's privilege-escalation case) and a session that outlives its
    // registration must not outlive its authorization.
    if (consumer.effectiveStatus !== 'active') {
      return {
        kind: 'refuse',
        code: 'CONSUMER_SUSPENDED',
        message: `Consumer ${consumer.consumerId} is ${consumer.effectiveStatus}, not active.`,
        condition: `consumer.effectiveStatus = ${consumer.effectiveStatus}`,
        next: `This client's registration is ${consumer.effectiveStatus}. Ask the consumer's steward to reinstate or renew the registration record for ${consumer.consumerId}; no call from it proceeds until then.`,
      };
    }

    const entry = state.entry;
    if (entry === undefined) {
      throw new Error('stage 6a′ ran without a catalogue entry from 6a');
    }

    const refusal = callTimeRefusal(entry, ctx);
    if (refusal !== null && STAGE_PREDICATES['6a′'].includes(refusal.predicate)) {
      return refusalOutcome(refusal);
    }
    return CONTINUE;
  },
};

// --- 6b --------------------------------------------------------------------

export const stage6b: PolicyStage = {
  id: '6b',
  name: 'tool enabled by probe and kill switch',
  evaluate(_call, ctx, state) {
    const entry = state.entry;
    if (entry === undefined) throw new Error('stage 6b ran without a catalogue entry from 6a');

    const refusal = callTimeRefusal(entry, ctx);
    if (refusal !== null && STAGE_PREDICATES['6b'].includes(refusal.predicate)) {
      return refusalOutcome(refusal);
    }
    return CONTINUE;
  },
};

// --- 6c --------------------------------------------------------------------

export const stage6c: PolicyStage = {
  id: '6c',
  name: 'rate limit and concurrency',
  evaluate(call, ctx) {
    const verdict = ctx.runtime.rateLimiter.check(call, ctx);
    if (verdict.allowed) return CONTINUE;
    return {
      kind: 'refuse',
      code: 'RATE_LIMITED',
      message: verdict.reason,
      condition: verdict.reason,
      next: `Wait until the stated window resets before calling ${call.toolId} again; if this workload needs a higher limit, ask the consumer owner to raise the declared limit on ${ctx.scope.session.consumer.consumerId}.`,
    };
  },
};

// --- 6d --------------------------------------------------------------------

export const stage6d: PolicyStage = {
  id: '6d',
  name: 'argument validation',
  evaluate(call, ctx, state) {
    const entry = state.entry;
    if (entry === undefined) throw new Error('stage 6d ran without a catalogue entry from 6a');

    const verdict = ctx.runtime.argumentValidator.validate(call, entry);
    if (verdict.valid) return CONTINUE;
    return {
      kind: 'refuse',
      code: 'INPUT_INVALID',
      message: verdict.errors,
      condition: `Arguments failed the schema of ${call.toolId} at policy-chain stage 6d.`,
      next: `Call forge.describe on ${call.toolId} for the parameter contract and examples, correct the named argument, and call again.`,
    };
  },
};

// --- 6e --------------------------------------------------------------------

export const stage6e: PolicyStage = {
  id: '6e',
  name: 'sensitivity versus role ceiling',
  evaluate(call, ctx, state) {
    const entry = state.entry;
    if (entry === undefined) throw new Error('stage 6e ran without a catalogue entry from 6a');

    const roles = grantingRoles(entry, ctx);
    if (roles.length === 0) {
      // 6a admitted this tool, so some held role granted it; arriving here with
      // no role VIEW means the role's ceiling could not be read. Fail closed:
      // an unreadable ceiling is not a passed ceiling.
      return {
        kind: 'refuse',
        code: 'POLICY_GUARDRAIL_BREACH',
        message: `No readable role ceiling covers ${entry.toolId} for ${ctx.scope.session.principal.subject}.`,
        condition: 'The granting role carries no readable sensitivityCeiling or writeAllowed.',
        next: `Ask your MCPForge operator to check the compiled scope artefact for the role granting ${entry.toolId}; the call is refused because its ceiling could not be read, not because you exceeded it.`,
      };
    }

    const withinCeiling = roles.some((r) =>
      sensitivityWithinCeiling(entry.sensitivity, r.sensitivityCeiling),
    );
    if (!withinCeiling) {
      const ceilings = roles.map((r) => `${r.roleId}=${r.sensitivityCeiling}`).join(', ');
      return {
        kind: 'refuse',
        code: 'POLICY_GUARDRAIL_BREACH',
        message: `${entry.toolId} is sensitivity ${entry.sensitivity}, above the ceiling of every role granting it (${ceilings}).`,
        condition: `tool.sensitivity = ${entry.sensitivity}; role sensitivityCeiling = ${ceilings}`,
        next: `Use a lower-sensitivity tool for this task — call forge.find to locate one — or ask your MCPForge operator for a role whose sensitivityCeiling covers ${entry.sensitivity}. The ceiling is a role grant and cannot be raised per call.`,
      };
    }

    if (entry.write && !roles.some((r) => r.writeAllowed)) {
      return {
        kind: 'refuse',
        code: 'POLICY_GUARDRAIL_BREACH',
        message: `${entry.toolId} is a write tool and no role granting it to ${ctx.scope.session.principal.subject} has writeAllowed: true.`,
        condition: 'tool.write = true; every granting role has writeAllowed = false',
        next: `Use the read-only counterpart of ${call.toolId} (call forge.find for it), or ask your MCPForge operator for the write-enabled role that covers it. A read-only role never executes a write.`,
      };
    }

    return CONTINUE;
  },
};

// --- 6e′ -------------------------------------------------------------------

export const stage6ePrime: PolicyStage = {
  id: '6e′',
  name: 'binding-type authorization',
  evaluate(_call, ctx, state) {
    const entry = state.entry;
    if (entry === undefined) throw new Error('stage 6e′ ran without a catalogue entry from 6a');

    const verdict = authorizeBinding({
      entry,
      grantingRoles: grantingRoles(entry, ctx).map((r) => ({
        roleId: r.roleId,
        grants: r.bindingGrants,
      })),
      consumerId: ctx.scope.session.consumer.consumerId,
      consumerBindingGrants: ctx.consumerBindingGrants,
      humanInTheLoop: ctx.scope.session.consumer.attestation.humanInTheLoop === true,
      now: ctx.scope.now,
    });

    if (verdict.authorized) {
      // W0-N3, 02 §11.4's "Approval" row. 6e′ can only ever ADD a forced
      // approval; it never clears one, which is why nothing here writes
      // `false` over a `true` and why 6g reads this as a union with the tool's
      // own flag rather than as a replacement for it.
      if (verdict.forcedHumanApproval) state.forcedHumanApproval = true;
      if (verdict.standingAuthorization !== null) {
        state.standingAuthorization = verdict.standingAuthorization;
      }
      return CONTINUE;
    }
    return {
      kind: 'refuse',
      code: verdict.code,
      message: verdict.reason,
      condition: verdict.reason,
      next: verdict.next,
    };
  },
};

// --- 6f --------------------------------------------------------------------

export const stage6f: PolicyStage = {
  id: '6f',
  name: 'guardrails including segregation of duties',
  // 02 §3.1.3 requires guardrails "at plan time and again at execute time". That
  // is a property of THIS stage sitting before 6g in the frozen list plus the
  // fact that a plan and an execute are two separate calls, each walking the
  // whole chain. Nothing here evaluates twice, and nothing anywhere else
  // evaluates a guardrail at all.
  async evaluate(call, ctx, state) {
    const entry = state.entry;
    if (entry === undefined) throw new Error('stage 6f ran without a catalogue entry from 6a');

    const verdict = await ctx.runtime.guardrails.evaluate(call, entry, ctx);
    if (!verdict.breached) return CONTINUE;
    return {
      kind: 'refuse',
      code: 'POLICY_GUARDRAIL_BREACH',
      message: verdict.message,
      condition: verdict.message,
      next:
        verdict.next ??
        `Reduce the offending argument below the stated ceiling and call ${call.toolId} again, or ask the named approver to record a policy exception. The breached guardrail is named in the message.`,
    };
  },
};

// --- 6g --------------------------------------------------------------------

export const stage6g: PolicyStage = {
  id: '6g',
  name: 'write plan-or-confirm state machine',
  async evaluate(call, ctx, state) {
    const entry = state.entry;
    if (entry === undefined) throw new Error('stage 6g ran without a catalogue entry from 6a');

    // W0-N3, 02 §11.4: an elevated write with no `standingAuthorization` on its
    // authorizing grant has `humanApprovalRequired` forced true, "overriding the
    // tool's own default". The override is applied HERE, by handing 6g an entry
    // whose flag is already true, rather than by giving the write gate a second
    // input it could forget to read. It is one-directional — the tool's own
    // `true` is never overwritten with `false`, so this can only ever add an
    // approval — and the write gate itself takes the union of this flag and the
    // write-safety view's, so neither source can quietly lower the other.
    const effectiveEntry =
      state.forcedHumanApproval === true && entry.humanApprovalRequired !== true
        ? { ...entry, humanApprovalRequired: true }
        : entry;

    const verdict = await ctx.runtime.writeGate.evaluate(call, effectiveEntry, ctx);
    switch (verdict.kind) {
      case 'not-a-write':
        return CONTINUE;
      case 'respond':
        return { kind: 'respond', response: verdict.response };
      case 'confirmed':
        state.confirmed = {
          argsCanonicalHash: verdict.argsCanonicalHash,
          confirmToken: verdict.confirmToken,
          nonce: verdict.nonce,
          tokenExpiresAt: verdict.tokenExpiresAt,
        };
        return CONTINUE;
      case 'refuse':
        return {
          kind: 'refuse',
          code: verdict.code,
          message: verdict.message,
          condition: verdict.message,
          next: verdict.next ?? defaultWriteNext(verdict.code, call.toolId),
        };
      default: {
        // An unrecognised verdict is a denial, never a pass.
        throw new Error(`stage 6g received an unrecognised write-gate verdict for ${call.toolId}`);
      }
    }
  },
};

function defaultWriteNext(
  code: 'PLAN_REQUIRED' | 'PLAN_EXPIRED' | 'PLAN_ARGUMENT_MISMATCH' | 'APPROVAL_REQUIRED',
  toolId: string,
): string {
  switch (code) {
    case 'PLAN_REQUIRED':
      return `Call ${toolId} again without confirm to obtain the plan and its confirmToken, show the plan to the human, then call again with identical arguments plus that token.`;
    case 'PLAN_EXPIRED':
      return `The confirm token has expired. Call ${toolId} again without confirm for a fresh plan, re-show it to the human, and confirm within the stated TTL.`;
    case 'PLAN_ARGUMENT_MISMATCH':
      return `The arguments changed after the human read the plan. Call ${toolId} again without confirm to produce a plan for the new arguments and have the human confirm that one.`;
    case 'APPROVAL_REQUIRED':
      return `A named approver must approve this in the MCPForge portal Approvals queue; then call ${toolId} again with the same arguments to obtain the confirm token.`;
  }
}

// --- 6h --------------------------------------------------------------------

export const stage6h: PolicyStage = {
  id: '6h',
  name: 'idempotency lookup',
  async evaluate(call, ctx, state) {
    const entry = state.entry;
    if (entry === undefined) throw new Error('stage 6h ran without a catalogue entry from 6a');

    const verdict = await ctx.runtime.idempotency.lookup(call, entry, ctx, state.confirmed ?? null);
    if (verdict.kind === 'replay') {
      // 02 §3.1.2: a repeat within the window returns the ORIGINAL result with
      // `replayed: true` instead of executing again. The shaping lives in
      // ./idempotency/replay.ts so the chain and the executor — the two places
      // a replay can be served from — cannot answer in two different shapes.
      return { kind: 'respond', response: replayedResponse(verdict.previousResult) };
    }
    if (verdict.kind === 'refuse') {
      return {
        kind: 'refuse',
        code: verdict.code,
        message: verdict.message,
        condition: verdict.message,
        next: verdict.next,
      };
    }
    return CONTINUE;
  },
};

/**
 * The chain. FROZEN, and the only order the runner ever walks. The array is the
 * specification: ./policy.chain.test.ts reads the ids out of it and asserts them
 * against 02 §11.4.2's list, so a reordering is a test failure and not a review
 * miss.
 */
export const POLICY_STAGES: readonly PolicyStage[] = Object.freeze([
  stage6a,
  stage6aPrime,
  stage6b,
  stage6c,
  stage6d,
  stage6e,
  stage6ePrime,
  stage6f,
  stage6g,
  stage6h,
]);

/** A no-op used only by fault injection and by the composition root's assertions. */
export function stageById(id: string): PolicyStage | undefined {
  return POLICY_STAGES.find((s) => s.id === id);
}
