// MCPForge — W0-P33c. The reloader: all or nothing, evidence before effect,
// and no tool may change under a minted plan without changing its version.

import { describe, expect, it } from 'vitest';
import { CatalogueLoadRefused, type RuntimeCatalogue } from './catalogue.js';
import { createCatalogueReloader, unversionedChanges, type ReloadOutcome } from './reload.js';
import { SessionAssemblyUnavailable } from './session.js';
import { SurfaceArtefactsUnavailable } from './surface-artefacts.js';

/** A catalogue with only what the reloader reads: ids, versions, manifest hashes. */
function catalogue(tools: Record<string, { version: string; sha: string }>): RuntimeCatalogue {
  const ids = Object.keys(tools).sort();
  return {
    toolIds: ids,
    tools: new Map(
      ids.map((id) => [
        id,
        {
          toolId: id,
          manifestFile: `manifests/${id}.tool.yaml`,
          manifestSha256: tools[id]!.sha,
          view: { version: tools[id]!.version },
        },
      ]),
    ),
  } as unknown as RuntimeCatalogue;
}

interface Gen {
  readonly catalogue: RuntimeCatalogue;
  readonly label: string;
}

const V1 = catalogue({
  'jde.fin.journal.create': { version: '1.0.0', sha: 'a1' },
  'jde.ap.voucher.get': { version: '1.0.0', sha: 'b1' },
});

function harness(build: () => Promise<Gen>) {
  const events: string[] = [];
  const reloader = createCatalogueReloader<Gen>({
    initial: { catalogue: V1, label: 'g1' },
    build,
    commit: (next) => events.push(`commit:${next.label}`),
    notify: (next) => {
      events.push(`notify:${next.label}`);
      return Promise.resolve();
    },
    now: () => new Date('2026-10-01T09:00:00Z'),
  });
  const record = (o: ReloadOutcome): Promise<string> => {
    events.push(`record:${o.ok ? 'ok' : 'refused'}`);
    return Promise.resolve('row-1');
  };
  return { reloader, events, record };
}

describe('W0-P33c — createCatalogueReloader', () => {
  it('a clean load is recorded, THEN swapped in, THEN sessions are notified', async () => {
    const v2 = catalogue({
      'jde.fin.journal.create': { version: '1.0.1', sha: 'a2' },
      'jde.ap.voucher.get': { version: '1.0.0', sha: 'b1' },
      'jde.ap.voucher.create': { version: '1.0.0', sha: 'c1' },
    });
    const { reloader, events, record } = harness(() =>
      Promise.resolve({ catalogue: v2, label: 'g2' }),
    );
    const { outcome, recorded } = await reloader.reload(record);
    expect(recorded).toBe('row-1');
    expect(events).toEqual(['record:ok', 'commit:g2', 'notify:g2']);
    expect(outcome).toMatchObject({
      ok: true,
      generation: 2,
      previousGeneration: 1,
      toolCount: 3,
      added: ['jde.ap.voucher.create'],
      removed: [],
      changed: ['jde.fin.journal.create'],
    });
    expect(outcome.next).toContain('forge probe');
    expect(reloader.current().label).toBe('g2');
    expect(reloader.generation).toBe(2);
  });

  it('a removed tool is reported removed, and a no-change reload needs no probe', async () => {
    const v2 = catalogue({ 'jde.ap.voucher.get': { version: '1.0.0', sha: 'b1' } });
    const { reloader, record } = harness(() => Promise.resolve({ catalogue: v2, label: 'g2' }));
    const { outcome } = await reloader.reload(record);
    expect(outcome).toMatchObject({ ok: true, removed: ['jde.fin.journal.create'], added: [] });
    expect(outcome.next).toContain('no probe is needed');
  });

  it.each([
    [
      'forge validate / drift refusal',
      new CatalogueLoadRefused([
        {
          ruleId: 'assembly.schema-drift',
          file: 'generated/tools/x/schema.json',
          message: 'does not match',
          fix: 'Run `forge codegen`.',
        },
      ]),
      'assembly.schema-drift',
    ],
    [
      'surface artefacts refusal',
      new SurfaceArtefactsUnavailable(['generated/cards/x.json is missing; run forge codegen']),
      'reload.surface-artefacts',
    ],
    [
      'session artefacts refusal',
      new SessionAssemblyUnavailable(['overlays/local/deployment.yaml: invalid']),
      'reload.session-artefacts',
    ],
    ['anything else', new Error('ENOENT'), 'reload.build'],
  ])('a %s keeps the old generation serving, recorded, with a next', async (_, error, ruleId) => {
    const { reloader, events, record } = harness(() => Promise.reject(error));
    const { outcome } = await reloader.reload(record);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.generation).toBe(1);
    expect(outcome.failures[0]!.ruleId).toBe(ruleId);
    expect(outcome.failures.every((f) => f.fix.trim().length > 0)).toBe(true);
    expect(outcome.next).toMatch(/^Nothing changed: catalogue generation 1 is still serving\. \S/);
    expect(events).toEqual(['record:refused']);
    expect(reloader.current().label).toBe('g1');
    expect(reloader.generation).toBe(1);
  });

  it('a tool whose manifest changed WITHOUT a version bump is refused: a minted plan binds the version', async () => {
    const v2 = catalogue({
      'jde.fin.journal.create': { version: '1.0.0', sha: 'a2' },
      'jde.ap.voucher.get': { version: '1.0.0', sha: 'b1' },
    });
    const { reloader, events, record } = harness(() =>
      Promise.resolve({ catalogue: v2, label: 'g2' }),
    );
    const { outcome } = await reloader.reload(record);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]).toMatchObject({
      ruleId: 'reload.version-unchanged',
      file: 'manifests/jde.fin.journal.create.tool.yaml',
    });
    expect(outcome.failures[0]!.fix).toContain('Bump version');
    expect(events).toEqual(['record:refused']);
    expect(reloader.current().label).toBe('g1');
  });

  it('when the audit record cannot be written, nothing is swapped', async () => {
    const v2 = catalogue({
      'jde.fin.journal.create': { version: '1.0.1', sha: 'a2' },
      'jde.ap.voucher.get': { version: '1.0.0', sha: 'b1' },
    });
    const { reloader, events } = harness(() => Promise.resolve({ catalogue: v2, label: 'g2' }));
    await expect(reloader.reload(() => Promise.reject(new Error('disk full')))).rejects.toThrow(
      'disk full',
    );
    expect(events).toEqual([]);
    expect(reloader.current().label).toBe('g1');
    expect(reloader.generation).toBe(1);
  });

  it('reloads are serialised: the second builds only after the first has swapped', async () => {
    let builds = 0;
    const order: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const reloader = createCatalogueReloader<Gen>({
      initial: { catalogue: V1, label: 'g1' },
      async build() {
        builds += 1;
        const label = `b${builds}`;
        order.push(`build:${label}`);
        if (builds === 1) await gate;
        return { catalogue: V1, label };
      },
      commit: (next) => order.push(`commit:${next.label}`),
      notify: () => Promise.resolve(),
    });
    const first = reloader.reload(() => Promise.resolve(null));
    const second = reloader.reload(() => Promise.resolve(null));
    await Promise.resolve();
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(order).toEqual(['build:b1', 'commit:b1', 'build:b2', 'commit:b2']);
    expect(a.outcome).toMatchObject({ ok: true, generation: 2 });
    expect(b.outcome).toMatchObject({ ok: true, generation: 3 });
  });

  it('a failed notification does not unmake a swap that happened', async () => {
    const reloader = createCatalogueReloader<Gen>({
      initial: { catalogue: V1, label: 'g1' },
      build: () => Promise.resolve({ catalogue: V1, label: 'g2' }),
      commit: () => undefined,
      notify: () => Promise.reject(new Error('transport gone')),
    });
    const { outcome } = await reloader.reload(() => Promise.resolve(null));
    expect(outcome.ok).toBe(true);
    expect(reloader.current().label).toBe('g2');
  });
});

describe('W0-P33c — unversionedChanges', () => {
  it('names only tools present in both whose bytes changed and version did not', () => {
    const next = catalogue({
      'jde.fin.journal.create': { version: '1.0.0', sha: 'a2' }, // changed, same version
      'jde.ap.voucher.get': { version: '1.1.0', sha: 'b2' }, // changed, bumped
      'jde.ap.voucher.create': { version: '1.0.0', sha: 'c1' }, // new
    });
    expect(unversionedChanges(V1, next).map((f) => f.file)).toEqual([
      'manifests/jde.fin.journal.create.tool.yaml',
    ]);
  });
});
