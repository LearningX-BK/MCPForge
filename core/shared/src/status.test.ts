// MCPForge — status.ts coverage. W0-J3.
//
// Every closed enum from Phase 2 must be present in status.ts with a
// non-empty srLabel (accessibility requirement). This test cross-checks
// each map's key set against the authoritative source for that enum rather
// than a hand-copied list, so the two cannot silently drift apart.

import { describe, expect, it } from 'vitest';
import { BINDING_TYPES, VERBS } from './manifest/common.js';
import { REVERSAL_CLASSES } from './manifest/tool.js';
import { ERROR_CODES } from './errors/codes.js';
import {
  BINDING_TYPE,
  CALL_OUTCOME,
  CALL_OUTCOMES,
  CALL_PHASE,
  CALL_PHASES,
  CHANGE_STATE,
  CHANGE_STATES,
  ENV_CLASS,
  ENV_CLASSES,
  ERROR_CODE,
  PROBE_STATUS,
  PROBE_STATUSES,
  REVERSAL_CLASS,
  VERB,
  type StatusEntry,
} from './status.js';

const VALID_TOKENS = new Set([
  'status-read',
  'status-ok',
  'status-write',
  'status-platform',
  'status-neutral',
  'status-danger',
]);

/** Every entry: non-empty label/srLabel/icon, and a token from the six-member set. */
function assertWellFormed(map: Readonly<Record<string, StatusEntry>>) {
  for (const [key, entry] of Object.entries(map)) {
    expect(entry.label.trim().length, `${key}.label must be non-empty`).toBeGreaterThan(0);
    expect(entry.srLabel.trim().length, `${key}.srLabel must be non-empty`).toBeGreaterThan(0);
    expect(entry.icon.trim().length, `${key}.icon must be non-empty`).toBeGreaterThan(0);
    expect(VALID_TOKENS.has(entry.token), `${key}.token "${entry.token}" is not one of the six semantic status tokens`).toBe(
      true,
    );
  }
}

describe('status.ts — one vocabulary, two products (03 §13.5)', () => {
  it('PROBE_STATUS covers all 7 closed members (W0-H4 done: criterion)', () => {
    expect(PROBE_STATUSES).toHaveLength(7);
    expect(Object.keys(PROBE_STATUS).sort()).toEqual([...PROBE_STATUSES].sort());
    assertWellFormed(PROBE_STATUS);
  });

  it('CHANGE_STATE covers every state in 03 §6.1 (including WITHDRAWN — see status.ts comment)', () => {
    expect(CHANGE_STATES).toHaveLength(9);
    expect(Object.keys(CHANGE_STATE).sort()).toEqual([...CHANGE_STATES].sort());
    assertWellFormed(CHANGE_STATE);
  });

  it('BINDING_TYPE covers all 5 binding types from manifest/common.ts (02 §3.7)', () => {
    expect(BINDING_TYPES).toHaveLength(5);
    expect(Object.keys(BINDING_TYPE).sort()).toEqual([...BINDING_TYPES].sort());
    assertWellFormed(BINDING_TYPE);
  });

  it('CALL_PHASE covers all 4 audit phases (02 §4.6): plan | execute | reject | reverse', () => {
    expect(CALL_PHASES).toHaveLength(4);
    expect(Object.keys(CALL_PHASE).sort()).toEqual([...CALL_PHASES].sort());
    assertWellFormed(CALL_PHASE);
  });

  it('CALL_OUTCOME covers all 5 audit outcomes (02 §4.6)', () => {
    expect(CALL_OUTCOMES).toHaveLength(5);
    expect(Object.keys(CALL_OUTCOME).sort()).toEqual([...CALL_OUTCOMES].sort());
    assertWellFormed(CALL_OUTCOME);
  });

  it('ERROR_CODE covers all 21 codes from the closed taxonomy (W0-A4)', () => {
    expect(ERROR_CODES).toHaveLength(21);
    expect(Object.keys(ERROR_CODE).sort()).toEqual([...ERROR_CODES].sort());
    assertWellFormed(ERROR_CODE);
  });

  it('REVERSAL_CLASS covers all 4 reversal classes (02 §3.1.4)', () => {
    expect(REVERSAL_CLASSES).toHaveLength(4);
    expect(Object.keys(REVERSAL_CLASS).sort()).toEqual([...REVERSAL_CLASSES].sort());
    assertWellFormed(REVERSAL_CLASS);
  });

  it('VERB covers all 19 closed verbs (CLAUDE.md §5)', () => {
    expect(VERBS).toHaveLength(19);
    expect(Object.keys(VERB).sort()).toEqual([...VERBS].sort());
    assertWellFormed(VERB);
  });

  it('ENV_CLASS covers all 4 environment classes (03 §11.1 / 02 §7.1)', () => {
    expect(ENV_CLASSES).toHaveLength(4);
    expect(Object.keys(ENV_CLASS).sort()).toEqual([...ENV_CLASSES].sort());
    assertWellFormed(ENV_CLASS);
  });

  it('every srLabel across every map is non-empty (accessibility requirement)', () => {
    const allMaps: Array<Readonly<Record<string, StatusEntry>>> = [
      PROBE_STATUS,
      CHANGE_STATE,
      BINDING_TYPE,
      CALL_PHASE,
      CALL_OUTCOME,
      ERROR_CODE,
      REVERSAL_CLASS,
      VERB,
      ENV_CLASS,
    ];
    for (const map of allMaps) {
      for (const entry of Object.values(map)) {
        expect(entry.srLabel.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
