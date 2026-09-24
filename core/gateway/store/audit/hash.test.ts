// MCPForge — the hash chain's own unit tests. W0-C2.

import { describe, expect, it } from 'vitest';
import {
  AUDIT_CHAIN_ALGORITHM,
  AUDIT_CHAIN_GENESIS,
  AUDIT_HASHED_COLUMNS,
  auditRowHash,
  canonicalAuditRow,
  type AuditHashValue,
} from './hash.js';
import { AUDIT_CALL } from '../schema/spec.js';

function row(overrides: Record<string, AuditHashValue> = {}): Record<string, AuditHashValue> {
  const base: Record<string, AuditHashValue> = {};
  for (const name of Object.keys(AUDIT_CALL.columns)) {
    base[name] = null;
  }
  return {
    ...base,
    id: '01930000-0000-7000-8000-000000000001',
    ts: '2026-08-30T10:00:00.000Z',
    caller_subject: 'bikash',
    consumer_id: 'portal-local',
    human_in_the_loop: true,
    tool_id: 'jde.ap.voucher.create',
    is_write: true,
    deployment_id: 'local',
    phase: 'execute',
    outcome: 'ok',
    prev_hash: AUDIT_CHAIN_GENESIS,
    row_hash: 'ignored',
    ...overrides,
  };
}

describe('the hashed column set', () => {
  it('covers every audit_call column except row_hash itself', () => {
    const all = Object.keys(AUDIT_CALL.columns);
    expect(AUDIT_HASHED_COLUMNS).toEqual(all.filter((c) => c !== 'row_hash'));
    expect(AUDIT_HASHED_COLUMNS).not.toContain('row_hash');
  });

  it('commits to prev_hash, which is what makes it a chain and not a checksum', () => {
    expect(AUDIT_HASHED_COLUMNS).toContain('prev_hash');
    expect(auditRowHash(row())).not.toBe(auditRowHash(row({ prev_hash: 'a'.repeat(64) })));
  });

  it('covers the Phase 5 who-block columns (02 §11.3)', () => {
    for (const column of [
      'consumer_id',
      'consumer_record_sha',
      'consumer_auth_method',
      'consumer_session_id',
      'human_in_the_loop',
    ]) {
      expect(AUDIT_HASHED_COLUMNS).toContain(column);
    }
  });
});

describe('the canonical form', () => {
  it('is domain-separated and versioned', () => {
    expect(canonicalAuditRow(row()).startsWith(AUDIT_CHAIN_ALGORITHM)).toBe(true);
  });

  it('is stable for the same content', () => {
    expect(auditRowHash(row())).toBe(auditRowHash(row()));
    expect(auditRowHash(row())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores row_hash, so the placeholder written before hashing cannot matter', () => {
    expect(auditRowHash(row({ row_hash: 'x' }))).toBe(auditRowHash(row({ row_hash: 'y' })));
  });

  it('changes when ANY covered column changes — the point of the whole exercise', () => {
    const baseline = auditRowHash(row());
    for (const column of AUDIT_HASHED_COLUMNS) {
      const kind = AUDIT_CALL.columns[column]?.kind;
      const tampered =
        kind === 'boolean'
          ? row({ [column]: false })
          : kind === 'integer'
            ? row({ [column]: 424242 })
            : row({ [column]: 'tampered' });
      expect(auditRowHash(tampered), `${column} is not covered by row_hash`).not.toBe(baseline);
    }
  });

  it('distinguishes null from the empty string and from the text "null"', () => {
    const asNull = auditRowHash(row({ error_code: null }));
    expect(auditRowHash(row({ error_code: '' }))).not.toBe(asNull);
    expect(auditRowHash(row({ error_code: 'null' }))).not.toBe(asNull);
  });

  it('cannot be forged by a value that fakes a field boundary', () => {
    // caller_subject swallowing the next field would collide if the separators
    // were ordinary punctuation.
    const a = auditRowHash(row({ caller_subject: 'a', caller_display: 'b' }));
    const b = auditRowHash(row({ caller_subject: 'ab', caller_display: null }));
    expect(a).not.toBe(b);
  });

  it('refuses a non-finite number rather than hashing "NaN"', () => {
    expect(() => auditRowHash(row({ row_count: Number.NaN }))).toThrow(/non-finite/);
  });
});

describe('the genesis convention', () => {
  it('is 64 zeros — a sentinel, not a null, so prev_hash stays NOT NULL', () => {
    expect(AUDIT_CHAIN_GENESIS).toBe('0'.repeat(64));
    expect(AUDIT_CALL.columns['prev_hash']?.notNull).toBe(true);
  });
});
