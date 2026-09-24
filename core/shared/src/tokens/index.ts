// MCPForge — the pinned token counter. 02 §5.3 (budgets) and §5.7 ("Pinned
// tokenizer (cl100k_base, version-locked in core/shared/tokens.ts); the
// absolute values matter less than reproducibility, and CI compares like with
// like").
//
// LIBRARY CHOICE (a small implementation detail, decided here per CLAUDE.md §8):
// `js-tiktoken`, pinned to an exact version in package.json. It is pure
// JavaScript with the rank table shipped as data — no WASM, no node-gyp, no
// postinstall — so `pnpm install` from a clean clone needs no toolchain, which
// is the local-first Wave 0 constraint (CLAUDE.md §3.1). `tiktoken`/
// `@dqbd/tiktoken` are WASM builds and would put a binary artefact in the
// codegen path for no accuracy gain: both produce identical cl100k_base counts.
//
// Version-locking is TWO things, and both are needed:
//   1. an exact (non-range) dependency version, and
//   2. the golden-file test beside this file, which pins three known strings to
//      their exact counts. A tokenizer or library bump then fails a test with a
//      named diff instead of silently shifting every budget measurement.

import { Tiktoken } from 'js-tiktoken/lite';
import cl100k_base from 'js-tiktoken/ranks/cl100k_base';

/** The pinned encoding. Nothing in MCPForge may measure tokens with another. */
export const TOKENIZER_ENCODING = 'cl100k_base' as const;
export type TokenizerEncoding = typeof TOKENIZER_ENCODING;

const encoder = new Tiktoken(cl100k_base);

/**
 * The single token-counting function in the product. Used at CODEGEN time, not
 * at runtime — "a budget checked at runtime is a budget already blown"
 * (02 §5.3).
 */
export function countTokens(text: string): number {
  return encoder.encode(text).length;
}

/** Counts a JSON artefact as it would be serialised into a response. */
export function countJsonTokens(value: unknown): number {
  return countTokens(JSON.stringify(value));
}

/**
 * The four budgets of 02 §5.3 / CLAUDE.md §5, enforced at codegen.
 * `residentHard` is the 400-token hard cap behind the 200-token typical figure.
 */
export const TOKEN_BUDGETS = {
  card: 60,
  resident: 200,
  residentHard: 400,
  describe: 600,
  roleCoreSet: 1300,
} as const;

export type TokenBudgetName = keyof typeof TOKEN_BUDGETS;

export interface BudgetResult {
  readonly budget: TokenBudgetName;
  readonly limit: number;
  readonly counted: number;
  readonly withinBudget: boolean;
}

export function checkBudget(budget: TokenBudgetName, text: string): BudgetResult {
  const limit = TOKEN_BUDGETS[budget];
  const counted = countTokens(text);
  return { budget, limit, counted, withinBudget: counted <= limit };
}
