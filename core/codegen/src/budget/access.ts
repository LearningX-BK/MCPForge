// MCPForge — the `access` field's token cost, accounted for separately from
// the card budget. W0-G5, [P5], 02 §11 Phase-5 addendum.
//
// 02 §11: "A tool the session lacks the elevated grant for is ... findable
// through `forge.find`, which returns its card with a per-result
// `access: 'requires_grant'` and an `agentMessage` naming the grant and the
// owning approver. The `access` field rides on the find response, costing
// ≤6 tokens per result ... but must be accounted for deliberately in the
// MTB gate (`W0-G5`) rather than discovered as a budget failure."
//
// BOUNDARY THIS FILE ENFORCES: `access`/`agentMessage` are fields of a
// `forge.find` RESULT ENTRY (a wrapper around a card), never fields of the
// card artefact itself (`generated/cards/<id>.json`, `card.ts`'s
// `buildDiscoveryCard`/`cardWireShape`). The card budget (§5.3(a), ≤60
// tokens) stays measured on the card's own wire shape, unchanged by this
// task — see `checkCardBudget` in `gate.ts`, which measures
// `cardWireShape(card)` exactly as W0-B6 already did, and nothing under
// `budget/**` adds an `access` key to that object. This constant exists so
// a future MTB/find-response gate (W0-G7) has one named, documented number
// to add to its own accounting instead of re-deriving or guessing it.

/** The pinned tokenizer's ceiling on `access` + `agentMessage` overhead per `forge.find` result entry (02 §11). */
export const ACCESS_FIELD_TOKEN_BUDGET = 6;
