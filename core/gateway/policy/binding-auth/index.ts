// MCPForge — binding-type authorization (stage 6e′). W0-E3, 02 §11.4.
//
// `core/gateway/policy/binding-auth/**` is an OPUS_GUARDED_PATH in its own
// right (CLAUDE.md §6). W0-E3 lands the stage and its fail-closed grant check;
// W0-N3 lands the rest of the elevated-posture rule set and W0-N4 lands
// `standingAuthorization`'s resolution, its clock and its fail-closed fallback
// (./standing.ts).

export * from './posture.js';
export * from './grants.js';
export * from './standing.js';
export * from './elevated.js';
export * from './authorize.js';
