// MCPForge — @mcpforge/registry package root. W0-G1 lands the catalogue
// index build artefact and its boot-time loader (02 §5.4.1); W0-G2 lands the
// six-stage ranking pipeline over it (02 §5.4.2, §5.4.3) at `src/rank/**`.
// Stage 6 — the calibrated score floor, `no_tool` and the top-2 margin
// (02 §5.4.4, §5.5) — is W0-G3 and is a pluggable, ordered stage here, not an
// implementation.

export * from './index/index.js';
export * from './rank/index.js';
