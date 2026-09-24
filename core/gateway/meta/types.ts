// MCPForge — the four meta-tools: their shapes and their seams. W0-G4,
// 02 §5.2, §5.8.
//
// WHAT THIS TASK IS. Assembly, almost entirely. `forge.find` is `rankTools`
// (W0-G2) + `evaluateFloor` (W0-G3) over the catalogue index (W0-G1), scoped
// by `resolveScope` (W0-E2). `forge.invoke` is `invokeThroughForgeInvoke`
// (W0-E3) and nothing else — W0-E3 built the two near-identical entry points
// FOR this task, and calling one of them is how "the identical chain" stays a
// structural fact rather than a claim. `forge.activate` emits `list_changed`
// through W0-E5's `ToolListChangedNotifier`, the same seam the kill switch
// already drives. Nothing here re-derives a decision one of those tasks made.
//
// THE SEAMS BELOW EXIST BECAUSE THE GATEWAY MAY NOT IMPORT CODEGEN. The card
// (`generated/cards/<id>.json`) and the full description (02 §5.3(c)) are
// codegen artefacts; `@mcpforge/codegen` depends on `@mcpforge/registry`, and
// a gateway→codegen import would drag the whole authoring pipeline into the
// runtime. So the meta layer takes the *loaded artefacts* as sources, exactly
// as the ranker takes the resolved visible SET rather than the resolver.

import type { CatalogueIndex } from '@mcpforge/registry/index';
import type { ConsumptionCounts, FloorConfig } from '@mcpforge/registry/rank';
import type { ToolListChangedNotifier } from '../flags/index.js';
import type { PolicyContext } from '../policy/index.js';
import type { SessionActivation, ToolId } from '../scope/index.js';

/**
 * A tool card as it goes over the wire — `cardWireShape(buildDiscoveryCard())`
 * from `core/codegen/src/templates/card.ts`, budget-measured at ≤60 tokens
 * (02 §5.3(a)). Typed loosely on purpose: the card's field list is codegen's
 * to own, and a second declaration of it here would be a second thing to keep
 * in step with the budget gate.
 */
export type MetaToolCard = Readonly<Record<string, unknown>>;

/** The full description of 02 §5.3(c) — schema, examples, error catalogue, write-safety, sensitivity. */
export type MetaToolDetail = Readonly<Record<string, unknown>>;

/**
 * 02 §11.4.5's per-result field, and 02 §4.5's disabled-tool resolution,
 * expressed once. Both are the SAME resolution — "excluded from `tools/list`,
 * still findable through `forge.find`, with an `agentMessage`" — which is why
 * they are one enum on one response field and not two parallel mechanisms.
 *
 * The field rides on the find RESPONSE, never on the card
 * (`ACCESS_FIELD_TOKEN_BUDGET`, W0-G5): the card budget is measured at 54
 * against a 60 ceiling and has no room for it.
 */
export const ACCESS_LEVELS = ['available', 'requires_grant', 'disabled'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/** One `forge.find` result: the card, its score, and how reachable it is. */
export interface FindResultEntry {
  readonly card: MetaToolCard;
  readonly score: number;
  readonly access: AccessLevel;
  /**
   * Present for every non-`available` result and absent otherwise. For
   * `disabled` it is the probe report's own `agentMessage` (02 §4.5); for
   * `requires_grant` it names the grant and its approver (02 §11.4.5).
   * Non-negotiable #5's rule applies to it: never "try again".
   */
  readonly agentMessage?: string;
}

/** `forge.find`'s response. `no_tool` is W0-G3's verdict, passed through unchanged. */
export type FindResponse =
  | {
      readonly result: 'tools';
      readonly tools: readonly FindResultEntry[];
      readonly choose?: string;
    }
  | {
      readonly result: 'no_tool';
      readonly reason: string;
      readonly nearest: readonly { readonly id: string; readonly score: number }[];
      readonly next: string;
    };

/** Where a loaded `generated/cards/<id>.json` comes from. `null` = no card for this id. */
export interface MetaCardSource {
  cardFor(toolId: ToolId): MetaToolCard | null;
}

/** Where the full description (02 §5.3(c)) comes from. */
export interface MetaDetailSource {
  detailFor(toolId: ToolId): MetaToolDetail | null;
}

/**
 * The probe report's `agentMessage` for a tool (02 §4.5). SEAM onto
 * `core/probe/**`'s `probe-report.json`, whose `agentMessageFor` already
 * produces these strings — this module must not compose a second set of them,
 * because the portal's enablement backlog and the find response are meant to
 * be rendered from the one artefact.
 */
export interface AgentMessageSource {
  agentMessageFor(toolId: ToolId): string | null;
}

/**
 * Who approves the elevated grant a session is missing (02 §11.4.5: an
 * `agentMessage` "naming the grant and the owning approver").
 *
 * FLAGGED FOR A HUMAN (CLAUDE.md §8). When a session holds NO grant at all
 * there is no grant record to read an approver off — the approver is a
 * property of the approval that would have to be issued, not of the session.
 * No document names the field this should be read from. This seam is
 * therefore explicit and optional: a deployment that can name the approver
 * (from the tool's owning approval record, or its module server's owner)
 * supplies one and the message names them; a deployment that cannot gets a
 * message that names the grant and directs the agent to the approval record
 * in `approvals/`, which is still actionable and still not "try again". No
 * approver name is ever invented.
 */
export interface ElevatedApproverSource {
  approverFor(toolId: ToolId): string | null;
}

/** Everything the four meta-tools read. Assembled once per session. */
export interface MetaContext {
  readonly index: CatalogueIndex;
  /**
   * The policy context, whole. It carries the scope context (and therefore the
   * session and its activation), the catalogue and the roles — the meta layer
   * holds no second copy of any of them, so `forge.find` and `forge.invoke`
   * cannot disagree about what this session is.
   */
  readonly policy: PolicyContext;
  readonly cards: MetaCardSource;
  readonly details: MetaDetailSource;
  readonly probeMessages: AgentMessageSource;
  readonly approvers?: ElevatedApproverSource;
  readonly notifier: ToolListChangedNotifier;
  readonly consumption?: ConsumptionCounts;
  readonly floor?: FloorConfig;
}

/**
 * One live session. `forge.activate` is the only thing that mutates it, and it
 * mutates exactly one field — the activation lens (02 §5.1 axis 3). Every
 * authority-bearing input stays where it was.
 */
export interface MetaSession {
  context(): MetaContext;
  setActivation(activation: SessionActivation): void;
}
