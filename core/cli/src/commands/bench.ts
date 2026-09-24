// MCPForge — `forge bench`. W0-G6, 02 §5.9.
//
//   forge bench [--json] [--root <dir>] [--evals <dir>]
//
// THIS TASK'S SCOPE, STATED PLAINLY. 02 §5.9 describes five metrics
// (TTFC, VTC, DH, SA@1, MTB) and a CI regression gate. W0-G6 builds neither
// of those in full — that is W0-G7 (`deps: W0-G6`), which also adds the
// per-role/per-category TTFC breakdown and the committed baseline file. What
// this task builds is the three things ITS OWN `done:` criterion names:
//
//   1. A MOCK GATEWAY — `forge.find` (W0-G4) run over the REAL catalogue
//      index (`@mcpforge/registry/index`) and the REAL scoping code
//      (`@mcpforge/gateway/scope`, `@mcpforge/gateway/policy`,
//      `@mcpforge/gateway/meta`) — no live Oracle instance anywhere in the
//      call path, so this runs on every merge from Wave 0 onward.
//   2. The INTENTS-SKELETON GENERATOR — `evals/<server>/intents.yaml`,
//      created once per module server (never overwritten) with the negative
//      and near-miss intents auto-derived from the catalogue index, and the
//      ≥10 positives left as an explicit steward TODO (W0-HG7's job, never
//      fabricated here — CLAUDE.md §8).
//   3. RANK-1 MODE — SA@1 computed deterministically (no model in the loop)
//      from whatever `evals/**/intents.yaml` exist.
//
// `forge bench --json`'s eventual five-metric, per-category, per-role,
// CI-gated shape is W0-G7's to build on top of `runRank1`/`computeSa1` below
// — those two functions are the seam this task leaves for it, not a stand-in
// implementation of it.
//
// SA@1 ITSELF NEVER DISPATCHES A BINDING. `forge.find` is pure discovery: it
// ranks and returns cards, and never calls an adapter. That is *why* rank-1
// mode needs no live target and no recorded-target fixture set (the mock
// harness `@mcpforge/mocks`, W0-H6, exists for tests that DO dispatch, e.g.
// contract tests) — there is nothing to record a response for here.
//
// JUDGMENT CALLS, EACH FLAGGED (CLAUDE.md §8):
//
//   (a) MODULE-SERVER GROUPING. `evals/<server>/intents.yaml` groups by
//       "module server" (02 §5.9), but `CatalogueIndexFilters` carries no
//       `serverId` field — the registry index deliberately does not (see
//       `core/registry/src/index/types.ts`'s own flagged note on
//       `packageTags`). This module derives a server id as `${app}-${module}`
//       (matching the shape the scope fixtures already use, e.g. `jde-ap`),
//       documented here rather than guessed silently. A human should confirm
//       this is the right grouping once real `Server` manifests exist and
//       carry their own id (02 §2's Server manifest kind).
//   (b) MOCK-GATEWAY VISIBILITY. The mock gateway grants every role full
//       visibility of every catalogue tool (deployed, granted, consumer-
//       authorized, probe-resolved, no kill flags). W0-E2/E3 already prove the
//       six-way intersection and the ten-stage chain narrow correctly in
//       their own suites; re-deriving a narrower mock here would make SA@1
//       measure incidental scope gaps instead of ranking quality, which is
//       not what 02 §5.9 asks this harness to measure. A role named on an
//       intent that appears nowhere in the index still resolves (empty
//       grant), so a role typo shows up as a miss, not a crash.
//   (c) NEAR-MISS AND NEGATIVE AUTO-DERIVATION ARE TEMPLATED, NOT AUTHORED.
//       They exist so the file is never empty and `forge validate`'s
//       composition gate (§10.1) has something to count; they are not a
//       substitute for the steward's own near-miss pairs and out-of-catalogue
//       negatives, which the generated file says so, in words, in a comment
//       block.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  buildCatalogueIndex,
  CatalogueIndexLoadError,
  loadCatalogueIndex,
  type CatalogueIndex,
  type CatalogueIndexEntry,
} from '@mcpforge/registry/index/server';
import {
  forgeFind,
  type MetaCardSource,
  type MetaContext,
  type MetaDetailSource,
} from '@mcpforge/gateway/meta';
import type {
  ConsumerAuthorizationView,
  ProbeStatus,
  ScopeContext,
  ToolId,
} from '@mcpforge/gateway/scope';
import { inMemoryRuntimeFlags, staticProbeStatuses } from '@mcpforge/gateway/scope';
import type { PolicyCatalogueEntry, PolicyContext, PolicyRoleView } from '@mcpforge/gateway/policy';
import type { Principal } from '@mcpforge/gateway/identity';

// --------------------------------------------------------------------------
// Intents: the shape, 02 §5.9 verbatim.
// --------------------------------------------------------------------------

export const BENCH_CATEGORIES = ['direct', 'near_miss', 'negative', 'sod_negative'] as const;
export type BenchCategory = (typeof BENCH_CATEGORIES)[number];

/** One `evals/<server>/intents.yaml` entry, 02 §5.9's schema verbatim. */
export interface BenchIntent {
  readonly intent: string;
  /** A tool id, or `"none"` for a negative/sod_negative intent (02 §5.9's `expect: none`). */
  readonly expect: string;
  readonly category: BenchCategory;
  readonly role: string;
  readonly cold?: boolean;
  readonly author?: string;
}

export class IntentsParseError extends Error {
  constructor(
    public readonly filePath: string,
    reason: string,
  ) {
    super(`Failed to parse bench intents from ${filePath}: ${reason}`);
    this.name = 'IntentsParseError';
  }
}

function isBenchCategory(v: unknown): v is BenchCategory {
  return typeof v === 'string' && (BENCH_CATEGORIES as readonly string[]).includes(v);
}

/** Parse and validate one `intents.yaml` file's content. Comments and blank documents are fine — an empty file parses to zero intents, not an error, so a freshly generated skeleton with only auto-derived entries is valid. */
export function parseIntentsYaml(raw: string, filePath: string): readonly BenchIntent[] {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new IntentsParseError(filePath, err instanceof Error ? err.message : String(err));
  }
  if (parsed === null || parsed === undefined) return [];
  if (!Array.isArray(parsed)) {
    throw new IntentsParseError(filePath, 'top-level document must be a YAML sequence of intents');
  }
  return parsed.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new IntentsParseError(filePath, `intents[${i}] is not a mapping`);
    }
    const r = raw as Record<string, unknown>;
    if (typeof r['intent'] !== 'string' || r['intent'].trim().length === 0) {
      throw new IntentsParseError(filePath, `intents[${i}].intent must be a non-empty string`);
    }
    if (typeof r['expect'] !== 'string' || r['expect'].trim().length === 0) {
      throw new IntentsParseError(filePath, `intents[${i}].expect must be a non-empty string`);
    }
    if (!isBenchCategory(r['category'])) {
      throw new IntentsParseError(
        filePath,
        `intents[${i}].category must be one of ${BENCH_CATEGORIES.join(', ')}`,
      );
    }
    if (typeof r['role'] !== 'string' || r['role'].trim().length === 0) {
      throw new IntentsParseError(filePath, `intents[${i}].role must be a non-empty string`);
    }
    const out: {
      intent: string;
      expect: string;
      category: BenchCategory;
      role: string;
      cold?: boolean;
      author?: string;
    } = {
      intent: r['intent'],
      expect: r['expect'],
      category: r['category'],
      role: r['role'],
    };
    if (typeof r['cold'] === 'boolean') out.cold = r['cold'];
    if (typeof r['author'] === 'string') out.author = r['author'];
    return out;
  });
}

// --------------------------------------------------------------------------
// The intents-skeleton generator.
// --------------------------------------------------------------------------

/** Judgment call (a) above: `${app}-${module}`, matching the scope fixtures' own `serverId` shape (e.g. `jde-ap`). */
export function serverIdFor(entry: CatalogueIndexEntry): string {
  return `${entry.filters.app}-${entry.filters.module}`;
}

export function groupByServer(
  index: CatalogueIndex,
): ReadonlyMap<string, readonly CatalogueIndexEntry[]> {
  const groups = new Map<string, CatalogueIndexEntry[]>();
  for (const entry of index.tools) {
    const serverId = serverIdFor(entry);
    const group = groups.get(serverId);
    if (group) group.push(entry);
    else groups.set(serverId, [entry]);
  }
  return groups;
}

/** The entity part of a tool id — `{app}.{module}.{entity}.{verb}` (CLAUDE.md §5). */
function entityOf(entry: CatalogueIndexEntry): string {
  return entry.filters.entity;
}

function firstRole(entries: readonly CatalogueIndexEntry[]): string {
  for (const entry of entries) {
    const role = entry.filters.roles[0];
    if (role !== undefined) return role;
  }
  return 'unassigned';
}

/**
 * Out-of-catalogue negatives (02 §5.9: `expect: none`). Templated on purpose
 * — see judgment call (c) — so the skeleton is never empty and never invents
 * a business scenario the steward did not author.
 */
const NEGATIVE_TEMPLATES: readonly string[] = [
  'What is the weather like today?',
  "Change this employee's payroll tax withholding.",
];

export function deriveNegativeIntents(entries: readonly CatalogueIndexEntry[]): BenchIntent[] {
  const role = firstRole(entries);
  return NEGATIVE_TEMPLATES.map((intent) => ({
    intent,
    expect: 'none',
    category: 'negative',
    role,
  }));
}

/**
 * Near-miss pairs (02 §5.9: "pairs with voucher.search"). For every entity
 * with two or more tools in this server, one auto-derived intent naming the
 * entity generically, expecting whichever tool's verb is `get` (the
 * canonical "show me that one again" shape); when no `get` exists, the
 * alphabetically-first tool for that entity, so the choice is deterministic.
 */
export function deriveNearMissIntents(entries: readonly CatalogueIndexEntry[]): BenchIntent[] {
  const byEntity = new Map<string, CatalogueIndexEntry[]>();
  for (const entry of entries) {
    const list = byEntity.get(entityOf(entry));
    if (list) list.push(entry);
    else byEntity.set(entityOf(entry), [entry]);
  }
  const out: BenchIntent[] = [];
  for (const [entity, group] of [...byEntity.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
    const target = sorted.find((e) => e.filters.verb === 'get') ?? sorted[0]!;
    out.push({
      intent: `Show me that ${entity.replace(/_/g, ' ')} again`,
      expect: target.id,
      category: 'near_miss',
      role: target.filters.roles[0] ?? firstRole(group),
    });
  }
  return out;
}

const STEWARD_TODO_COMMENT = `# ---------------------------------------------------------------------------
# STEWARD TODO (CLAUDE.md §8 — not fabricated by codegen; 02 §5.9, TASKS.md
# W0-HG7): add >= 10 positive (category: direct) intents below, authored by
# this module's STEWARD, not by whoever built its tools. Composition rules
# (02 §5.9, corrected by 02 §10):
#   - >= 20% of ALL intents in this file must be category: near_miss
#   - >= 10% of ALL intents in this file must be category: negative
#   - >= 30% of POSITIVE intents must resolve to a write tool
#   - at least one category: sod_negative per role that has an SoD pair
# Example shape (02 §5.9):
#   - intent: "Book the invoice we just got from ACME against PO 451"
#     expect: jde.ap.voucher.create
#     category: direct
#     role: p2p
#     cold: false
#     author: <steward>
# ---------------------------------------------------------------------------
`;

function intentYamlLine(intent: BenchIntent): string {
  const lines = [
    `  - intent: ${JSON.stringify(intent.intent)}`,
    `    expect: ${JSON.stringify(intent.expect)}`,
    `    category: ${intent.category}`,
    `    role: ${intent.role}`,
  ];
  if (intent.cold !== undefined) lines.push(`    cold: ${intent.cold}`);
  if (intent.author !== undefined) lines.push(`    author: ${JSON.stringify(intent.author)}`);
  return lines.join('\n');
}

/** Build the full skeleton document body for one server: the auto-derived array, then the steward's TODO block. */
export function buildIntentsSkeleton(entries: readonly CatalogueIndexEntry[]): string {
  const negatives = deriveNegativeIntents(entries);
  const nearMisses = deriveNearMissIntents(entries);
  const header = [
    '# Auto-generated ONCE by `forge bench` (W0-G6, 02 §5.9). Never overwritten —',
    '# this file is safe to hand-edit; re-running `forge bench` will not touch it',
    '# again once it exists.',
    '#',
    '# negatives and near-miss pairs below are auto-derived from the catalogue',
    '# index; the positives are the steward\'s to add (see the TODO block).',
    '',
  ].join('\n');
  const auto = [...negatives, ...nearMisses].map(intentYamlLine).join('\n');
  return `${header}${auto.length > 0 ? `${auto}\n` : ''}${STEWARD_TODO_COMMENT}`;
}

export interface GenerateIntentsSkeletonsResult {
  readonly created: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * Create `evals/<server>/intents.yaml` for every module server represented in
 * the catalogue index that does not already have one. NEVER overwrites an
 * existing file — that is the whole point of "codegen creates it once"
 * (TASKS.md W0-G6 `done:`).
 */
export function generateIntentsSkeletons(
  index: CatalogueIndex,
  evalsRoot: string,
): GenerateIntentsSkeletonsResult {
  const created: string[] = [];
  const skipped: string[] = [];
  for (const [serverId, entries] of groupByServer(index)) {
    const dir = join(evalsRoot, serverId);
    const filePath = join(dir, 'intents.yaml');
    if (existsSync(filePath)) {
      skipped.push(filePath);
      continue;
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, buildIntentsSkeleton(entries), 'utf8');
    created.push(filePath);
  }
  return { created, skipped };
}

// --------------------------------------------------------------------------
// The mock gateway: `forge.find` over the real index + the real scoping code.
// --------------------------------------------------------------------------

const BENCH_PACKAGE_ID = 'bench-all';
const BENCH_DEPLOYMENT_ID = 'bench';
const BENCH_CONSUMER_ID = 'bench-harness';
const BENCH_PRINCIPAL: Principal = {
  subject: 'bench-harness',
  displayName: 'forge bench',
  groups: [],
  idp: 'local',
  authTime: new Date(0),
  amr: ['bench'],
};

function policyEntryFor(entry: CatalogueIndexEntry): PolicyCatalogueEntry {
  return {
    toolId: entry.id,
    serverId: serverIdFor(entry),
    bindingType: entry.filters.bindingType as PolicyCatalogueEntry['bindingType'],
    sensitivity: entry.filters.sensitivity as PolicyCatalogueEntry['sensitivity'],
    write: entry.filters.write,
    bindingRef: entry.id,
    toolVersion: '0.0.0',
  };
}

/**
 * All role ids the index itself names, plus (when given) one more — the role
 * an intent asks for. A role absent from the index still gets an (empty)
 * scope so an unrecognised role in an intents.yaml file is a deterministic
 * miss, not a crash — see judgment call (b) above.
 */
function allRoleIds(index: CatalogueIndex, extra?: string): readonly string[] {
  const roles = new Set<string>();
  for (const entry of index.tools) for (const r of entry.filters.roles) roles.add(r);
  if (extra !== undefined) roles.add(extra);
  return [...roles];
}

function fullyPermissiveConsumer(index: CatalogueIndex, roleIds: readonly string[]): ConsumerAuthorizationView {
  const bindingTypes = new Set<string>(['rest', 'database', 'plsql', 'function', 'wrapped-vendor']);
  for (const entry of index.tools) bindingTypes.add(entry.filters.bindingType);
  return {
    consumerId: BENCH_CONSUMER_ID,
    effectiveStatus: 'active',
    authorizations: {
      bindingTypes: [...bindingTypes],
      // Highest rank in `sensitivityRank`'s declared order (`core/gateway/scope/sensitivity.ts`) — the mock never narrows on sensitivity; see judgment call (b).
      maxSensitivity: 'personal',
      writeAllowed: true,
      roles: [...roleIds],
      packages: [BENCH_PACKAGE_ID],
    },
    attestation: { humanInTheLoop: true },
  };
}

function buildScopeContext(index: CatalogueIndex, role: string): ScopeContext {
  const allToolIds = new Set<ToolId>(index.tools.map((t) => t.id));
  const roleIds = allRoleIds(index, role);
  const roleScopes = new Map<string, ReadonlySet<ToolId>>(roleIds.map((r) => [r, allToolIds]));
  const probeAllResolved = new Map<ToolId, ProbeStatus>(
    index.tools.map((t) => [t.id, 'resolved' as ProbeStatus]),
  );
  return {
    deployment: { deploymentId: BENCH_DEPLOYMENT_ID, packageIds: [BENCH_PACKAGE_ID] },
    packageSelections: new Map([[BENCH_PACKAGE_ID, allToolIds]]),
    roleScopes,
    session: {
      principal: BENCH_PRINCIPAL,
      heldRoleIds: [role],
      consumer: fullyPermissiveConsumer(index, roleIds),
      // W0-N10 — the bench harness measures discovery, not audit, and writes no
      // audit row; this is the shape a real session carries, with a placeholder
      // sha that names itself as one rather than imitating a registration.
      consumerSession: {
        consumerId: BENCH_CONSUMER_ID,
        recordSha: '0'.repeat(64),
        authMethod: 'bench-harness',
        consumerSessionId: 'bench',
      },
      activation: { mode: 'default' },
    },
    probe: staticProbeStatuses(probeAllResolved),
    flags: inMemoryRuntimeFlags([]),
    now: new Date(),
  };
}

function buildPolicyContext(index: CatalogueIndex, role: string): PolicyContext {
  const roleIds = allRoleIds(index, role);
  const roles = new Map<string, PolicyRoleView>(
    roleIds.map((r) => [
      r,
      { roleId: r, sensitivityCeiling: 'personal', writeAllowed: true, bindingGrants: [] },
    ]),
  );
  return {
    scope: buildScopeContext(index, role),
    catalogue: index.tools.map(policyEntryFor),
    roles,
    consumerBindingGrants: [],
    runtime: {
      rateLimiter: { check: () => ({ allowed: true }) },
      argumentValidator: { validate: () => ({ valid: true }) },
      guardrails: { evaluate: () => ({ breached: false }) },
      writeGate: { evaluate: () => ({ kind: 'not-a-write' }) },
      idempotency: { lookup: () => ({ kind: 'proceed' }) },
    },
  };
}

const NO_CARDS: MetaCardSource = { cardFor: () => null };
const NO_DETAILS: MetaDetailSource = { detailFor: () => null };

/**
 * The mock gateway. One `MetaContext` per role, built from the REAL
 * catalogue index and the REAL scope/policy shapes — everything downstream
 * of it (`resolveDiscovery`, `resolveScope`, `rankTools`, `evaluateFloor`) is
 * the production code, unmodified and unmocked. Only the world it is handed
 * (deployment, grants, consumer, probe, kill flags) is synthetic, and it is
 * synthetic in exactly one direction: maximally permissive (judgment call b).
 */
export function mockMetaContextFor(index: CatalogueIndex, role: string): MetaContext {
  return {
    index,
    policy: buildPolicyContext(index, role),
    cards: NO_CARDS,
    details: NO_DETAILS,
    probeMessages: { agentMessageFor: () => null },
    notifier: { sendToolListChanged: () => undefined },
  };
}

// --------------------------------------------------------------------------
// Rank-1 mode.
// --------------------------------------------------------------------------

export interface Rank1Result {
  readonly intent: BenchIntent;
  /** The rank-1 tool id `forge.find` returned, or `"none"` for a `no_tool` verdict. */
  readonly actual: string;
  readonly hit: boolean;
}

/**
 * Run one intent through the mock gateway's `forge.find` and compare its
 * rank-1 result against `intent.expect`. Deterministic: no model in the
 * loop, matching 02 §5.9's rank-1 mode exactly.
 */
export function runIntent(index: CatalogueIndex, intent: BenchIntent): Rank1Result {
  const ctx = mockMetaContextFor(index, intent.role);
  const response = forgeFind(ctx, { query: intent.intent, limit: 10 });
  const actual = response.result === 'no_tool' ? 'none' : (response.tools[0]?.card['id'] as string | undefined) ?? 'none';
  return { intent, actual, hit: actual === intent.expect };
}

export function runRank1(
  index: CatalogueIndex,
  intents: readonly BenchIntent[],
): readonly Rank1Result[] {
  return intents.map((intent) => runIntent(index, intent));
}

export interface CategoryBreakdown {
  readonly n: number;
  readonly hits: number;
  readonly sa1: number;
}

/**
 * One `hit === false` result, detailed enough to answer 03 §5.3 Insights'
 * "which near-miss pair was confused, which negative was answered with a
 * tool" without inventing anything `Rank1Result` doesn't already carry:
 * `expect`/`actual` are both real tool ids (or `"none"`) straight from the
 * intent and the mock gateway's actual `forge.find` response — for a
 * `near_miss` intent that pair IS the confused pair, and for a
 * `negative`/`sod_negative` intent `actual !== "none"` IS the tool it was
 * wrongly answered with.
 */
export interface FailingIntent {
  readonly intent: string;
  readonly category: BenchCategory;
  readonly role: string;
  /** The tool id the intent should have resolved to, or `"none"`. */
  readonly expect: string;
  /** The tool id `forge.find` actually returned rank-1, or `"none"`. */
  readonly actual: string;
}

function failingIntentsOf(results: readonly Rank1Result[]): readonly FailingIntent[] {
  return results
    .filter((r) => !r.hit)
    .map((r) => ({
      intent: r.intent.intent,
      category: r.intent.category,
      role: r.intent.role,
      expect: r.intent.expect,
      actual: r.actual,
    }));
}

export interface Sa1Report {
  readonly n: number;
  readonly hits: number;
  /** SA@1 over every intent. `NaN` is never returned — an empty suite reports `sa1: 1` (vacuously true) with `n: 0`, matching the "no regression possible on an empty suite" reading `forge ci` needs. */
  readonly sa1: number;
  readonly byCategory: Readonly<Record<BenchCategory, CategoryBreakdown>>;
  /** Every `hit === false` intent from this run, informational only — never a regression-gate input (the `sa1`/gate numbers above are that). See `FailingIntent`. */
  readonly failingIntents: readonly FailingIntent[];
}

function categoryBreakdown(results: readonly Rank1Result[]): Readonly<Record<BenchCategory, CategoryBreakdown>> {
  const out = {} as Record<BenchCategory, CategoryBreakdown>;
  for (const category of BENCH_CATEGORIES) {
    const inCategory = results.filter((r) => r.intent.category === category);
    const hits = inCategory.filter((r) => r.hit).length;
    out[category] = {
      n: inCategory.length,
      hits,
      sa1: inCategory.length === 0 ? 1 : hits / inCategory.length,
    };
  }
  return out;
}

export function computeSa1(results: readonly Rank1Result[]): Sa1Report {
  const hits = results.filter((r) => r.hit).length;
  return {
    n: results.length,
    hits,
    sa1: results.length === 0 ? 1 : hits / results.length,
    byCategory: categoryBreakdown(results),
    failingIntents: failingIntentsOf(results),
  };
}

// ==========================================================================
// W0-G7 — the other four metrics (TTFC, VTC, DH, MTB), the per-role and
// per-category breakdowns, the absolute gates, and the machine-readable
// summary the CI regression gate compares against a committed baseline.
// 02 §5.7 (the arithmetic and the gate numbers), §5.10 (the one corrected
// number), §5.9 (rank-1 mode is the gate, metrics computed analytically from
// the actual response payloads with the pinned tokenizer).
//
// EVERY NUMBER BELOW IS A DOCUMENT'S, NOT THIS FILE'S:
//   TTFC ≤2,000 core-hit ................ 02 §5.7 Case A
//   TTFC ≤4,000 cold .................... 02 §5.7 Case B
//   VTC ≤16 default / 30 hard cap ....... 02 §5.10 (imported from
//                                         `@mcpforge/gateway/meta`'s vtc.ts,
//                                         which already owns them — not
//                                         re-declared here)
//   DH median ≤2, p95 ≤3 ................ 02 §5.7 "the other three metrics"
//   MTB card 60 / resident 400 /
//       describe 600 / role core 1,300 .. 02 §5.3, measured by W0-G5's gate
//                                         (`runTokenBudgetGate`) and merely
//                                         re-reported here, so bench and
//                                         codegen can never disagree.
//
// JUDGMENT CALLS, EACH FLAGGED (CLAUDE.md §8):
//
//   (d) THE 150-TOKEN SESSION PREAMBLE. 02 §5.7's two tables both open with
//       "`initialize` + server info | ~150". That is a document-fixed
//       estimate, not something this harness can measure — there is no live
//       transport in rank-1 mode. It is therefore a NAMED CONSTANT
//       (`SESSION_INIT_TOKENS`) and the report carries `assumptions` saying
//       so in words, so no reader mistakes it for a measurement.
//   (e) THE DESCRIBE CHARGE ON A COLD INTENT. Case B charges one
//       `forge.describe`. The bench's mock gateway has no detail source
//       (`NO_DETAILS`), so when W0-G5's measurement of the tool's real
//       describe response is available it is used, and when it is not the
//       ≤600 BUDGET CEILING is charged instead — a conservative upper bound,
//       never an invented midpoint. Which of the two was used is reported
//       per bucket as `describeCharge`.
//   (f) THE RESIDENT SET IS THE ROLE'S COMPILED `coreTools`. Warm TTFC needs
//       "what `tools/list` costs for this role", which is the meta-tools plus
//       the role's core set (02 §5.7 Case A). That sum is W0-G5's
//       `runTokenBudgetGate` per-role measurement, reused rather than
//       recomputed. A role with NO Role manifest in the repo (today: all of
//       them — `roles/` is empty until Track I) contributes 0 and is reported
//       with `residentSetKnown: false`, so a zero never reads as "measured
//       and free".
//   (g) TTFC/DH ARE COMPUTED OVER INTENTS THAT HAVE A CORRECT CALL. A
//       `negative`/`sod_negative` intent's correct outcome is a refusal, so
//       there is no "first correct call" to count tokens or hops to. They are
//       counted (`n`) and excluded from the TTFC and DH statistics, and the
//       report says so.
//   (h) THE GATE IS ON THE MAXIMUM, NOT THE MEAN. Rank-1 mode is fully
//       deterministic (02 §5.9), so "the worst intent in the suite" is a
//       stable number and the strictest honest reading of "TTFC ≤ 2,000".
//       Mean/median/p95 are reported beside it for the checkpoint.

import { countJsonTokens, TOKEN_BUDGETS } from '@mcpforge/shared/tokens';
import { metaResidentWireShape, META_TOOL_COUNT, VTC_DEFAULT, VTC_HARD_CAP } from '@mcpforge/gateway/meta';
import { runTokenBudgetGate, type ToolTokenMeasurement } from '@mcpforge/codegen/budget/server';

/** 02 §5.7, both tables' first row: `initialize` + server info. Judgment call (d). */
export const SESSION_INIT_TOKENS = 150;

/** 02 §5.7 Case A — the gate, and it applies to core-hit intents only. */
export const TTFC_CORE_HIT_BUDGET = 2000;

/** 02 §5.7 Case B — the cold-session gate. */
export const TTFC_COLD_BUDGET = 4000;

/** 02 §5.7: "DH — median 2 ... 3 at p95. Meets median ≤2, p95 ≤3." */
export const DH_MEDIAN_TARGET = 2;
export const DH_P95_TARGET = 3;

/** How an intent reaches its tool. `cold` is the intent's own `cold: true` (02 §5.9's schema). */
export type TtfcBucket = 'coreHit' | 'coreMiss' | 'cold';

export interface BenchTokenModel {
  /** Measured, not assumed: `countJsonTokens(metaResidentWireShape())` (W0-G4). */
  readonly metaResidentTokens: number;
  /** Per-role compiled core set, from W0-G5's gate. Absent role = no Role manifest. */
  readonly roles: Readonly<Record<string, { readonly coreTools: readonly string[]; readonly coreSetTokens: number }>>;
  /** Per-tool card/resident/describe measurements, from W0-G5's gate. */
  readonly tools: Readonly<Record<string, ToolTokenMeasurement>>;
}

/**
 * Build the token model for a repo. Everything measurable is measured with
 * the ONE pinned counter, through the ONE existing measurement path
 * (W0-G5's `runTokenBudgetGate`) — this module never re-implements a card,
 * resident or describe builder.
 */
export function buildTokenModel(repoRoot: string): BenchTokenModel {
  const metaResidentTokens = countJsonTokens(metaResidentWireShape());
  try {
    const budget = runTokenBudgetGate(repoRoot);
    return { metaResidentTokens, roles: budget.roles, tools: budget.tools };
  } catch {
    // A root with no manifests/ or roles/ tree at all (a bare fixture root, a
    // fresh clone before Track I). The four meta-tools are still real and
    // still measured; everything else is reported as unknown, and
    // `assumptions` says so in words. This is deliberately NOT a hard failure:
    // stage 2 (`forge validate`) owns manifest structure, and a benchmark that
    // refuses to run because a repo has no tools yet would block Wave 0's own
    // bring-up.
    return { metaResidentTokens, roles: {}, tools: {} };
  }
}

export interface IntentMeasurement {
  readonly intent: BenchIntent;
  readonly result: Rank1Result;
  readonly bucket: TtfcBucket | null;
  /** `null` for a negative/sod_negative intent — judgment call (g). */
  readonly ttfc: number | null;
  readonly dh: number | null;
  /** The `forge.find` round trip actually measured for this intent (0 when none was needed). */
  readonly findTokens: number;
  /** Which charge judgment call (e) applied on this intent. */
  readonly describeCharge: 'none' | 'measured' | 'budget-ceiling';
}

/** 02 §5.7 Case B charges "5 cards" — `forge.find`'s documented default limit (02 §5.2). */
const FIND_LIMIT_FOR_BENCH = 5;

function findRoundTripTokens(index: CatalogueIndex, intent: BenchIntent): number {
  const ctx = mockMetaContextFor(index, intent.role);
  const input = { query: intent.intent, limit: FIND_LIMIT_FOR_BENCH };
  return countJsonTokens(input) + countJsonTokens(forgeFind(ctx, input));
}

function residentTokensForRole(model: BenchTokenModel, role: string): number {
  return model.roles[role]?.coreSetTokens ?? 0;
}

function coreToolsForRole(model: BenchTokenModel, role: string): readonly string[] {
  return model.roles[role]?.coreTools ?? [];
}

/**
 * One intent's TTFC and DH, per 02 §5.7's two tables.
 *
 *   cold      init + meta + find round trip + describe        DH 3
 *   coreHit   init + meta + role core set                     DH 1
 *   coreMiss  init + meta + role core set + find round trip   DH 2
 */
export function measureIntent(
  index: CatalogueIndex,
  model: BenchTokenModel,
  intent: BenchIntent,
  result: Rank1Result,
): IntentMeasurement {
  const hasCorrectCall = intent.expect !== 'none';
  if (!hasCorrectCall) {
    return { intent, result, bucket: null, ttfc: null, dh: null, findTokens: 0, describeCharge: 'none' };
  }

  const base = SESSION_INIT_TOKENS + model.metaResidentTokens;

  if (intent.cold === true) {
    const find = findRoundTripTokens(index, intent);
    const measured = model.tools[intent.expect]?.describeTokens;
    const describe = measured ?? TOKEN_BUDGETS.describe;
    return {
      intent,
      result,
      bucket: 'cold',
      ttfc: base + find + describe,
      dh: 3,
      findTokens: find,
      describeCharge: measured === undefined ? 'budget-ceiling' : 'measured',
    };
  }

  const resident = residentTokensForRole(model, intent.role);
  const coreHit = coreToolsForRole(model, intent.role).includes(intent.expect);
  if (coreHit) {
    return {
      intent,
      result,
      bucket: 'coreHit',
      ttfc: base + resident,
      dh: 1,
      findTokens: 0,
      describeCharge: 'none',
    };
  }
  const find = findRoundTripTokens(index, intent);
  return {
    intent,
    result,
    bucket: 'coreMiss',
    ttfc: base + resident + find,
    dh: 2,
    findTokens: find,
    describeCharge: 'none',
  };
}

export interface Stats {
  readonly n: number;
  readonly max: number | null;
  readonly mean: number | null;
  readonly median: number | null;
  readonly p95: number | null;
}

/**
 * Nearest-rank p95 (`ceil(0.95 * n)`), the definition that needs no
 * interpolation and therefore no second convention — a suite of 6 intents has
 * a p95 that is one of its 6 values, which is what a reviewer reading the
 * checkpoint expects.
 */
export function summarize(values: readonly number[]): Stats {
  if (values.length === 0) return { n: 0, max: null, mean: null, median: null, p95: null };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
  return {
    n: sorted.length,
    max: sorted[sorted.length - 1]!,
    mean: sorted.reduce((s, v) => s + v, 0) / sorted.length,
    median: at(0.5),
    p95: at(0.95),
  };
}

export interface TtfcReport {
  readonly coreHit: Stats;
  readonly coreMiss: Stats;
  readonly cold: Stats;
  /** Intents with no correct call (negative/sod_negative) — counted, not measured. Judgment call (g). */
  readonly excludedNoCorrectCall: number;
  readonly byCategory: Readonly<Record<BenchCategory, Stats>>;
  /** Per-role TTFC — 02 §5.10's closing sentence: "the checkpoint will see, because CI reports TTFC per role." */
  readonly byRole: Readonly<Record<string, RoleTtfc>>;
}

export interface RoleTtfc {
  readonly coreHit: Stats;
  readonly coreMiss: Stats;
  readonly cold: Stats;
  /** VTC for this role: 4 meta-tools + its compiled core set (02 §5.10's own arithmetic). */
  readonly vtc: number;
  readonly vtcWithinDefault: boolean;
  readonly vtcWithinHardCap: boolean;
  /** False when this repo has no Role manifest for the role — judgment call (f). */
  readonly residentSetKnown: boolean;
  readonly residentTokens: number;
}

function statsFor(ms: readonly IntentMeasurement[], bucket: TtfcBucket): Stats {
  return summarize(ms.filter((m) => m.bucket === bucket).map((m) => m.ttfc!).filter((v) => v !== null));
}

export function buildTtfcReport(
  model: BenchTokenModel,
  measurements: readonly IntentMeasurement[],
): TtfcReport {
  const byCategory = {} as Record<BenchCategory, Stats>;
  for (const category of BENCH_CATEGORIES) {
    byCategory[category] = summarize(
      measurements
        .filter((m) => m.intent.category === category && m.ttfc !== null)
        .map((m) => m.ttfc!),
    );
  }

  const byRole: Record<string, RoleTtfc> = {};
  for (const role of [...new Set(measurements.map((m) => m.intent.role))].sort()) {
    const inRole = measurements.filter((m) => m.intent.role === role);
    const core = coreToolsForRole(model, role);
    const vtc = META_TOOL_COUNT + core.length;
    byRole[role] = {
      coreHit: statsFor(inRole, 'coreHit'),
      coreMiss: statsFor(inRole, 'coreMiss'),
      cold: statsFor(inRole, 'cold'),
      vtc,
      vtcWithinDefault: vtc <= VTC_DEFAULT,
      vtcWithinHardCap: vtc <= VTC_HARD_CAP,
      residentSetKnown: model.roles[role] !== undefined,
      residentTokens: residentTokensForRole(model, role),
    };
  }

  return {
    coreHit: statsFor(measurements, 'coreHit'),
    coreMiss: statsFor(measurements, 'coreMiss'),
    cold: statsFor(measurements, 'cold'),
    excludedNoCorrectCall: measurements.filter((m) => m.bucket === null).length,
    byCategory,
    byRole,
  };
}

export interface VtcReport {
  readonly default: number;
  readonly hardCap: number;
  readonly metaToolCount: number;
  /** The largest resident-definition count any role in this repo would produce. */
  readonly max: number;
  readonly byRole: Readonly<Record<string, number>>;
  readonly rolesOverDefault: readonly string[];
  readonly rolesOverHardCap: readonly string[];
}

/**
 * VTC covers EVERY role this repo compiles, not only the roles some intent
 * happens to name: an over-cap role with no intents authored for it yet is
 * still an over-cap role, and 02 §5.2 has `forge.activate` refuse it at
 * runtime. Roles named only by an intent (no Role manifest) are included too,
 * at the 4-meta-tool floor.
 */
export function buildVtcReport(model: BenchTokenModel, ttfc: TtfcReport): VtcReport {
  const byRole: Record<string, number> = {};
  const over: string[] = [];
  const overHard: string[] = [];
  const roleIds = [...new Set([...Object.keys(model.roles), ...Object.keys(ttfc.byRole)])].sort();
  for (const role of roleIds) {
    const vtc = ttfc.byRole[role]?.vtc ?? META_TOOL_COUNT + coreToolsForRole(model, role).length;
    byRole[role] = vtc;
    if (vtc > VTC_DEFAULT) over.push(role);
    if (vtc > VTC_HARD_CAP) overHard.push(role);
  }
  const counts = Object.values(byRole);
  return {
    default: VTC_DEFAULT,
    hardCap: VTC_HARD_CAP,
    metaToolCount: META_TOOL_COUNT,
    max: counts.length === 0 ? META_TOOL_COUNT : Math.max(...counts),
    byRole,
    rolesOverDefault: over.sort(),
    rolesOverHardCap: overHard.sort(),
  };
}

export interface DhReport extends Stats {
  readonly byCategory: Readonly<Record<BenchCategory, Stats>>;
  readonly byRole: Readonly<Record<string, Stats>>;
}

export function buildDhReport(measurements: readonly IntentMeasurement[]): DhReport {
  const hops = (ms: readonly IntentMeasurement[]): Stats =>
    summarize(ms.filter((m) => m.dh !== null).map((m) => m.dh!));
  const byCategory = {} as Record<BenchCategory, Stats>;
  for (const category of BENCH_CATEGORIES) {
    byCategory[category] = hops(measurements.filter((m) => m.intent.category === category));
  }
  const byRole: Record<string, Stats> = {};
  for (const role of [...new Set(measurements.map((m) => m.intent.role))].sort()) {
    byRole[role] = hops(measurements.filter((m) => m.intent.role === role));
  }
  return { ...hops(measurements), byCategory, byRole };
}

export interface MtbReport {
  readonly toolsMeasured: number;
  readonly rolesMeasured: number;
  readonly maxCardTokens: number;
  readonly maxResidentTokens: number;
  readonly maxDescribeTokens: number;
  readonly maxRoleCoreSetTokens: number;
  readonly metaResidentTokens: number;
  readonly limits: {
    readonly card: number;
    readonly resident: number;
    readonly describe: number;
    readonly roleCoreSet: number;
    readonly metaResident: number;
  };
}

/** 02 §5.2's "~440 tokens" for the four meta-tools, already asserted by W0-G4's own budget test. */
export const META_RESIDENT_BUDGET = 440;

export function buildMtbReport(model: BenchTokenModel): MtbReport {
  const tools = Object.values(model.tools);
  const roles = Object.values(model.roles);
  const maxOf = (values: readonly number[]): number => (values.length === 0 ? 0 : Math.max(...values));
  return {
    toolsMeasured: tools.length,
    rolesMeasured: roles.length,
    maxCardTokens: maxOf(tools.map((t) => t.cardTokens)),
    maxResidentTokens: maxOf(tools.map((t) => t.residentTokens)),
    maxDescribeTokens: maxOf(tools.map((t) => t.describeTokens)),
    maxRoleCoreSetTokens: maxOf(roles.map((r) => r.coreSetTokens)),
    metaResidentTokens: model.metaResidentTokens,
    limits: {
      card: TOKEN_BUDGETS.card,
      resident: TOKEN_BUDGETS.residentHard,
      describe: TOKEN_BUDGETS.describe,
      roleCoreSet: TOKEN_BUDGETS.roleCoreSet,
      metaResident: META_RESIDENT_BUDGET,
    },
  };
}

// --------------------------------------------------------------------------
// The absolute gates, and the flat summary the CI regression gate compares.
// --------------------------------------------------------------------------

export interface BenchGate {
  readonly id: string;
  /** Which of the five metrics this gate belongs to. */
  readonly metric: 'TTFC' | 'VTC' | 'DH' | 'SA@1' | 'MTB';
  readonly limit: number;
  readonly observed: number | null;
  readonly ok: boolean;
  /** Cited section of 02 that fixes this number. */
  readonly source: string;
  readonly detail: string;
}

function ceilingGate(
  id: string,
  metric: BenchGate['metric'],
  observed: number | null,
  limit: number,
  source: string,
  detail: string,
): BenchGate {
  return { id, metric, limit, observed, ok: observed === null || observed <= limit, source, detail };
}

export function buildGates(
  ttfc: TtfcReport,
  vtc: VtcReport,
  dh: DhReport,
  mtb: MtbReport,
): readonly BenchGate[] {
  return [
    ceilingGate(
      'ttfc.core-hit',
      'TTFC',
      ttfc.coreHit.max,
      TTFC_CORE_HIT_BUDGET,
      '02 §5.7 Case A',
      'Worst core-hit intent. The ≤2,000 gate applies to core-hit only — a core-miss costs one extra forge.find and is reported, not gated.',
    ),
    ceilingGate(
      'ttfc.cold',
      'TTFC',
      ttfc.cold.max,
      TTFC_COLD_BUDGET,
      '02 §5.7 Case B',
      'Worst cold-session intent (no role hint: meta-tools + find + describe).',
    ),
    ceilingGate(
      'vtc.hard-cap',
      'VTC',
      vtc.max,
      VTC_HARD_CAP,
      '02 §5.10',
      'Resident definitions (4 meta + role core). The corrected hard cap; the ≤16 default is reported as vtc.default-target.',
    ),
    ceilingGate(
      'vtc.default-target',
      'VTC',
      vtc.max,
      VTC_DEFAULT,
      '02 §5.10',
      'The corrected ≤16 default. Exceeding it costs TTFC and is what makes the per-role TTFC breakdown the number that matters.',
    ),
    ceilingGate('dh.median', 'DH', dh.median, DH_MEDIAN_TARGET, '02 §5.7', 'Median hops to the first correct call.'),
    ceilingGate('dh.p95', 'DH', dh.p95, DH_P95_TARGET, '02 §5.7', 'p95 hops (nearest-rank) to the first correct call.'),
    ceilingGate('mtb.card', 'MTB', mtb.maxCardTokens, mtb.limits.card, '02 §5.3(a)', 'Largest discovery card.'),
    ceilingGate('mtb.resident', 'MTB', mtb.maxResidentTokens, mtb.limits.resident, '02 §5.3(b)', 'Largest resident definition (hard cap).'),
    ceilingGate('mtb.describe', 'MTB', mtb.maxDescribeTokens, mtb.limits.describe, '02 §5.3(c)', 'Largest forge.describe response.'),
    ceilingGate('mtb.role-core-set', 'MTB', mtb.maxRoleCoreSetTokens, mtb.limits.roleCoreSet, '02 §5.3(d)', 'Largest role core set.'),
    ceilingGate('mtb.meta-resident', 'MTB', mtb.metaResidentTokens, mtb.limits.metaResident, '02 §5.2', 'The four always-resident meta-tools.'),
  ];
}

/**
 * The flat, machine-comparable summary. This — and only this — is what the
 * committed baseline records and what `forge ci` stage 10 diffs, which is why
 * every value is a plain number and every key is stable. `direction` for each
 * key is fixed in `SUMMARY_DIRECTIONS` beside it, so the CI gate never has to
 * guess whether a rise is a regression.
 */
export interface BenchSummary {
  readonly [metric: string]: number;
}

/** `higher` = a drop is a regression; `lower` = a rise is a regression. */
export const SUMMARY_DIRECTIONS: Readonly<Record<string, 'higher' | 'lower'>> = {
  'sa1.overall': 'higher',
  'sa1.direct': 'higher',
  'sa1.near_miss': 'higher',
  'sa1.negative': 'higher',
  'sa1.sod_negative': 'higher',
  'ttfc.core-hit.max': 'lower',
  'ttfc.core-miss.max': 'lower',
  'ttfc.cold.max': 'lower',
  'vtc.max': 'lower',
  'dh.median': 'lower',
  'dh.p95': 'lower',
  'mtb.card.max': 'lower',
  'mtb.resident.max': 'lower',
  'mtb.describe.max': 'lower',
  'mtb.role-core-set.max': 'lower',
  'mtb.meta-resident': 'lower',
};

function orZero(v: number | null): number {
  return v ?? 0;
}

export function buildSummary(
  sa1: Sa1Report,
  ttfc: TtfcReport,
  vtc: VtcReport,
  dh: DhReport,
  mtb: MtbReport,
): BenchSummary {
  return {
    'sa1.overall': sa1.sa1,
    'sa1.direct': sa1.byCategory.direct.sa1,
    'sa1.near_miss': sa1.byCategory.near_miss.sa1,
    'sa1.negative': sa1.byCategory.negative.sa1,
    'sa1.sod_negative': sa1.byCategory.sod_negative.sa1,
    'ttfc.core-hit.max': orZero(ttfc.coreHit.max),
    'ttfc.core-miss.max': orZero(ttfc.coreMiss.max),
    'ttfc.cold.max': orZero(ttfc.cold.max),
    'vtc.max': vtc.max,
    'dh.median': orZero(dh.median),
    'dh.p95': orZero(dh.p95),
    'mtb.card.max': mtb.maxCardTokens,
    'mtb.resident.max': mtb.maxResidentTokens,
    'mtb.describe.max': mtb.maxDescribeTokens,
    'mtb.role-core-set.max': mtb.maxRoleCoreSetTokens,
    'mtb.meta-resident': mtb.metaResidentTokens,
  };
}

// --------------------------------------------------------------------------
// The committed baseline (W0-G7's `done:` — "the Wave 0 baseline is recorded
// to a committed file and CI fails on regression in any metric").
// --------------------------------------------------------------------------

/** `evals/baseline.json`. Under `evals/` because it is a benchmark artefact and the benchmark suite lives there; a top-level FILE is never mistaken for a module server, which `loadAllIntents` only ever reads as a DIRECTORY. */
export const BASELINE_RELATIVE_PATH = 'evals/baseline.json';

export const BASELINE_SCHEMA_VERSION = 1;

export interface BenchBaseline {
  readonly schemaVersion: number;
  /** ISO date the baseline was recorded. */
  readonly recorded: string;
  /**
   * What the recorded run actually covered. A baseline recorded over an empty
   * catalogue is honest and useless in equal measure, and this block is how a
   * reader tells the difference without re-running anything.
   */
  readonly coverage: {
    readonly toolsInCatalogue: number;
    readonly intents: number;
    readonly servers: number;
    readonly rolesWithManifest: number;
  };
  readonly summary: BenchSummary;
  readonly notes: readonly string[];
}

export function buildBaseline(
  report: BenchReport,
  index: CatalogueIndex,
  model: BenchTokenModel,
  recorded: string,
  notes: readonly string[],
): BenchBaseline {
  const coverage = {
    toolsInCatalogue: index.tools.length,
    intents: report.overall.n,
    servers: report.servers.length,
    rolesWithManifest: Object.keys(model.roles).length,
  };
  const provisional =
    coverage.toolsInCatalogue === 0 || coverage.intents === 0
      ? [
          'PROVISIONAL BASELINE — recorded over an EMPTY catalogue and/or an empty intents suite. Every zero below is "nothing was measured", not "measured at zero", and every SA@1 of 1 is vacuous (0 of 0 intents). The only real measurement here is mtb.meta-resident: the four meta-tools, which exist.',
          'WHOEVER RUNS TRACK I: once manifests/, roles/ and evals/<server>/intents.yaml are populated, re-record with `forge bench --record-baseline` and commit the diff. Until then the vacuous SA@1 of 1 will fail `forge ci` stage 10 on the first real run — deliberately, so the baseline is re-recorded by a human rather than drifting silently.',
        ]
      : [];
  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    recorded,
    coverage,
    summary: report.summary,
    notes: [...provisional, ...notes],
  };
}

export interface BaselineRegression {
  readonly metric: string;
  readonly direction: 'higher' | 'lower';
  readonly baseline: number;
  readonly current: number;
}

export interface BaselineComparison {
  readonly ok: boolean;
  readonly compared: number;
  readonly regressions: readonly BaselineRegression[];
  /** Metrics present in one side and not the other — a shape change, reported rather than silently skipped. */
  readonly missingFromCurrent: readonly string[];
  readonly newInCurrent: readonly string[];
}

/**
 * Compare a run against a baseline. EXACT comparison, no tolerance band: 02
 * §5.9 makes rank-1 mode deterministic precisely so "a regression is
 * unambiguous", and inventing a percentage band here would give back the
 * ambiguity the mode exists to remove. A metric that IMPROVES is never a
 * failure — the baseline is re-recorded deliberately, by a human running
 * `forge bench --record-baseline`, and reviewed as a diff like everything
 * else here.
 *
 * Floating-point SA@1 (a ratio) is compared with a 1e-9 epsilon so that
 * 2/3 recomputed identically never reads as a regression; token counts and
 * hop counts are integers and are compared exactly.
 */
export function compareToBaseline(baseline: BenchBaseline, current: BenchSummary): BaselineComparison {
  const EPSILON = 1e-9;
  const regressions: BaselineRegression[] = [];
  const missingFromCurrent: string[] = [];
  for (const [metric, base] of Object.entries(baseline.summary)) {
    const now = current[metric];
    if (now === undefined) {
      missingFromCurrent.push(metric);
      continue;
    }
    const direction = SUMMARY_DIRECTIONS[metric] ?? 'lower';
    const regressed = direction === 'higher' ? now < base - EPSILON : now > base + EPSILON;
    if (regressed) regressions.push({ metric, direction, baseline: base, current: now });
  }
  const newInCurrent = Object.keys(current).filter((m) => !(m in baseline.summary));
  return {
    ok: regressions.length === 0 && missingFromCurrent.length === 0,
    compared: Object.keys(baseline.summary).length,
    regressions,
    missingFromCurrent,
    newInCurrent,
  };
}

export class BaselineReadError extends Error {
  constructor(public readonly filePath: string, reason: string) {
    super(`Failed to read the benchmark baseline at ${filePath}: ${reason}`);
    this.name = 'BaselineReadError';
  }
}

export function readBaseline(filePath: string): BenchBaseline {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new BaselineReadError(filePath, err instanceof Error ? err.message : String(err));
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new BaselineReadError(filePath, 'top-level value must be a JSON object');
  }
  const b = parsed as Record<string, unknown>;
  if (b['schemaVersion'] !== BASELINE_SCHEMA_VERSION) {
    throw new BaselineReadError(
      filePath,
      `schemaVersion must be ${BASELINE_SCHEMA_VERSION}, found ${JSON.stringify(b['schemaVersion'])}`,
    );
  }
  const summary = b['summary'];
  if (typeof summary !== 'object' || summary === null) {
    throw new BaselineReadError(filePath, '`summary` must be an object of metric -> number');
  }
  for (const [k, v] of Object.entries(summary as Record<string, unknown>)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new BaselineReadError(filePath, `summary.${k} must be a finite number`);
    }
  }
  return parsed as BenchBaseline;
}

// --------------------------------------------------------------------------
// Loading every `evals/**/intents.yaml` under a root.
// --------------------------------------------------------------------------

export interface LoadedIntents {
  readonly serverId: string;
  readonly filePath: string;
  readonly intents: readonly BenchIntent[];
}

export function loadAllIntents(evalsRoot: string): readonly LoadedIntents[] {
  if (!existsSync(evalsRoot)) return [];
  const out: LoadedIntents[] = [];
  for (const serverId of readdirSync(evalsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()) {
    const filePath = join(evalsRoot, serverId, 'intents.yaml');
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, 'utf8');
    out.push({ serverId, filePath, intents: parseIntentsYaml(raw, filePath) });
  }
  return out;
}

// --------------------------------------------------------------------------
// `forge bench [--json] [--root <dir>] [--evals <dir>]`.
// --------------------------------------------------------------------------

export interface BenchOptions {
  readonly json: boolean;
  readonly root?: string;
  readonly evals?: string;
  /** Where the committed baseline lives. Default: `<root>/evals/baseline.json`. */
  readonly baseline?: string;
  /** Overwrite the baseline with this run. A deliberate human/agent act — never done implicitly, and refused when CI=true. */
  readonly recordBaseline?: boolean;
}

export interface BenchServerReport {
  readonly serverId: string;
  readonly report: Sa1Report;
  readonly ttfc: TtfcReport;
  readonly dh: DhReport;
}

export interface BenchReport {
  readonly ok: true;
  readonly mode: 'rank-1';
  readonly generated: GenerateIntentsSkeletonsResult;
  readonly servers: readonly BenchServerReport[];
  readonly overall: Sa1Report;
  /** The five metrics of 02 §5.9, W0-G7. */
  readonly metrics: {
    readonly sa1: Sa1Report;
    readonly ttfc: TtfcReport;
    readonly vtc: VtcReport;
    readonly dh: DhReport;
    readonly mtb: MtbReport;
  };
  /** Absolute gates from 02 §5.7/§5.10/§5.3, each carrying the section that fixes it. */
  readonly gates: readonly BenchGate[];
  /** The flat, stable shape the committed baseline records and `forge ci` stage 10 diffs. */
  readonly summary: BenchSummary;
  /** What in this report is assumed rather than measured — judgment calls (d)–(g). */
  readonly assumptions: readonly string[];
  readonly note: string;
}

export interface BenchCliError {
  readonly ok: false;
  readonly code: 'CATALOGUE_UNAVAILABLE' | 'INTENTS_INVALID' | 'BASELINE_RECORD_REFUSED';
  readonly message: string;
  readonly next: string;
}

const RANK1_NOTE =
  'rank-1 mode (02 §5.9): deterministic, no model in the loop. All five metrics with per-category and per-role breakdowns. Agent mode runs at wave boundaries only and is not this command.';

function emitError(error: BenchCliError, json: boolean): number {
  if (json) {
    process.stdout.write(`${JSON.stringify(error)}\n`);
  } else {
    process.stderr.write(`forge: bench — ${error.message}\n`);
    process.stderr.write(`forge: next — ${error.next}\n`);
  }
  return 1;
}

function formatReportHuman(report: BenchReport): string {
  const lines = [
    `forge bench: rank-1 mode — SA@1 ${(report.overall.sa1 * 100).toFixed(1)}% (${report.overall.hits}/${report.overall.n})`,
  ];
  if (report.generated.created.length > 0) {
    lines.push(`  generated ${report.generated.created.length} new intents skeleton(s):`);
    for (const f of report.generated.created) lines.push(`    ${f}`);
  }
  for (const { serverId, report: r } of report.servers) {
    lines.push(`  ${serverId}: SA@1 ${(r.sa1 * 100).toFixed(1)}% (${r.hits}/${r.n})`);
    for (const category of BENCH_CATEGORIES) {
      const c = r.byCategory[category];
      if (c.n === 0) continue;
      lines.push(`    ${category}: ${(c.sa1 * 100).toFixed(1)}% (${c.hits}/${c.n})`);
    }
  }

  const { ttfc, vtc, dh, mtb } = report.metrics;
  const n = (v: number | null): string => (v === null ? 'n/a' : String(Math.round(v)));
  lines.push(
    `  TTFC: core-hit max ${n(ttfc.coreHit.max)} (n=${ttfc.coreHit.n}, gate ≤${TTFC_CORE_HIT_BUDGET}) · core-miss max ${n(ttfc.coreMiss.max)} (n=${ttfc.coreMiss.n}, reported not gated) · cold max ${n(ttfc.cold.max)} (n=${ttfc.cold.n}, gate ≤${TTFC_COLD_BUDGET})`,
  );
  for (const [role, r] of Object.entries(ttfc.byRole)) {
    lines.push(
      `    role ${role}: core-hit max ${n(r.coreHit.max)} · core-miss max ${n(r.coreMiss.max)} · cold max ${n(r.cold.max)} · VTC ${r.vtc}${r.residentSetKnown ? '' : ' (no Role manifest — resident set unknown, charged 0)'}`,
    );
  }
  lines.push(`  VTC: max ${vtc.max} (default ≤${vtc.default}, hard cap ${vtc.hardCap})`);
  lines.push(`  DH: median ${n(dh.median)} (≤${DH_MEDIAN_TARGET}) · p95 ${n(dh.p95)} (≤${DH_P95_TARGET})`);
  lines.push(
    `  MTB: card ${mtb.maxCardTokens}/${mtb.limits.card} · resident ${mtb.maxResidentTokens}/${mtb.limits.resident} · describe ${mtb.maxDescribeTokens}/${mtb.limits.describe} · role core ${mtb.maxRoleCoreSetTokens}/${mtb.limits.roleCoreSet} · meta ${mtb.metaResidentTokens}/${mtb.limits.metaResident}`,
  );
  const failed = report.gates.filter((g) => !g.ok);
  if (failed.length === 0) {
    lines.push(`  gates: all ${report.gates.length} within budget.`);
  } else {
    lines.push(`  gates: ${failed.length} of ${report.gates.length} BREACHED:`);
    for (const g of failed) {
      lines.push(`    ${g.id} — ${g.observed} > ${g.limit} (${g.source}). ${g.detail}`);
    }
  }
  for (const a of report.assumptions) lines.push(`  assumption: ${a}`);
  lines.push(`  note: ${report.note}`);
  return lines.join('\n');
}

function assumptionsFor(
  model: BenchTokenModel,
  measurements: readonly IntentMeasurement[],
  ttfc: TtfcReport,
): readonly string[] {
  const out: string[] = [
    `Session preamble charged at ${SESSION_INIT_TOKENS} tokens — 02 §5.7's own figure for "initialize + server info". Assumed, not measured: rank-1 mode has no live transport.`,
  ];
  if (measurements.some((m) => m.describeCharge === 'budget-ceiling')) {
    out.push(
      `At least one cold intent's forge.describe was charged at the ${TOKEN_BUDGETS.describe}-token budget ceiling because no Tool manifest was found for its expected tool — a conservative upper bound, never an invented figure.`,
    );
  }
  const unknownRoles = Object.entries(ttfc.byRole)
    .filter(([, r]) => !r.residentSetKnown)
    .map(([role]) => role);
  if (unknownRoles.length > 0) {
    out.push(
      `No Role manifest for ${unknownRoles.join(', ')} — their resident set is charged 0 tokens and their VTC is the 4 meta-tools alone. Warm TTFC for these roles is a floor, not a measurement.`,
    );
  }
  if (Object.keys(model.tools).length === 0) {
    out.push(
      'No Tool manifests in this repo, so MTB has nothing to measure beyond the four meta-tools. Populate manifests/ (Track I) before reading MTB as a real number.',
    );
  }
  if (ttfc.excludedNoCorrectCall > 0) {
    out.push(
      `${ttfc.excludedNoCorrectCall} negative/sod_negative intent(s) excluded from TTFC and DH — their correct outcome is a refusal, so there is no first correct call to count. They are still counted in SA@1.`,
    );
  }
  return out;
}

export interface BenchCommandDeps {
  /** Injected by tests so they run against an isolated catalogue index instead of a real `generated/index/catalogue-index.json`. */
  readonly loadIndex?: (root: string) => CatalogueIndex;
  /** Injected by tests so the token model comes from a fixture rather than from real manifests on disk. */
  readonly tokenModel?: (root: string) => BenchTokenModel;
}

export async function runBenchCommand(
  opts: BenchOptions,
  deps: BenchCommandDeps = {},
): Promise<number> {
  const json = Boolean(opts.json);
  const root = opts.root ?? process.cwd();
  const evalsRoot = opts.evals ?? join(root, 'evals');

  let index: CatalogueIndex;
  try {
    index = deps.loadIndex ? deps.loadIndex(root) : loadCatalogueIndex(root);
  } catch (err) {
    return emitError(
      {
        ok: false,
        code: 'CATALOGUE_UNAVAILABLE',
        message:
          err instanceof CatalogueIndexLoadError
            ? err.message
            : `the catalogue index could not be read: ${err instanceof Error ? err.message : String(err)}`,
        next: 'Run "forge codegen" to build generated/index/catalogue-index.json, then re-run "forge bench".',
      },
      json,
    );
  }

  const generated = generateIntentsSkeletons(index, evalsRoot);

  let loaded: readonly LoadedIntents[];
  try {
    loaded = loadAllIntents(evalsRoot);
  } catch (err) {
    return emitError(
      {
        ok: false,
        code: 'INTENTS_INVALID',
        message: err instanceof IntentsParseError ? err.message : String(err),
        next: 'Fix the malformed intents.yaml named above — it must be a YAML sequence of {intent, expect, category, role} entries (02 §5.9) — then re-run "forge bench".',
      },
      json,
    );
  }

  const model = deps.tokenModel ? deps.tokenModel(root) : buildTokenModel(root);

  const measure = (intents: readonly BenchIntent[]): readonly IntentMeasurement[] =>
    runRank1(index, intents).map((result) => measureIntent(index, model, result.intent, result));

  const servers: BenchServerReport[] = loaded.map(({ serverId, intents }) => {
    const ms = measure(intents);
    return {
      serverId,
      report: computeSa1(ms.map((m) => m.result)),
      ttfc: buildTtfcReport(model, ms),
      dh: buildDhReport(ms),
    };
  });

  const all = loaded.flatMap(({ intents }) => measure(intents));
  const overall = computeSa1(all.map((m) => m.result));
  const ttfc = buildTtfcReport(model, all);
  const vtcReport = buildVtcReport(model, ttfc);
  const dh = buildDhReport(all);
  const mtb = buildMtbReport(model);

  const report: BenchReport = {
    ok: true,
    mode: 'rank-1',
    generated,
    servers,
    overall,
    metrics: { sa1: overall, ttfc, vtc: vtcReport, dh, mtb },
    gates: buildGates(ttfc, vtcReport, dh, mtb),
    summary: buildSummary(overall, ttfc, vtcReport, dh, mtb),
    assumptions: assumptionsFor(model, all, ttfc),
    note: RANK1_NOTE,
  };

  if (opts.recordBaseline === true) {
    // Same posture as `forge codegen --accept-contract` (02 §2.4): re-recording
    // a baseline is a deliberate act with a reviewable diff, never something a
    // CI run does to itself to make a red build go green.
    if (process.env['CI'] === 'true') {
      return emitError(
        {
          ok: false,
          code: 'BASELINE_RECORD_REFUSED',
          message: '--record-baseline is refused when CI=true.',
          next: `Run "forge bench --record-baseline" on a developer machine, review the diff to ${BASELINE_RELATIVE_PATH}, and commit it in a change proposal.`,
        },
        json,
      );
    }
    const baselinePath = opts.baseline ?? join(root, BASELINE_RELATIVE_PATH);
    const baseline = buildBaseline(report, index, model, new Date().toISOString().slice(0, 10), [
      ...report.assumptions,
    ]);
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    if (!json) process.stdout.write(`forge bench: baseline recorded to ${baselinePath}\n`);
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    process.stdout.write(`${formatReportHuman(report)}\n`);
  }
  return 0;
}

// Re-exported for tests/bench's fixture suite, which builds a synthetic
// catalogue via `buildCatalogueIndex` rather than requiring the real Wave 0
// manifests (`manifests/jde/**`) to exist — see TASKS.md W0-G6's own note
// that Track I has not run yet.
export { buildCatalogueIndex };
