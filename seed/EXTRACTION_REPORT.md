# Seed extraction report

**Source:** `C:\GenAIGenerated\LTM\MCP\mcpforge-console_1.html`
**Extracted:** 2026-08-29T20:23:01.867Z
**Extractor:** `tools/seed-extract.ts` (deleted immediately after this run — 02 §2.7 step 5)

Seed files are **not manifests**. They are authoring input for a human or
agent writing a real manifest for a tool entering a wave. A seed entry is
never deployed; a manifest is. See CLAUDE.md §4 and 02 §2.7.

## Counts — asserted, and this run failed closed if any missed

| Literal | Expected | Found |
|---|---|---|
| `SERVERS` | 42 | 42 |
| `TOOLS` | 150 | 150 |
| `RICH` | 12 | 12 |
| `PACKAGES` | 6 | 6 |
| `ENABLEMENT` | 7 | 7 |

## Fields preserved

- Every tool carries `bindingType`, `sens`, `functionalArea`, `technology`,
  `bindRef`, plus `id`, `server`, `title`, `desc`, `type`, `bind` (the
  human-readable binding path, e.g. `ebs.isg → AP_HOLDS_PKG.release_single_hold`).
- Every server carries its original console metadata (`app`, `appLabel`,
  `pillar`, `name`, `code`, `color`, `archetype`, `tags`, `owner`,
  `version`) plus the **derived** `slices` array (02 §2.7 step 3),
  recomputed here from `PACKAGES`/`PACKAGE_ORDER` exactly as the console
  computes it for `serverList`.
- Rich manifests carry `why`, `inputs`, `output`, `errors`, `evals`,
  `security`.
- Packages carry `label`, `blurb`, `servers` (the `full` package's
  `servers` is the literal string `"*"`, meaning "every server").
- Enablement entries carry every original field, including the per-app
  `probe: {resolved, disabled}` sub-object.

## Fields stripped (R11) — confirmed absent, in memory and on disk

`calls`, `agentName`, `agentPlatform` are removed from every tool. Two
independent checks in `tools/seed-extract.ts` confirmed none of the three
survived: one over the in-memory JSON before writing, one re-reading each
`seed/*.yaml` file from disk afterward.

## Judgment calls made during this extraction

1. **02 §2.7's "all five are single-line JSON literals (confirmed)" is
   inaccurate for two of them.** `SERVERS`, `TOOLS` and `RICH` really are
   single-line, double-quoted-key JSON and parse with `JSON.parse`
   unmodified. `PACKAGES` and `ENABLEMENT` are pretty-printed, multi-line
   JavaScript object/array literals — unquoted keys, single-quoted strings —
   and `JSON.parse` throws on both. The extractor tries `JSON.parse` first
   and falls back to evaluating the literal as JavaScript via `Function`,
   safe here because the source is a local, human-reviewed, trusted file
   read once, offline, by a script deleted immediately after use. This
   should be corrected in `02_TECHNICAL_ARCHITECTURE.md` §2.7 itself —
   flagging rather than silently fixing the document.
2. **The console's derived `agents` count and `status` (active/beta) field
   are dropped from `servers.yaml`.** `agents` is
   `new Set(tools.map(t => t.agentName)).size` — a count *derived from* the
   banned `agentName` field, the same illustrative-consumption-data flavour
   R11 names. Neither field is in 02 §2.7 step 3's explicit preserve list
   (`bindingType`, `sens`, `functionalArea`, `technology`, `bindRef`,
   `slices`), so omitting both is a small, documented implementation
   decision, not a judgment call with real blast radius.
3. **Enablement's per-app `probe: {resolved, disabled}` was kept, not
   stripped**, despite being the same illustrative-demo-probe flavour as the
   top-of-page strip R11 explicitly calls out (150/126/24/5). It is not one
   of the three fields the `done:` criterion names, and it carries real
   narrative value for a steward reading the seed (which applications were
   easy/hard to enable in the demo). Flagged prominently here and in
   `seed/enablement.yaml`'s own header comment so nobody mistakes it for a
   real probe run or a baseline.

## Next steps

Commit `seed/`. Delete `tools/seed-extract.ts` (done in this same task).
The console is frozen as a demo artefact from this commit onward — CLAUDE.md
§4: "Never read the concept console at runtime."
