// MCPForge — UUIDv7, generated in the application. 02 §10.4 item 4:
// "Ids are generated **in the application as UUIDv7** (time-ordered, which also
// gives index locality that `gen_random_uuid()` does not). No database function
// dependency on either engine."
//
// This is the ONLY id generator for the runtime store. A store row id is never
// produced by `gen_random_uuid()`, by `randomUUID()` (that is v4 — unordered,
// and it would scatter the audit index W0-C2 depends on), or by an
// autoincrementing integer (which would not survive the move to Postgres, and
// would leak row counts).

// Web Crypto (`globalThis.crypto.getRandomValues`), not `node:crypto`: it is
// available in Node 19+ (this repo runs Node 22/24) AND in every browser, and
// this module must stay importable from portal client code without dragging
// a Node builtin into the browser bundle — see `../secrets/types.ts` for the
// identical reasoning applied to `node:util`.
function randomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

const HEX: readonly string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0'),
);

/** Monotonic guard: same-millisecond calls must still sort in creation order. */
let lastMillis = -1;
let lastSequence = 0;

/**
 * Generate a UUIDv7 (RFC 9562 §5.7): 48 bits of Unix epoch milliseconds, then
 * version 7, then 12 bits of a per-millisecond sequence, then variant, then 62
 * bits of randomness.
 *
 * Time-ordered, so ids sort by creation time in both dialects — which is what
 * gives the audit and session indexes their locality.
 */
export function uuidv7(now: number = Date.now()): string {
  const millis = Math.max(now, 0);
  if (millis === lastMillis) {
    lastSequence = (lastSequence + 1) & 0x0fff;
  } else {
    lastMillis = millis;
    // A random starting point per millisecond, kept clear of the top of the
    // 12-bit space so a burst inside one millisecond cannot wrap into the
    // next millisecond's ordering.
    {
      const seed = randomBytes(2);
      lastSequence = (((seed[0] ?? 0) << 8) | (seed[1] ?? 0)) & 0x07ff;
    }
  }

  const bytes = new Uint8Array(16);
  // 48-bit big-endian timestamp.
  bytes[0] = Math.floor(millis / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(millis / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(millis / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(millis / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(millis / 2 ** 8) & 0xff;
  bytes[5] = millis & 0xff;
  // Version 7 in the high nibble, then the 12-bit sequence.
  bytes[6] = 0x70 | ((lastSequence >>> 8) & 0x0f);
  bytes[7] = lastSequence & 0xff;

  const rand = randomBytes(8);
  bytes.set(rand, 8);
  // RFC 9562 variant bits (10xxxxxx).
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => HEX[b] ?? '00').join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidv7(value: string): boolean {
  return UUIDV7_PATTERN.test(value);
}

/** The millisecond timestamp encoded in a UUIDv7, for tests and diagnostics. */
export function uuidv7Millis(value: string): number {
  const hex = value.replace(/-/g, '').slice(0, 12);
  return Number.parseInt(hex, 16);
}
