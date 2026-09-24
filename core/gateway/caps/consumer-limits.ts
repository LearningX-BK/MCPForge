// MCPForge — consumer-level quota ceilings and the overlay that may tighten
// them. W0-N7, 02 §11.6 + §4.7's tighten-never-loosen discipline.
//
// 02 §11.6: "[`consumer_usage`] is what makes a consumer's declared `limits`
// enforceable (`RATE_LIMITED`, with a `next` naming the window and its
// reset)." A consumer's `limits` (`core/gateway/consumer/types.js`) are
// authored in git, reviewed and approved like every other consumer field —
// but 02 §4.7's cap discipline is explicit that NOTHING overlay-settable may
// be loosened past a compiled-in hard ceiling, and a per-deployment operator
// must still be able to tighten a specific consumer's limit further without a
// change proposal (an incident response action, not a governance change).
// This file gives consumer limits the SAME three-tier shape `./ceilings.ts` +
// `./overlay.ts` already give the six process-wide caps:
//
//   effective = min(overlayValue ?? consumerDeclared, consumerDeclared, ceiling)
//
// so an overlay can only ever narrow what the consumer's own approved record
// already declared, and neither the overlay nor the consumer record can ever
// exceed the ceiling below — which is a code change, not a deployment edit,
// exactly like `HARD_CEILINGS`.
//
// Only the two limits with a natural "window" and "reset" are ceilinged and
// enforced here — `callsPerMinute` (a sliding one-minute window,
// `./consumer-quota.ts`) and `writesPerDay` (the daily usage-rollup bucket,
// `../store/usage/**`). `concurrentSessions` is a live gauge, not a rate: it
// has no "window" to name in a `RATE_LIMITED` `next` and belongs with session
// establishment (W0-N2), not with this rollup-backed quota check — enforcing
// it is a gap for a human to schedule, not something this task invents an
// answer for. `operatingWindow` is a time-of-day string, not a numeric cap;
// 02 §11.6 names off-hours elevated-binding calls as anomaly pattern 2
// (W0-N8's detector substrate), not a hard refusal here.

export const CONSUMER_LIMIT_NAMES = ['callsPerMinute', 'writesPerDay'] as const;
export type ConsumerLimitName = (typeof CONSUMER_LIMIT_NAMES)[number];

export type ConsumerLimitValues = Readonly<Record<ConsumerLimitName, number>>;

/**
 * The compiled-in hard ceilings for consumer-level quotas. Generous Wave-0
 * defaults, same spirit as `HARD_CEILINGS` in `./ceilings.ts` — they bound the
 * worst case, not anyone's real operating limit. A consumer's own `limits`
 * (git, reviewed) tightens toward its real ceiling; an overlay may tighten
 * further still; nothing tightens these.
 */
export const CONSUMER_LIMIT_CEILINGS: ConsumerLimitValues = Object.freeze({
  callsPerMinute: 600,
  writesPerDay: 5_000,
});

/** `true` when `value` is a finite, non-negative integer — the only shape a limit value may take. */
export function isValidConsumerLimitValue(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
  );
}

/**
 * `overlays/<deployment>/consumer-limits.yaml` — VALUES ONLY, mirroring
 * `./overlay.ts`'s `caps.yaml` file shape:
 *
 *   apiVersion: mcpforge/v1
 *   kind: ConsumerLimits
 *   deployment: local
 *   limits:
 *     <consumerId>:
 *       callsPerMinute: 10
 *       writesPerDay: 50
 *
 * Every consumer id optional, every limit name under it optional — an overlay
 * tightens none, some, or all of them, for none, some, or all consumers.
 */
export interface ConsumerLimitsOverlayFile {
  readonly apiVersion: 'mcpforge/v1';
  readonly kind: 'ConsumerLimits';
  readonly deployment: string;
  readonly limits: Readonly<Record<string, Partial<Record<ConsumerLimitName, number>>>>;
}

export interface ConsumerLimitsParseError {
  readonly filePath: string;
  readonly message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse and structurally validate one already-read `consumer-limits.yaml`. */
export function parseConsumerLimitsOverlayFile(
  filePath: string,
  raw: unknown,
):
  | { readonly ok: true; doc: ConsumerLimitsOverlayFile }
  | { readonly ok: false; error: ConsumerLimitsParseError } {
  if (!isRecord(raw)) {
    return { ok: false, error: { filePath, message: 'must be a YAML mapping document' } };
  }
  if (raw['apiVersion'] !== 'mcpforge/v1') {
    return { ok: false, error: { filePath, message: 'apiVersion must be "mcpforge/v1"' } };
  }
  if (raw['kind'] !== 'ConsumerLimits') {
    return { ok: false, error: { filePath, message: 'kind must be "ConsumerLimits"' } };
  }
  if (typeof raw['deployment'] !== 'string' || raw['deployment'].length === 0) {
    return { ok: false, error: { filePath, message: 'deployment must be a non-empty string' } };
  }
  const limitsRaw = raw['limits'];
  if (limitsRaw !== undefined && !isRecord(limitsRaw)) {
    return {
      ok: false,
      error: { filePath, message: 'limits must be a mapping of consumer id -> limit overrides' },
    };
  }
  const limits: Record<string, Partial<Record<ConsumerLimitName, number>>> = {};
  for (const [consumerId, override] of Object.entries(
    (limitsRaw ?? {}) as Record<string, unknown>,
  )) {
    if (!isRecord(override)) {
      return {
        ok: false,
        error: { filePath, message: `limits.${consumerId} must be a mapping of limit name -> number` },
      };
    }
    const parsed: Partial<Record<ConsumerLimitName, number>> = {};
    for (const [name, value] of Object.entries(override)) {
      if (!(CONSUMER_LIMIT_NAMES as readonly string[]).includes(name)) {
        return {
          ok: false,
          error: {
            filePath,
            message: `limits.${consumerId}.${name} is not one of the overlay-settable consumer limits: ${CONSUMER_LIMIT_NAMES.join(', ')}`,
          },
        };
      }
      if (!isValidConsumerLimitValue(value)) {
        return {
          ok: false,
          error: { filePath, message: `limits.${consumerId}.${name} must be a non-negative integer` },
        };
      }
      parsed[name as ConsumerLimitName] = value;
    }
    limits[consumerId] = parsed;
  }

  return {
    ok: true,
    doc: { apiVersion: 'mcpforge/v1', kind: 'ConsumerLimits', deployment: raw['deployment'], limits },
  };
}

/**
 * THE merge, in one place, mirroring `./overlay.ts`'s
 * `resolveEffectiveCaps`. `effective = min(overlayValue ?? consumerDeclared,
 * consumerDeclared, ceiling)` — an overlay value above the consumer's own
 * declared limit, or above the compiled-in ceiling, is clamped rather than
 * honoured; a missing overlay value falls back to the consumer's declared
 * limit unchanged.
 */
export function resolveEffectiveConsumerLimits(
  consumerDeclared: Pick<ConsumerLimitValues, ConsumerLimitName>,
  overlay: Partial<Record<ConsumerLimitName, number>> | null,
): ConsumerLimitValues {
  const out = {} as Record<ConsumerLimitName, number>;
  for (const name of CONSUMER_LIMIT_NAMES) {
    const ceiling = CONSUMER_LIMIT_CEILINGS[name];
    const declared = Math.min(consumerDeclared[name], ceiling);
    const overlayValue = overlay?.[name];
    out[name] = overlayValue === undefined ? declared : Math.min(overlayValue, declared);
  }
  return Object.freeze(out);
}
