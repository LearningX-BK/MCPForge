// MCPForge — W0-J19: Requests data shapes (03 §5.3 "Requests").
//
// JUDGMENT CALL (documented here and in the task's final report): same seam
// discipline every J-track task since W0-J7 has followed — no live gateway
// `/api/find` HTTP client exists in the portal yet (`palette/find-client.ts`'s
// own header says so), so the three-tier verdict below is produced by
// running the REAL ranker (`@mcpforge/registry/rank`'s `rankTools`, W0-G2)
// over an index built in-process from the same `CatalogData` the Catalog page
// already uses (`catalog/fixtures.ts`) — see `rank-adapter.ts`. This is NOT a
// second, simplified search: it is the identical `CatalogueIndexToolInput` →
// `buildCatalogueIndex` → `rankTools` pipeline `forge.find` itself runs
// (02 §5.4), just invoked as a library call instead of over HTTP, which is
// exactly the seam already established for Build's manifest-generation
// preview. Swapping the source below for a live `/api/find` call touches no
// component in this directory.
//
// THE SIMILARITY SCORE (03 §5.3: "shown, not hidden"). `RequestVerdictMatch.score`
// is `RankedResult.score` verbatim from `@mcpforge/registry/rank` — never a
// hand-picked or invented percentage. See `rank-adapter.ts`'s header for the
// tier-boundary judgment call (which is about business logic, not about the
// number itself, which is always real and always rendered).
import type { BuildDraft } from '../build/types';

/** The three-tier verdict off the real ranker. */
export type RequestVerdictTier = 'exists' | 'near_miss' | 'new';

/** One ranked candidate the verdict is built from — real `RankedResult` fields, flattened for the view. */
export interface RequestVerdictMatch {
  readonly toolId: string;
  readonly title: string;
  /** `RankedResult.score` verbatim — real, comparable, never invented (see file header). */
  readonly score: number;
  readonly href: string;
  readonly disambiguation: string | null;
}

/** The full verdict for one request's free-text ask. */
export type RequestVerdict =
  | { readonly tier: 'exists'; readonly match: RequestVerdictMatch }
  | { readonly tier: 'near_miss'; readonly matches: readonly RequestVerdictMatch[] }
  | { readonly tier: 'new'; readonly draftTemplate: BuildDraft };

/** The six intake questions (03 §5.3), asked on the `new` path — their answers become manifest fields. */
export interface RequestIntakeAnswers {
  readonly owner: string;
  readonly steward: string;
  readonly sensitivity: string;
  readonly processTag: string;
  readonly expectedVolume: string;
  readonly writeOrRead: 'write' | 'read';
}

/**
 * The request lifecycle. Terminal state is `enabled`, NOT `merged` — 03 §5.3:
 * "a merged manifest whose probe says `disabled_missing_binding` is not a
 * delivered capability." `merged` stays a real, distinct, non-terminal state
 * on the way to `enabled`.
 */
export type RequestState = 'submitted' | 'triaged' | 'drafted' | 'in_review' | 'merged' | 'enabled';

export const REQUEST_STATES: readonly RequestState[] = [
  'submitted',
  'triaged',
  'drafted',
  'in_review',
  'merged',
  'enabled',
];

export const REQUEST_STATE_LABELS: Readonly<Record<RequestState, string>> = {
  submitted: 'Submitted',
  triaged: 'Triaged',
  drafted: 'Drafted',
  in_review: 'In review',
  merged: 'Merged',
  enabled: 'Enabled',
};

/** One tracked request in "My requests" (03 §5.3). */
export interface RequestRecord {
  readonly id: string;
  readonly askText: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly state: RequestState;
  readonly verdict: RequestVerdict;
  /**
   * The application team a capability is waiting on, sourced from the real
   * `governance.owner` manifest field of the tool this request is nearest to
   * — the SAME field `environments/types.ts`'s `owningTeam` documents itself
   * against (W0-J17 precedent). Set once the request has something to point
   * at (drafted onward); `null` beforehand.
   */
  readonly owningTeam: string | null;
  readonly intake?: RequestIntakeAnswers | undefined;
  /** Present once a Build draft has been opened for this request (`new` tier, or a promoted near-miss). */
  readonly draftId?: string | undefined;
}

/** The injectable seam — same shape as every other J-track `*Source`. */
export type RequestSource = () => readonly RequestRecord[];
