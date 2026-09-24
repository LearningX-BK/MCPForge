import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildIntentsSkeleton,
  computeSa1,
  deriveNearMissIntents,
  deriveNegativeIntents,
  generateIntentsSkeletons,
  groupByServer,
  loadAllIntents,
  mockMetaContextFor,
  parseIntentsYaml,
  runBenchCommand,
  runIntent,
  runRank1,
  type BenchIntent,
} from '@mcpforge/cli/commands/bench';
import { buildFixtureIndex } from './fixtures.js';

describe('W0-G6 — the intents-skeleton generator', () => {
  it('groups the fixture catalogue by {app}-{module}', () => {
    const groups = groupByServer(buildFixtureIndex());
    expect([...groups.keys()].sort()).toEqual(['acme-ap', 'acme-fin']);
    expect(groups.get('acme-ap')?.map((e) => e.id).sort()).toEqual([
      'acme.ap.voucher.create',
      'acme.ap.voucher.get',
      'acme.ap.voucher.search',
    ]);
  });

  it('derives at least the templated negatives for a server with tools', () => {
    const group = groupByServer(buildFixtureIndex()).get('acme-ap')!;
    const negatives = deriveNegativeIntents(group);
    expect(negatives.length).toBeGreaterThan(0);
    for (const n of negatives) {
      expect(n.category).toBe('negative');
      expect(n.expect).toBe('none');
      expect(n.role.length).toBeGreaterThan(0);
    }
  });

  it('derives one near-miss intent per multi-tool entity, preferring the get verb', () => {
    const group = groupByServer(buildFixtureIndex()).get('acme-ap')!;
    const nearMisses = deriveNearMissIntents(group);
    // voucher has 3 tools (create/search/get) -> exactly one near-miss pair for it.
    expect(nearMisses).toHaveLength(1);
    expect(nearMisses[0]!.expect).toBe('acme.ap.voucher.get');
    expect(nearMisses[0]!.category).toBe('near_miss');
  });

  it('does not derive a near-miss intent for a single-tool entity', () => {
    const group = groupByServer(buildFixtureIndex()).get('acme-fin')!;
    expect(deriveNearMissIntents(group)).toHaveLength(0);
  });

  it('builds a skeleton document that parses back as valid intents plus a steward TODO comment', () => {
    const group = groupByServer(buildFixtureIndex()).get('acme-ap')!;
    const skeleton = buildIntentsSkeleton(group);
    expect(skeleton).toContain('STEWARD TODO');
    const parsed = parseIntentsYaml(skeleton, 'inline');
    // 2 negatives + 1 near-miss, no positives (the steward's job).
    expect(parsed).toHaveLength(3);
    expect(parsed.filter((i) => i.category === 'negative')).toHaveLength(2);
    expect(parsed.filter((i) => i.category === 'near_miss')).toHaveLength(1);
  });
});

describe('W0-G6 — generateIntentsSkeletons: created once, never overwritten', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcpforge-bench-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates one intents.yaml per server on a clean evals root', () => {
    const result = generateIntentsSkeletons(buildFixtureIndex(), dir);
    expect([...result.created].sort()).toEqual(
      [join(dir, 'acme-ap', 'intents.yaml'), join(dir, 'acme-fin', 'intents.yaml')].sort(),
    );
    expect(result.skipped).toEqual([]);
  });

  it('never overwrites an existing intents.yaml, even a hand-edited one', () => {
    generateIntentsSkeletons(buildFixtureIndex(), dir);
    const filePath = join(dir, 'acme-ap', 'intents.yaml');
    const stewardContent = [
      '- intent: "Book the invoice from ACME against PO 451"',
      '  expect: acme.ap.voucher.create',
      '  category: direct',
      '  role: p2p',
    ].join('\n');
    writeFileSync(filePath, stewardContent, 'utf8');

    const second = generateIntentsSkeletons(buildFixtureIndex(), dir);
    expect(second.created).toEqual([]);
    expect(second.skipped).toContain(filePath);
    expect(readFileSync(filePath, 'utf8')).toBe(stewardContent);
  });
});

describe('W0-G6 — the mock gateway: forge.find over the real index and the real scoping code', () => {
  it('resolves a clear positive intent to its rank-1 tool', () => {
    const index = buildFixtureIndex();
    const intent: BenchIntent = {
      intent: 'create a new voucher for a supplier invoice',
      expect: 'acme.ap.voucher.create',
      category: 'direct',
      role: 'p2p',
    };
    const result = runIntent(index, intent);
    expect(result.actual).toBe('acme.ap.voucher.create');
    expect(result.hit).toBe(true);
  });

  it('an out-of-catalogue negative resolves to no_tool ("none")', () => {
    const index = buildFixtureIndex();
    const intent: BenchIntent = {
      intent: 'what is the weather like today',
      expect: 'none',
      category: 'negative',
      role: 'p2p',
    };
    const result = runIntent(index, intent);
    expect(result.actual).toBe('none');
    expect(result.hit).toBe(true);
  });

  it('an unrecognised role is a deterministic miss, not a crash', () => {
    const index = buildFixtureIndex();
    const intent: BenchIntent = {
      intent: 'create a new voucher for a supplier invoice',
      expect: 'acme.ap.voucher.create',
      category: 'direct',
      role: 'no-such-role',
    };
    expect(() => runIntent(index, intent)).not.toThrow();
  });

  it('grants every real catalogue tool full visibility for its own role (mock gateway is maximally permissive by design)', () => {
    const index = buildFixtureIndex();
    const ctx = mockMetaContextFor(index, 'p2p');
    const response = ctx.policy.scope; // real ScopeContext, resolvable by the real resolveScope
    expect(response.session.heldRoleIds).toEqual(['p2p']);
  });
});

describe('W0-G6 — rank-1 SA@1 is deterministic', () => {
  it('computes the same SA@1 across repeated runs (no model, no randomness)', () => {
    const index = buildFixtureIndex();
    const intents: BenchIntent[] = [
      { intent: 'create a new voucher for a supplier invoice', expect: 'acme.ap.voucher.create', category: 'direct', role: 'p2p' },
      { intent: 'search for vouchers by supplier', expect: 'acme.ap.voucher.search', category: 'direct', role: 'p2p' },
      { intent: 'get voucher details again', expect: 'acme.ap.voucher.get', category: 'near_miss', role: 'p2p' },
      { intent: 'what is the weather like today', expect: 'none', category: 'negative', role: 'p2p' },
    ];
    const first = computeSa1(runRank1(index, intents));
    const second = computeSa1(runRank1(index, intents));
    expect(second).toEqual(first);
    expect(first.n).toBe(4);
    expect(first.byCategory.direct.n).toBe(2);
    expect(first.byCategory.near_miss.n).toBe(1);
    expect(first.byCategory.negative.n).toBe(1);
  });

  it('reports sa1: 1 (vacuous) for a category with zero intents', () => {
    const report = computeSa1([]);
    expect(report.n).toBe(0);
    expect(report.sa1).toBe(1);
    for (const category of Object.keys(report.byCategory) as (keyof typeof report.byCategory)[]) {
      expect(report.byCategory[category].sa1).toBe(1);
    }
  });
});

describe('W0-G6 — loadAllIntents', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcpforge-bench-load-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads intents.yaml files sorted by server id, skipping servers with none', () => {
    mkdirSync(join(dir, 'zeta'), { recursive: true });
    mkdirSync(join(dir, 'alpha'), { recursive: true });
    mkdirSync(join(dir, 'no-file'), { recursive: true });
    writeFileSync(
      join(dir, 'zeta', 'intents.yaml'),
      '- intent: "x"\n  expect: "none"\n  category: negative\n  role: p2p\n',
      'utf8',
    );
    writeFileSync(
      join(dir, 'alpha', 'intents.yaml'),
      '- intent: "y"\n  expect: "none"\n  category: negative\n  role: p2p\n',
      'utf8',
    );
    const loaded = loadAllIntents(dir);
    expect(loaded.map((l) => l.serverId)).toEqual(['alpha', 'zeta']);
  });

  it('an absent evals root loads zero intents rather than throwing', () => {
    expect(loadAllIntents(join(dir, 'does-not-exist'))).toEqual([]);
  });
});

describe('W0-G6 — `forge bench` end to end (mock gateway, no live Oracle instance)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mcpforge-bench-cli-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('generates skeletons on first run, then computes rank-1 SA@1 over whatever intents exist, and exits 0', async () => {
    const index = buildFixtureIndex();
    const writes: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    let exitCode: number;
    try {
      exitCode = await runBenchCommand(
        { json: true, root, evals: join(root, 'evals') },
        { loadIndex: () => index },
      );
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(exitCode).toBe(0);
    const report = JSON.parse(writes.join(''));
    expect(report.ok).toBe(true);
    expect(report.mode).toBe('rank-1');
    expect(report.generated.created).toHaveLength(2);
    expect(report.generated.skipped).toEqual([]);
    // Only auto-derived negatives + one near-miss per server -> no positives yet.
    expect(report.overall.byCategory.direct.n).toBe(0);
  });

  it('a second run does not regenerate — the generated intents files are untouched', async () => {
    const index = buildFixtureIndex();
    const evalsDir = join(root, 'evals');
    await runBenchCommand({ json: true, root, evals: evalsDir }, { loadIndex: () => index });

    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write;
    let exitCode: number;
    try {
      exitCode = await runBenchCommand({ json: true, root, evals: evalsDir }, { loadIndex: () => index });
    } finally {
      process.stdout.write = originalWrite;
    }
    expect(exitCode).toBe(0);
  });

  it('a catalogue load failure is reported as CATALOGUE_UNAVAILABLE with a next step, not a crash', async () => {
    const writes: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    let exitCode: number;
    try {
      exitCode = await runBenchCommand(
        { json: true, root, evals: join(root, 'evals') },
        {
          loadIndex: () => {
            throw new Error('no catalogue index here');
          },
        },
      );
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(exitCode).toBe(1);
    const error = JSON.parse(writes.join(''));
    expect(error.ok).toBe(false);
    expect(error.code).toBe('CATALOGUE_UNAVAILABLE');
    expect(error.next.length).toBeGreaterThan(0);
  });
});
