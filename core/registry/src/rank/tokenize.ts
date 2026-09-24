// MCPForge — tokenization, shared by the lexical channel and the structured
// boosts. W0-G2, 02 §5.4.2 stages 2 and 5.
//
// One tokenizer, used for both, on purpose: the entity boost asks "does the
// query name this entity", and it would be answering a different question
// from BM25 if the two split text differently.
//
// Deliberately NOT here: stemming, stop-word removal and synonym expansion.
// 02 §5.4.3 stages the retrieval improvements explicitly — Wave 0 is lexical
// only, and the Wave 1 gate is an embedding channel, not a hand-built
// linguistic layer. A synonym table would be a third, undeclared channel
// whose behaviour no benchmark measures.

/**
 * Lower-case, split on anything that is not a letter or digit. `_`, `.` and
 * `-` are separators, so `jde.ap.voucher.create` and `purchase_order` both
 * decompose the way the id convention (CLAUDE.md §5) intends.
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length > 0) out.push(raw);
  }
  return out;
}

/** The same split, as a set — what the structured boosts test membership against. */
export function tokenSet(text: string): ReadonlySet<string> {
  return new Set(tokenize(text));
}

/**
 * Does the query name this structured value? A structured value is lower
 * snake (`voucher`, `purchase_order`, `run_report`), and a caller writes it
 * as ordinary words ("purchase order", "run the report"). The match is
 * therefore: EVERY token of the value is present among the query's tokens.
 *
 * Conjunctive, not disjunctive: `purchase_order` must not match a query that
 * says only "order", because `order` alone is also a token of half the
 * catalogue's entities and a boost that fires on it stops discriminating.
 */
export function namesStructuredValue(queryTokens: ReadonlySet<string>, value: string): boolean {
  const parts = tokenize(value);
  if (parts.length === 0) return false;
  return parts.every((part) => queryTokens.has(part));
}
