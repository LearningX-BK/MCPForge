// MCPForge — W0-J13: facet groups and filtering, over real `ToolManifest` fixtures.
import { describe, expect, it } from 'vitest';

import { buildFacetGroups, filterCatalog, DEFAULT_FACET_STATE, FREE_TEXT_KEY } from './facet-defs';
import { fixtureCatalogSource } from './fixtures';

const data = fixtureCatalogSource();

describe('buildFacetGroups', () => {
  it('builds exactly the twelve grouped facets (free text is the thirteenth, ungrouped)', () => {
    const groups = buildFacetGroups(data, data.tools);
    const keys = groups.map((g) => g.key);
    expect(keys).toEqual([
      'app',
      'server',
      'archetype',
      'binding',
      'package',
      'verb',
      'write',
      'sensitivity',
      'process',
      'role',
      'status',
      'change',
    ]);
  });

  it('every option count is a real count over the supplied rows', () => {
    const groups = buildFacetGroups(data, data.tools);
    const app = groups.find((g) => g.key === 'app')!;
    const jde = app.options.find((o) => o.value === 'jde')!;
    expect(jde.count).toBe(data.tools.filter((t) => t.manifest.app === 'jde').length);
  });
});

describe('filterCatalog', () => {
  it('an empty facet state returns every tool', () => {
    expect(filterCatalog(data, {})).toHaveLength(data.tools.length);
  });

  it('DEFAULT_FACET_STATE preselects resolved + degraded_readonly probe status', () => {
    const filtered = filterCatalog(data, DEFAULT_FACET_STATE);
    expect(filtered.every((t) => t.probeStatus === 'resolved' || t.probeStatus === 'degraded_readonly')).toBe(true);
    expect(filtered.length).toBeLessThan(data.tools.length);
  });

  it('filters by binding type', () => {
    const filtered = filterCatalog(data, { binding: ['plsql'] });
    expect(filtered.every((t) => t.manifest.binding.type === 'plsql')).toBe(true);
    expect(filtered.length).toBeGreaterThan(0);
  });

  it('filters by write tri-state', () => {
    const writeOnly = filterCatalog(data, { write: ['write'] });
    expect(writeOnly.every((t) => t.manifest.write)).toBe(true);
    const readOnly = filterCatalog(data, { write: ['read'] });
    expect(readOnly.every((t) => !t.manifest.write)).toBe(true);
  });

  it('filters by free text against id/purpose/aliases', () => {
    const filtered = filterCatalog(data, { [FREE_TEXT_KEY]: ['voucher'] });
    expect(filtered.every((t) => t.manifest.id.includes('voucher'))).toBe(true);
    expect(filtered.length).toBeGreaterThan(0);
  });

  it('filters by role — every returned tool is in that role scope', () => {
    const filtered = filterCatalog(data, { role: ['p2p'] });
    const role = data.roles.find((r) => r.id === 'p2p')!;
    expect(filtered.every((t) => role.toolIds.includes(t.manifest.id))).toBe(true);
  });

  it('filters by package', () => {
    const filtered = filterCatalog(data, { package: ['oic-integ'] });
    expect(filtered.every((t) => t.packages.includes('oic-integ'))).toBe(true);
    expect(filtered.length).toBeGreaterThan(0);
  });

  it('filters by change state', () => {
    const filtered = filterCatalog(data, { change: ['draft'] });
    expect(filtered.every((t) => t.changeState === 'draft')).toBe(true);
    expect(filtered.length).toBeGreaterThan(0);
  });

  it('combines facets with AND semantics across groups', () => {
    const filtered = filterCatalog(data, { app: ['jde'], write: ['write'] });
    expect(filtered.every((t) => t.manifest.app === 'jde' && t.manifest.write)).toBe(true);
  });
});
