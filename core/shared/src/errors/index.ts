// MCPForge — the error object every handler returns and every binding type maps
// onto. 02 §3.1.5. Errors are the closed taxonomy, never a bare Error on a
// caller-visible path (CLAUDE.md §5).

export * from './codes.js';

import { ERROR_CODES, ERROR_TAXONOMY, type ErrorCode } from './codes.js';

/** The wire shape from 02 §3.1.5's worked example. */
export interface ForgeErrorShape {
  readonly code: ErrorCode;
  /** Human- and agent-readable, specific to this occurrence. */
  readonly message: string;
  readonly condition: string;
  /** Non-empty, agent-actionable. Enforced at construction. */
  readonly next: string;
  readonly retryable: boolean;
  readonly correlationId: string;
}

export interface ForgeErrorOverrides {
  readonly condition?: string;
  readonly next?: string;
  readonly retryable?: boolean;
}

const CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

export function isErrorCode(value: string): value is ErrorCode {
  return CODE_SET.has(value);
}

export class ForgeError extends Error {
  readonly code: ErrorCode;
  readonly condition: string;
  readonly next: string;
  readonly retryable: boolean;
  readonly correlationId: string;

  constructor(shape: ForgeErrorShape) {
    super(shape.message);
    this.name = 'ForgeError';
    this.code = shape.code;
    this.condition = shape.condition;
    this.next = shape.next;
    this.retryable = shape.retryable;
    this.correlationId = shape.correlationId;
  }

  toJSON(): ForgeErrorShape {
    return {
      code: this.code,
      message: this.message,
      condition: this.condition,
      next: this.next,
      retryable: this.retryable,
      correlationId: this.correlationId,
    };
  }
}

/**
 * The only constructor for a caller-visible error. The taxonomy supplies the
 * default `condition`, `next` and `retryable`; a call site overrides them to
 * name the specific tool, reason, steward or approver.
 *
 * An empty or whitespace-only `next` override throws — "no dead ends" is
 * structural, not a review comment (CLAUDE.md non-negotiable #5).
 */
export function forgeError(
  code: ErrorCode,
  message: string,
  correlationId: string,
  overrides: ForgeErrorOverrides = {},
): ForgeError {
  const spec = ERROR_TAXONOMY[code];
  const next = overrides.next ?? spec.next;
  if (next.trim().length === 0) {
    throw new Error(
      `Every MCPForge error path must carry a non-empty, agent-actionable next (02 §3.1.5); ${code} was given an empty one.`,
    );
  }
  return new ForgeError({
    code,
    message,
    condition: overrides.condition ?? spec.condition,
    next,
    retryable: overrides.retryable ?? spec.retryable,
    correlationId,
  });
}
