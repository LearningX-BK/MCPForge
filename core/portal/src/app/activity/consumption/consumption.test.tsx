// @vitest-environment jsdom
//
// W0-Q1: the graph is built from calls (never a fixture), a tool with no
// consumer is shown, both pivots render, and a failed read is a notice.
import { cleanup, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it } from 'vitest';

import { ConsumptionView } from './consumption-view';
import { buildEdges, consumerNodes, toolNodes, type ConsumerFacts } from './graph';
import { loadConsumption } from './load';

const NOW = new Date('2026-10-06T12:00:00Z');
const facts: ConsumerFacts[] = [
  {
    consumerId: 'agent-a',
    label: 'Agent A',
    consumerClass: 'autonomous-agent',
    scope: {
      roles: ['p2p'],
      packages: ['jde-fin'],
      bindingTypes: ['function'],
      maxSensitivity: 'financial',
      writeAllowed: false,
    },
  },
  {
    consumerId: 'idle',
    label: 'Idle',
    consumerClass: 'interactive-client',
    scope: {
      roles: [],
      packages: [],
      bindingTypes: [],
      maxSensitivity: 'internal',
      writeAllowed: false,
    },
  },
];
const calls = [
  { toolId: 'a.b.c.get', consumerId: 'agent-a', ts: '2026-10-06T11:00:00Z' },
  { toolId: 'a.b.c.get', consumerId: 'agent-a', ts: '2026-10-06T10:00:00Z' },
  { toolId: 'a.b.c.get', consumerId: 'ghost', ts: '2026-10-05T10:00:00Z' },
  { toolId: 'a.b.c.get', consumerId: 'agent-a', ts: '2026-08-01T10:00:00Z' },
];
const since = NOW.getTime() - 7 * 86_400_000;

afterEach(cleanup);

describe('graph reducers', () => {
  const edges = buildEdges(calls, facts, since);
  it('counts calls per edge, keeps last call, drops out-of-window calls', () => {
    const e = edges.find((x) => x.consumerId === 'agent-a')!;
    expect(e.calls).toBe(2);
    expect(e.lastCallAt).toBe('2026-10-06T11:00:00Z');
  });
  it('keeps an unregistered consumer visible as such', () => {
    expect(edges.find((x) => x.consumerId === 'ghost')!.consumer).toBeNull();
  });
  it('keeps zero-consumer tools and zero-tool consumers', () => {
    expect(
      toolNodes(edges, ['a.b.c.get', 'x.y.z.list']).find((t) => t.toolId === 'x.y.z.list')!
        .totalCalls,
    ).toBe(0);
    expect(consumerNodes(edges, facts).find((c) => c.consumerId === 'idle')!.edges).toHaveLength(0);
  });
});

describe('ConsumptionView', () => {
  const edges = buildEdges(calls, facts, since);
  const props = {
    edges,
    toolIds: ['a.b.c.get', 'x.y.z.list'],
    consumers: facts,
    window: '7d' as const,
    atLeast: false,
    asOf: 'now',
  };
  it('tool pivot shows consumer class, scope, calls and a zero-consumer tool', () => {
    render(<ConsumptionView {...props} pivot="tool" />);
    expect(screen.getAllByTestId('edge-row')).toHaveLength(2);
    expect(screen.getByText(/roles p2p/)).not.toBeNull();
    expect(screen.getByTestId('zero-consumers-x.y.z.list')).not.toBeNull();
    expect(screen.getByTestId('zero-consumer-count').textContent).toContain('1 of 2');
  });
  it('consumer pivot shows a consumer with no tools', () => {
    render(<ConsumptionView {...props} pivot="consumer" />);
    expect(screen.getByTestId('zero-tools-idle')).not.toBeNull();
  });
});

describe('ConsumptionView — axe (serious/critical)', () => {
  const edges = buildEdges(calls, facts, since);
  const props = {
    edges,
    toolIds: ['a.b.c.get', 'x.y.z.list'],
    consumers: facts,
    window: '7d' as const,
    atLeast: true,
    asOf: 'now',
  };
  for (const pivot of ['tool', 'consumer'] as const) {
    it(`has no serious or critical violations, ${pivot} pivot`, async () => {
      const { container } = render(<ConsumptionView {...props} pivot={pivot} />);
      const r = await axe(container);
      expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
        [],
      );
    });
  }
});

describe('loadConsumption', () => {
  it('returns the gateway-down state, not an empty graph', async () => {
    const down = { kind: 'gateway-down', endpoint: 'http://x', next: 'Start it' } as const;
    const r = await loadConsumption('7d', { calls: async () => down, now: () => NOW });
    expect(r.kind).toBe('notice');
  });
  it('reads calls through the seam and reports a lower bound at the page cap', async () => {
    let n = 0;
    const r = await loadConsumption('7d', {
      now: () => NOW,
      calls: async () => {
        n += 1;
        return { kind: 'ok', data: { asOf: 'now', items: [], nextCursor: 'c' } } as never;
      },
    });
    expect(r.kind === 'ok' && r.atLeast).toBe(true);
    expect(n).toBe(10);
  });
});
