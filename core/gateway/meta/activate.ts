// MCPForge — `forge.activate`. W0-G4, 02 §5.2 tool 3, §5.8, §5.10.
//
// "Sets session scope, returns the resulting tool count and token estimate,
// and **emits `notifications/tools/list_changed`**. The client's next
// `tools/list` returns the activated set. Refuses (with a clear message) any
// activation that would exceed the VTC hard cap or the caller's grants."
//
// ORDER: THE CAP IS CHECKED BEFORE THE GRANTS. Both refuse, so the order is
// not a security property — but the cap is a property of the REQUEST (how many
// tools were named) while the grant check is a property of each named tool, and
// answering "you asked for too many" before "and here is the first one you may
// not have" is the more useful of the two orders for an agent that has to
// narrow and retry. It also means an oversized list is refused without
// resolving scope for every id in it.
//
// THREE THINGS IT IS NOT.
//
//  1. **It is not a grant.** Activation is 02 §5.1's axis 3, a caller-chosen
//     lens, and the only one of the six predicates whose default is
//     permissive. Selecting a tool cannot make it visible: the selection is
//     intersected with what this session could already list, and anything
//     outside that is refused by name, never silently dropped. A silent drop
//     would let a caller believe it had activated something it had not.
//  2. **It is not a second notification mechanism.** It calls the
//     `ToolListChangedNotifier` seam W0-E5 already built for the kill switch
//     and proved on the real wire (`flags/pipeline.e2e.test.ts`). 02 §5.8
//     lists activation change and kill-switch flip as two triggers of the one
//     notification, so they emit through one path.
//  3. **It is not where the VTC numbers were invented.** ./vtc.ts carries them
//     and 02 §5.10 carries the reason.

import { countJsonTokens, forgeError, TOKEN_BUDGETS, type ForgeError } from '@mcpforge/shared';
import type { ToolId } from '../scope/index.js';
import { resolveDiscovery } from './visibility.js';
import {
  assessVtc,
  META_TOOL_COUNT,
  VTC_DEFAULT,
  VTC_HARD_CAP,
  type VtcAssessment,
} from './vtc.js';
import { META_TOOL_DEFINITIONS } from './definitions.js';
import type { MetaContext, MetaSession } from './types.js';

export interface ActivateInput {
  readonly role?: string;
  readonly package?: string;
  readonly module?: string;
  readonly toolIds?: readonly string[];
}

export interface ActivateResponse {
  readonly result: 'activated';
  readonly toolIds: readonly ToolId[];
  /** Resident tools after this activation: the four meta-tools plus the activated set. */
  readonly count: number;
  readonly vtc: VtcAssessment;
  /** Tokens the next `tools/list` will cost, as far as this gateway can measure it. */
  readonly tokenEstimate: number;
  /** Present only when the activation is over the ≤16 default but under the hard cap. */
  readonly warning?: string;
}

export type ActivateResult =
  ActivateResponse | { readonly result: 'error'; readonly error: ForgeError };

export function forgeActivate(
  session: MetaSession,
  input: ActivateInput,
  correlationId: string,
): ActivateResult {
  const ctx = session.context();
  const scope = ctx.policy.scope;

  const named = [input.role, input.package, input.toolIds].filter((v) => v !== undefined);
  if (named.length === 0) {
    return err(
      'INPUT_INVALID',
      'forge.activate needs a role, a package or a list of tool ids.',
      correlationId,
      {
        condition: 'No selection was given: role, package and toolIds were all absent.',
        next: 'Call forge.activate again naming one of role, package or toolIds. Call forge.find first if you do not know which tools you need.',
      },
    );
  }

  // --- what the input selects ----------------------------------------------
  // `byName` records HOW the caller selected. It decides what an unreachable
  // tool means, and the two answers are different on purpose:
  //
  //   * An EXPLICIT tool id list names tools. Dropping one silently would let
  //     an agent believe it had activated something it had not, so an
  //     unreachable id refuses the whole activation, by name.
  //   * A ROLE or PACKAGE names a lens, not a tool list. A compiled role
  //     legitimately spans tools this deployment has not selected, this probe
  //     has disabled or this consumer may not reach — that is what the other
  //     five predicates are FOR. Refusing the lens because one member is out of
  //     reach would make role activation, the primary path 02 §5.2 describes,
  //     fail almost always. So a lens is intersected with what this session can
  //     already list, and the response reports the resulting count.
  let selected: string[];
  const byName = input.role === undefined && input.package === undefined;

  if (input.role !== undefined) {
    const roleScope = scope.roleScopes.get(input.role);
    if (roleScope === undefined) {
      return err(
        'INPUT_INVALID',
        `No role "${input.role}" is compiled into this deployment.`,
        correlationId,
        {
          condition: `${input.role} is not a compiled role in this deployment.`,
          next: 'Call forge.find for the capability you need; its cards name the roles that carry it, and one of those is the role to activate.',
        },
      );
    }
    if (!scope.session.heldRoleIds.includes(input.role)) {
      return err('TOOL_NOT_IN_SCOPE', `You do not hold role "${input.role}".`, correlationId, {
        condition: `${scope.session.principal.subject} holds [${scope.session.heldRoleIds.join(', ')}], not ${input.role}.`,
        next: `Ask your MCPForge operator to add you to ${input.role} through the git-held group-to-role mapping; activation cannot grant a role you do not hold.`,
      });
    }
    selected = [...roleScope];
  } else if (input.package !== undefined) {
    const selection = scope.packageSelections.get(input.package);
    if (selection === undefined) {
      return err(
        'INPUT_INVALID',
        `No package "${input.package}" is selected into this deployment.`,
        correlationId,
        {
          condition: `${input.package} is not a package this deployment carries.`,
          next: 'Call forge.find without a package filter to see what this deployment actually carries, then activate a role or the tool ids it returns.',
        },
      );
    }
    selected = [...selection].filter(
      (id) => input.module === undefined || id.split('.')[1] === input.module,
    );
  } else {
    selected = [...(input.toolIds ?? [])];
  }

  if (selected.length === 0) {
    return err('INPUT_INVALID', 'That selection names no tools.', correlationId, {
      condition: 'The role, package or tool id list selected an empty set.',
      next: 'Call forge.find for the capability you need and activate the ids it returns.',
    });
  }

  const unique = [...new Set(selected)].sort();

  // --- the VTC hard cap (02 §5.10), for an EXPLICIT id list ----------------
  // Checked here, before scope, only for a list the caller wrote out: the
  // question "did you name more tools than may be resident?" is answerable from
  // the request alone, and answering it first tells an oversized request to
  // narrow instead of making it discover its ids one refusal at a time. A lens
  // (role or package) is capped in `commit`, against the set that will actually
  // become resident rather than against everything the lens spans.
  if (byName) {
    const refusal = capRefusal(unique.length, correlationId);
    if (refusal !== null) return refusal;
  }

  // --- the caller's grants -------------------------------------------------
  // Refused by name, never silently narrowed: an agent must not be able to
  // believe it activated something it did not.
  const discovery = resolveDiscovery(ctx);
  const listable = new Set(discovery.listable);

  if (!byName) {
    const reachable = unique.filter((id) => listable.has(id));
    if (reachable.length === 0) {
      return err(
        'TOOL_NOT_IN_SCOPE',
        'Nothing in that selection is reachable by this session.',
        correlationId,
        {
          condition: `Every tool the selection named is excluded by scope, by probe status or by a missing elevated grant.`,
          next: 'Call forge.find for the capability you need; its results carry an access field saying whether each tool is available, disabled or needs a grant.',
        },
      );
    }
    return commit(session, ctx, reachable, correlationId);
  }

  for (const id of unique) {
    if (listable.has(id)) continue;
    const access = discovery.access.get(id);

    // `why` is the one message ./visibility.ts already composed for this tool —
    // the probe report's own `agentMessage`, or the grant-and-approver line.
    // It is read into a local first so the `next:` below stays a template
    // literal with its own fixed text: an agent must be told what to DO here
    // even in the impossible case where the annotation carries no message.
    const why = access?.agentMessage ?? '';

    if (access?.level === 'requires_grant') {
      return err(
        'ELEVATED_GRANT_REQUIRED',
        `${id} needs an elevated binding grant this session does not hold.`,
        correlationId,
        {
          condition: `${id} is elevated posture and no live, recorded bindingGrant covers it for this session.`,
          next: `${why} Nothing was activated: activation cannot substitute for a grant. Activate your other tools without ${id}, or ask the named approver to record the grant in approvals/.`,
        },
      );
    }
    if (access?.level === 'disabled') {
      return err('TOOL_DISABLED', `${id} is disabled and cannot be activated.`, correlationId, {
        condition: `${id} is in the catalogue but its probe or kill state excludes it from tools/list.`,
        next: `${why} Nothing was activated. Activate the rest of your selection without ${id} and raise its enablement with its owning team.`,
      });
    }
    return err(
      'TOOL_NOT_IN_SCOPE',
      `${id} is not in the resolved scope of this session.`,
      correlationId,
      {
        condition: `${id} is not visible to this session.`,
        next: `Call forge.find to locate a tool your roles do grant for this task, and activate that instead of ${id}.`,
      },
    );
  }

  return commit(session, ctx, unique, correlationId);
}

/**
 * The one implementation of 02 §5.2's "Refuses ... any activation that would
 * exceed the VTC hard cap". `null` means the count is allowed; the numbers and
 * their reason are ./vtc.ts's and 02 §5.10's.
 */
function capRefusal(
  activatedCount: number,
  correlationId: string,
): { readonly result: 'error'; readonly error: ForgeError } | null {
  const vtc = assessVtc(activatedCount);
  if (vtc.withinHardCap) return null;
  return err(
    'INPUT_INVALID',
    `That activation would make ${vtc.count} tools resident, over the VTC hard cap of ${VTC_HARD_CAP}.`,
    correlationId,
    {
      condition: `${activatedCount} selected tools plus the ${META_TOOL_COUNT} resident meta-tools is ${vtc.count}, and the VTC hard cap is ${VTC_HARD_CAP} (02 §5.10).`,
      next: `Activate at most ${VTC_HARD_CAP - META_TOOL_COUNT} tools at once — narrow with forge.find's app, module or verb filters, activate that subset, and reach the rest through forge.find and forge.invoke, which need no activation.`,
    },
  );
}

/** Set the lens, then tell the client. In that order: the notification must never precede the change it announces. */
function commit(
  session: MetaSession,
  ctx: MetaContext,
  ids: readonly string[],
  correlationId: string,
): ActivateResult {
  const refusal = capRefusal(ids.length, correlationId);
  if (refusal !== null) return refusal;
  const vtc = assessVtc(ids.length);

  session.setActivation({ mode: 'explicit', toolIds: new Set(ids) });
  void ctx.notifier.sendToolListChanged();

  const response: ActivateResponse = {
    result: 'activated',
    toolIds: ids,
    count: vtc.count,
    vtc,
    tokenEstimate: estimateResidentTokens(ids),
  };
  return vtc.withinDefault
    ? response
    : {
        ...response,
        warning: `${vtc.count} resident tools is over the ${VTC_DEFAULT}-tool VTC default (02 §5.10). This session will miss the per-role TTFC target; activate a narrower set if you can.`,
      };
}

/**
 * The `tools/list` token estimate 02 §5.2 asks the response to carry: the four
 * meta definitions measured exactly, with the pinned counter, plus the
 * activated tools at 02 §5.3(b)'s typical resident definition.
 *
 * An ESTIMATE, and named one. The real per-tool figure is measured at codegen
 * (W0-G5) and is not loaded into this path; using the typical figure keeps the
 * number honest and keeps the budget where 02 §5.3 puts it — "a budget checked
 * at runtime is a budget already blown". Nothing is enforced from this value.
 */
function estimateResidentTokens(ids: readonly string[]): number {
  return countJsonTokens(META_TOOL_DEFINITIONS) + ids.length * TOKEN_BUDGETS.resident;
}

function err(
  code: Parameters<typeof forgeError>[0],
  message: string,
  correlationId: string,
  detail: { readonly condition: string; readonly next: string },
): { readonly result: 'error'; readonly error: ForgeError } {
  return { result: 'error', error: forgeError(code, message, correlationId, detail) };
}
