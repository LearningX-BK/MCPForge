// MCPForge — the catalogue index's shape (02 §5.4.1). W0-G1.
//
// Two concerns kept apart on purpose:
//   - `CatalogueIndexEntry` / `CatalogueIndex` — the ARTEFACT shape,
//     `generated/index/catalogue-index.json`'s wire format, sorted-key JSON
//     with no timestamps and no random ids (the deterministic-writer
//     discipline `core/codegen/src/emit/writer.ts` already established).
//   - `CatalogueIndexToolInput` — what a CALLER (today: `forge codegen`'s
//     pipeline) hands in per tool to build one entry. This is a plain data
//     shape, not `ToolView` from `@mcpforge/codegen`'s templates, so that
//     `@mcpforge/registry` never depends on `@mcpforge/codegen` — codegen
//     depends on registry to build the artefact, and a dependency the other
//     way would be a circular workspace dependency. The caller does the
//     manifest reading; this package only knows how to shape and load the
//     index.

/**
 * 02 §5.4.1 item 1 — exact-match filters, applied before ranking (02 §5.4.2
 * step 1). Field names and order match the doc's list verbatim:
 * `app, module, entity, verb, bindingType, archetype, sensitivity, write,
 * processTags[], packageTags[], roles[], status`.
 */
export interface CatalogueIndexFilters {
  readonly app: string;
  readonly module: string;
  readonly entity: string;
  readonly verb: string;
  readonly bindingType: string;
  readonly archetype: string;
  readonly sensitivity: string;
  readonly write: boolean;
  readonly processTags: readonly string[];
  /**
   * `packageTags[]` is named in 02 §5.4.1 but no manifest field carries it —
   * no `kind: Tool` field, no `kind: Package` back-reference. JUDGMENT CALL
   * (documented, not guessed): the caller computes it as the sorted set of
   * `Package` ids whose `servers` list includes this tool's `server` (the
   * only structural link a Tool has to a Package, via its module server).
   * Flagged in the task's final report as a schema gap for a human to settle
   * — see `manifests/**` §4's Package↔Tool relationship, which today runs
   * through `server`, not through a direct tag.
   */
  readonly packageTags: readonly string[];
  readonly roles: readonly string[];
  /**
   * Probe + kill state. Never known at codegen time (02 §5.1: "who sets it —
   * the system", via `forge probe`) — mirrors the same judgment call
   * `core/codegen/src/templates/card.ts`'s `DEFAULT_STATUS` already made for
   * the discovery card: always `"unresolved"` in a freshly generated index.
   */
  readonly status: string;
}

/** One tool's entry in the catalogue index (02 §5.4.1 items 1, 2, 4). */
export interface CatalogueIndexEntry {
  readonly id: string;
  readonly filters: CatalogueIndexFilters;
  /**
   * 02 §5.4.1 item 2 — the lexical document BM25 (W0-G2) will run over:
   * `title + purpose + aliases + entity + module label + app label +
   * functionalArea + the tool id split on separators`, space-joined, in that
   * order, case and tokenization left to the ranking stage (W0-G2) rather
   * than baked in here.
   */
  readonly lexicalDocument: string;
  /** 02 §5.4.1 item 4 — near-miss handling text (02 §5.5), verbatim from the manifest. */
  readonly disambiguation: string | null;
}

/**
 * The whole build artefact, `generated/index/catalogue-index.json`. `tools`
 * is sorted by id — the sole ordering guarantee the deterministic-writer
 * discipline needs; every other determinism property (sorted object keys, no
 * timestamps) is `serializeJsonDeterministic`'s job at write time, not this
 * package's. Provenance (`//1` / `//2`, `core/codegen/src/emit/provenance.ts`'s
 * JSON pseudo-comment convention) is the caller's to attach — codegen owns
 * provenance, this package only knows the index's own shape — so
 * `buildCatalogueIndex` accepts already-built provenance fields and spreads
 * them in, exactly as `buildDiscoveryCard` does.
 */
export interface CatalogueIndex {
  readonly tools: readonly CatalogueIndexEntry[];
}

/** What a caller supplies per tool to build one `CatalogueIndexEntry`. Plain data — no manifest parsing here. */
export interface CatalogueIndexToolInput {
  readonly id: string;
  readonly title: string;
  readonly purpose: string;
  readonly aliases: readonly string[];
  readonly disambiguation: string | null;
  readonly entity: string;
  readonly verb: string;
  readonly app: string;
  readonly module: string;
  /** Human-readable app label. See the `CatalogueIndexFilters.packageTags` note: 02 §5.4.1 names this field but no manifest carries a value separate from `app`; callers without one should pass `app` itself. */
  readonly appLabel: string;
  /** Human-readable module label — today, the owning `Server` manifest's single combined `label` field (02 has no separate module-label field either; see the same note). */
  readonly moduleLabel: string;
  readonly functionalArea: string;
  readonly bindingType: string;
  readonly archetype: string;
  readonly sensitivity: string;
  readonly write: boolean;
  readonly processTags: readonly string[];
  readonly packageTags: readonly string[];
  readonly roles: readonly string[];
  readonly status: string;
}
