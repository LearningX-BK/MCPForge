// MCPForge — 02 §10.4 item 4: ids are UUIDv7, generated in the application.

import { describe, expect, it } from 'vitest';
import { isUuidv7, uuidv7, uuidv7Millis } from './id.js';

describe('uuidv7', () => {
  it('sets version 7 and the RFC 9562 variant bits', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(isUuidv7(uuidv7())).toBe(true);
    }
  });

  it('encodes the millisecond it was minted in', () => {
    const now = Date.UTC(2026, 7, 30, 12, 0, 0);
    expect(uuidv7Millis(uuidv7(now))).toBe(now);
  });

  it('sorts lexicographically in creation order — the index locality gen_random_uuid() does not give', () => {
    const ids = [uuidv7(1_700_000_000_000), uuidv7(1_700_000_000_001), uuidv7(1_700_000_001_000)];
    expect([...ids].sort()).toEqual(ids);
  });

  it('stays ordered within a single millisecond', () => {
    const burst = Array.from({ length: 500 }, () => uuidv7(1_700_000_000_000));
    expect([...burst].sort()).toEqual(burst);
    expect(new Set(burst).size).toBe(burst.length);
  });

  it('rejects a v4 uuid', () => {
    expect(isUuidv7('9f7c1f6e-6a2b-4c4d-8f1e-2b3c4d5e6f70')).toBe(false);
  });
});
