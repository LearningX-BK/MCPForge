// MCPForge — 02 §5.4.2 STAGE 2: the lexical channel. BM25 over the search
// document W0-G1 assembled (`CatalogueIndexEntry.lexicalDocument`, 02 §5.4.1
// item 2). W0-G2.
//
// Textbook BM25 (Robertson/Sparck Jones), no variant, no field weighting.
// Field weighting was considered and rejected for Wave 0: the fields that
// would deserve extra weight are `entity` and the tool id, and both are
// already handled far more precisely by stage 5's structured boosts. Adding
// a second, fuzzy version of the same signal would double-count it and make
// the boosts untestable in isolation, which the task's `done:` requires.
//
// CORPUS STATISTICS COME FROM THE SURVIVORS OF STAGE 1, not from the whole
// index. This is the strict reading of "a tool the caller cannot reach is
// never ranked": an out-of-scope tool must not influence the ordering of the
// tools that ARE returned, and it would if it contributed to document
// frequency. The cost is that IDF is session-relative; the benefit is that
// nothing about an unreachable tool is observable, even indirectly.

import { tokenize } from './tokenize.js';
import type { CatalogueIndexEntry, ChannelScores, ToolId } from './types.js';

/** Term-frequency saturation. 1.2 is the standard default. */
export const BM25_K1 = 1.2;
/** Length normalisation. 0.75 is the standard default; documents here are short and of similar length, so this term does little work either way. */
export const BM25_B = 0.75;

interface Document {
  readonly id: ToolId;
  readonly termFrequencies: ReadonlyMap<string, number>;
  readonly length: number;
}

function toDocument(entry: CatalogueIndexEntry): Document {
  const termFrequencies = new Map<string, number>();
  const tokens = tokenize(entry.lexicalDocument);
  for (const token of tokens) {
    termFrequencies.set(token, (termFrequencies.get(token) ?? 0) + 1);
  }
  return { id: entry.id, termFrequencies, length: tokens.length };
}

/**
 * Score every entry against the query. Entries scoring zero (no query term
 * occurs in them) are OMITTED from the returned map rather than mapped to
 * zero — fusion ranks only what a channel actually retrieved, and a document
 * sharing no term with the query was not retrieved.
 *
 * An empty query retrieves nothing from this channel. That is correct and
 * not a degenerate case: with no text, ranking is decided entirely by the
 * structured filters of stage 1 and the boosts of stage 5.
 */
export function scoreBm25(
  queryText: string,
  entries: readonly CatalogueIndexEntry[],
): ChannelScores {
  const queryTerms = tokenize(queryText);
  const scores = new Map<ToolId, number>();
  if (queryTerms.length === 0 || entries.length === 0) return scores;

  const documents = entries.map(toDocument);
  const totalLength = documents.reduce((sum, doc) => sum + doc.length, 0);
  const averageLength = totalLength / documents.length;

  const documentFrequency = new Map<string, number>();
  const uniqueQueryTerms = new Set(queryTerms);
  for (const term of uniqueQueryTerms) {
    let count = 0;
    for (const doc of documents) {
      if (doc.termFrequencies.has(term)) count += 1;
    }
    documentFrequency.set(term, count);
  }

  const n = documents.length;
  for (const doc of documents) {
    let score = 0;
    for (const term of uniqueQueryTerms) {
      const tf = doc.termFrequencies.get(term);
      if (tf === undefined) continue;
      const df = documentFrequency.get(term) ?? 0;
      // Robertson/Sparck Jones IDF with the +0.5 smoothing and a +1 inside
      // the log, so a term occurring in EVERY document contributes a small
      // positive weight rather than a negative one. An unsmoothed BM25 can
      // score a document below zero for a ubiquitous term, which would let a
      // common word actively demote a correct tool.
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      const normalisation =
        averageLength === 0 ? 1 : 1 - BM25_B + (BM25_B * doc.length) / averageLength;
      score += idf * ((tf * (BM25_K1 + 1)) / (tf + BM25_K1 * normalisation));
    }
    if (score > 0) scores.set(doc.id, score);
  }
  return scores;
}
