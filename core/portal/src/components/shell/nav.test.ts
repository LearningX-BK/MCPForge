// MCPForge — W0-J6: the nav model (03 §5.2).
import { describe, expect, it } from 'vitest';

import { activeGroupId, isDestinationActive, NAV, NAV_DESTINATIONS } from './nav';

describe('NAV — nine destinations, three groups (03 §5.2)', () => {
  it('has exactly nine destinations', () => {
    expect(NAV_DESTINATIONS).toHaveLength(9);
  });

  it('groups them WORK(4) / CONTROL(3) / PLATFORM(2)', () => {
    expect(NAV.map((g) => [g.id, g.destinations.length])).toEqual([
      ['work', 4],
      ['control', 3],
      ['platform', 2],
    ]);
  });

  it('every rail icon is visually and semantically distinct — no two destinations share an icon', () => {
    const names = NAV_DESTINATIONS.map((d) => d.icon.displayName ?? d.icon.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('only Approvals carries a badge', () => {
    const withBadge = NAV_DESTINATIONS.filter((d) => d.hasBadge).map((d) => d.id);
    expect(withBadge).toEqual(['approvals']);
  });
});

describe('isDestinationActive / activeGroupId', () => {
  it('matches Home only at the exact root path', () => {
    const home = NAV_DESTINATIONS.find((d) => d.id === 'home')!;
    expect(isDestinationActive(home, '/')).toBe(true);
    expect(isDestinationActive(home, '/catalog')).toBe(false);
  });

  it('matches a sub-route via matchPrefixes', () => {
    const catalog = NAV_DESTINATIONS.find((d) => d.id === 'catalog')!;
    expect(isDestinationActive(catalog, '/catalog/some-tool')).toBe(true);
    expect(isDestinationActive(catalog, '/catalog/servers/ebs')).toBe(true);
    expect(isDestinationActive(catalog, '/build')).toBe(false);
  });

  it('resolves the owning group id for a deep sub-route', () => {
    expect(activeGroupId('/approvals/req-1')).toBe('control');
    expect(activeGroupId('/environments/enablement')).toBe('platform');
    expect(activeGroupId('/build')).toBe('work');
  });
});
