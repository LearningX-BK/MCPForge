// MCPForge — W0-Q9: the deterministic fake every test uses, so the suite needs no
// network and no key. It can also be scripted to misbehave (return YAML, other
// fields, an over-long answer) to prove the gate and `applySuggestion` hold.

import { withSuggest } from './providers.js';
import type { AuthoringModel, Prompt, SuggestResult } from './types.js';

export interface FakeOptions {
  readonly id?: string;
  readonly available?: boolean;
  /** Called with each prompt; return the raw model text. Default: a fixed, valid purpose. */
  readonly reply?: (prompt: Prompt) => string;
  /** Records every prompt sent, so a test can assert what left the "machine". */
  readonly sent?: Prompt[];
}

export function fakeModel(options: FakeOptions = {}): AuthoringModel {
  const id = options.id ?? 'fake';
  return withSuggest({
    id,
    available: options.available ?? true,
    async complete(prompt: Prompt): Promise<SuggestResult> {
      options.sent?.push(prompt);
      const text = options.reply?.(prompt) ?? 'Look up AP vouchers by supplier and amount.';
      return { ok: true, text, provenance: { provider: id, model: 'fake-1', requestId: `fake-${options.sent?.length ?? 0}` } };
    },
  });
}
