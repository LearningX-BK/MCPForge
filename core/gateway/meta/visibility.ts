// MCPForge — what this session may LIST, and what it may FIND. W0-G4,
// 02 §4.5, 02 §11.4.5.
//
// THE ONE RESOLUTION, APPLIED TWICE. 02 §4.5 settled the disabled-tool
// tension: a tool an agent can never call must not consume its context budget,
// so it is excluded from `tools/list` — but a silent absence is a dead end, so
// it remains findable through `forge.find`, carrying the probe's own
// `agentMessage`. 02 §11.4.5 then reaches for exactly that resolution again
// for a tool the session lacks an elevated grant for, and says so in as many
// words: "reuse the resolution §4.5 already reached for disabled tools". This
// module is that reuse — ONE function producing ONE annotated set, with the
// `access` value as the only thing that differs between the two cases.
//
// THREE SETS, AND THE DIFFERENCE BETWEEN THEM IS THE WHOLE POINT:
//
//   visible   — `resolveScope`'s six-way intersection, unchanged (W0-E2).
//   listable  — visible MINUS elevated-posture tools with no live grant.
//               This is what `tools/list` renders.
//   findable  — visible PLUS tools refused only by `ProbeEnabled` or by
//               `NotKillSwitched` — 02 §4.5's "disabled", whose closed status
//               enum includes `disabled_kill_switch`.
//               This is what `forge.find` ranks over.
//
// `findable` widens the ranked set beyond `visible`, and it may widen it in
// exactly one direction: a tool this session would otherwise see, which the
// probe or a kill switch has switched off. A tool refused by Deployed, Granted,
// ConsumerAuthorized or Activated is never findable — whether
// a capability exists elsewhere in the estate is not something a caller
// outside its scope is entitled to learn (the same reading
// `scopeRefusalError` already takes). That restriction is a test in
// `meta.find.test.ts`, not a comment.
//
// THE GRANT CHECK IS NOT A SECOND POLICY CHAIN. It calls `authorizeBinding`
// (W0-E3, stage 6e′) — the same function, the same fail-closed grant rules —
// purely to decide LISTING and the `access` annotation. Nothing here
// authorizes anything: stage 6e′ runs again, independently, on every call
// through either entry point, exactly as step 6a re-checks what step 4 decided.

import { authorizeBinding, type PolicyCatalogueEntry } from '../policy/index.js';
import { resolveScope, type ToolId } from '../scope/index.js';
import type { AccessLevel, MetaContext } from './types.js';

export interface ToolAccess {
  readonly level: AccessLevel;
  /** Absent for `available`; present and non-empty for the other two. */
  readonly agentMessage?: string;
}

export interface DiscoveryVisibility {
  /** `visible(session)` — the six-way intersection, verbatim from W0-E2. */
  readonly visible: readonly ToolId[];
  /** What `tools/list` returns: visible, minus ungranted elevated bindings. */
  readonly listable: readonly ToolId[];
  /** What `forge.find` ranks over: visible, plus probe-disabled tools. */
  readonly findable: ReadonlySet<ToolId>;
  /** Per findable tool, how reachable it is and what to tell the agent. */
  readonly access: ReadonlyMap<ToolId, ToolAccess>;
}

/**
 * The message a `requires_grant` result carries. It names the grant (its
 * binding type and the target the grant must name) and, when the deployment
 * can supply one, its approver. See `ElevatedApproverSource` for why the
 * approver is a seam and never invented.
 */
export function requiresGrantMessage(entry: PolicyCatalogueEntry, approver: string | null): string {
  const grant = `a ${entry.bindingType} bindingGrant naming ${entry.bindingRef}`;
  const who =
    approver === null
      ? "the approver named on that grant's approval record in approvals/"
      : approver;
  return `This capability exists but you hold no elevated grant for it: it needs ${grant}. Do not attempt to call it; it will refuse with ELEVATED_GRANT_REQUIRED until ${who} issues the grant as an approval record in approvals/.`;
}

/**
 * The message a `disabled` result carries. The probe report's own
 * `agentMessage` first (02 §4.5 — it is the artefact this is meant to be
 * rendered from); the refusing predicate's `next` second, which for a kill
 * switch is the flag's recorded reason (02 §4.7, W0-E5); and only then a
 * generic-but-still-actionable line. Never "try again".
 */
function disabledMessage(toolId: ToolId, ctx: MetaContext, refusalNext: string | null): string {
  const fromProbe = ctx.probeMessages.agentMessageFor(toolId);
  if (fromProbe !== null && fromProbe.trim().length > 0) return fromProbe;
  if (refusalNext !== null && refusalNext.trim().length > 0) return refusalNext;
  return `This capability exists but is disabled: its probe status is not resolved. Do not retry; it will not succeed until the owning team enables it and \`forge probe\` records the change.`;
}

export function resolveDiscovery(ctx: MetaContext): DiscoveryVisibility {
  const scope = ctx.policy.scope;
  const resolution = resolveScope(ctx.policy.catalogue, scope);
  const visibleSet = new Set<ToolId>(resolution.visible);

  const listable: ToolId[] = [];
  const findable = new Set<ToolId>();
  const access = new Map<ToolId, ToolAccess>();

  for (const entry of ctx.policy.catalogue) {
    const toolId = entry.toolId;

    if (visibleSet.has(toolId)) {
      const sources = scope.session.heldRoleIds
        .filter((roleId) => scope.roleScopes.get(roleId)?.has(toolId) === true)
        .map((roleId) => ({
          roleId,
          grants: ctx.policy.roles.get(roleId)?.bindingGrants ?? [],
        }));

      const authorization = authorizeBinding({
        entry,
        grantingRoles: sources,
        consumerId: scope.session.consumer.consumerId,
        consumerBindingGrants: ctx.policy.consumerBindingGrants,
        humanInTheLoop: scope.session.consumer.attestation.humanInTheLoop === true,
        now: scope.now,
      });

      findable.add(toolId);
      // W0-N3: `authorizeBinding` can now refuse for two different reasons, and
      // only ONE of them is the one 02 §11.4.5 excludes from `tools/list`. A
      // missing grant is `requires_grant` — the documented resolution, with the
      // grant and its approver named. The `humanInTheLoop: false` refusal
      // (`CONSUMER_NOT_AUTHORIZED`) is NOT a grant question and no approver can
      // issue anything for it, so listing is left exactly as it was: the tool
      // stays listed and the call still fails closed at 6e′ with a `next` that
      // names the real remedy. Visibility is discovery; it authorizes nothing
      // either way (CLAUDE.md #7).
      if (authorization.authorized || authorization.code === 'CONSUMER_NOT_AUTHORIZED') {
        listable.push(toolId);
        access.set(toolId, { level: 'available' });
      } else {
        // 02 §11.4.5: excluded from tools/list, still findable.
        access.set(toolId, {
          level: 'requires_grant',
          agentMessage: requiresGrantMessage(entry, ctx.approvers?.approverFor(toolId) ?? null),
        });
      }
      continue;
    }

    // 02 §4.5: a tool the PROBE switched off — `disabled_kill_switch` is one of
    // its seven statuses — stays findable. Every other refusal (Deployed,
    // Granted, ConsumerAuthorized, Activated) is invisible, full stop: whether
    // a capability exists elsewhere in the estate is not something a caller
    // outside its scope is entitled to learn.
    const refusal = resolution.refusals.get(toolId);
    if (refusal?.predicate === 'ProbeEnabled' || refusal?.predicate === 'NotKillSwitched') {
      findable.add(toolId);
      access.set(toolId, {
        level: 'disabled',
        agentMessage: disabledMessage(toolId, ctx, refusal.next),
      });
    }
  }

  listable.sort();
  return { visible: resolution.visible, listable, findable, access };
}
