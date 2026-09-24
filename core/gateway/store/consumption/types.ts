// MCPForge — the `consumption_edge` repository's types. W0-N10, 02 §4.6/§11.3.
//
// 02 §4.6 names the satellite: "`consumption_edge` (tool → consuming
// agent/platform/scope, rolled up for G9)". 02 §11.3 names its source and
// forecloses every other one:
//
// > "This is what finally feeds `consumption_edge`: `consumer_id` **is** the
// > 'consuming agent,' authenticated rather than self-declared."
//
// So the input type below has exactly one identity field, `consumerId`, and it
// is not optional. There is no `agentName`, no `clientName`, no `label` and no
// `displayName` — not even an optional one — because an optional
// self-described name is a name that gets written on the day someone has one
// to hand. The repository additionally REFUSES a blank consumer id rather than
// substituting anything for it (`./repository.ts`): a missing authenticated
// identity means the edge is absent, never anonymous.

/** One consumption edge, as read back. */
export interface ConsumptionEdge {
  readonly deploymentId: string;
  /**
   * The authenticated consuming agent — `audit_call.consumer_id`, which exists
   * only because `[2a]` verified a registered credential
   * (`../../transport/consumer-auth/**`).
   */
  readonly consumerId: string;
  readonly toolId: string;
  /** Last observed binding type on this edge; descriptive, not part of the key. */
  readonly bindingType: string | null;
  /** The most recent `audit_call.id` on this edge — the row's own evidence. */
  readonly lastCallId: string;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly callCount: number;
  readonly writeCount: number;
}

/**
 * One call's worth of consumption, in the shape `AuditRepository.append`
 * already holds while it stands over the row it just built. Every field is
 * copied from THAT ROW — not from a parallel argument a caller could set
 * independently of what was written — so the edge and the audit trail cannot
 * disagree about who consumed what.
 */
export interface RecordConsumptionInput {
  readonly deploymentId: string;
  /** Non-empty, always. A blank value is a programming error and throws. */
  readonly consumerId: string;
  readonly toolId: string;
  readonly bindingType: string | null;
  readonly isWrite: boolean;
  /** `audit_call.id` of the call this edge is being fed from. */
  readonly callId: string;
  /** The audit row's own `ts`, so the feed's clock is the trail's clock. */
  readonly ts: string;
}

export interface ListConsumptionEdgesFilter {
  readonly deploymentId?: string;
  readonly consumerId?: string;
  readonly toolId?: string;
  readonly limit?: number;
}

/**
 * The consumption feed. `recordEdge` is called from INSIDE
 * `AuditRepository.append`'s own transaction (`../audit/repository.ts`), the
 * same rule `../usage/types.ts` states for the usage rollup: an edge written
 * outside it could survive a rolled-back call, and a consumption number that
 * counts calls that never happened is not evidence.
 */
export interface ConsumptionRepository {
  recordEdge(input: RecordConsumptionInput): Promise<void>;
  /** Newest-consumed first. */
  listEdges(filter?: ListConsumptionEdgesFilter): Promise<ConsumptionEdge[]>;
  getEdge(
    deploymentId: string,
    consumerId: string,
    toolId: string,
  ): Promise<ConsumptionEdge | undefined>;
}
