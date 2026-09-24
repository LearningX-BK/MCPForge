// MCPForge — W0-J10: pure encode/decode round-trip, no DOM/router needed.
import { describe, expect, it } from 'vitest';

import {
  clearAllFacets,
  clearFacetGroup,
  decodeFacets,
  encodeFacets,
  isFacetSelected,
  toggleFacet,
  type FacetState,
} from './facets';

describe('encodeFacets / decodeFacets', () => {
  it('round-trips a multi-group selection', () => {
    const state: FacetState = {
      app: ['jde'],
      verb: ['create', 'update'],
      write: ['true'],
    };
    const encoded = encodeFacets(state);
    expect(decodeFacets(encoded)).toEqual(state);
  });

  it('produces a real URLSearchParams-compatible string', () => {
    const encoded = encodeFacets({ app: ['jde'], verb: ['create'] });
    const params = new URLSearchParams(encoded);
    expect(params.get('app')).toBe('jde');
    expect(params.get('verb')).toBe('create');
  });

  it('is stable across key order — same selection encodes identically', () => {
    const a = encodeFacets({ verb: ['create'], app: ['jde'] });
    const b = encodeFacets({ app: ['jde'], verb: ['create'] });
    expect(a).toBe(b);
  });

  it('drops empty groups entirely rather than encoding `key=`', () => {
    const encoded = encodeFacets({ app: [], verb: ['create'] });
    expect(encoded).not.toContain('app=');
  });

  it('decodes a leading-? query string the same as a bare one', () => {
    expect(decodeFacets('?app=jde')).toEqual({ app: ['jde'] });
    expect(decodeFacets('app=jde')).toEqual({ app: ['jde'] });
  });

  it('de-duplicates and drops empty tokens within a group', () => {
    expect(decodeFacets('app=jde,jde,,ebs')).toEqual({ app: ['jde', 'ebs'] });
  });

  it('round-trips the empty state to an empty string', () => {
    expect(encodeFacets({})).toBe('');
    expect(decodeFacets('')).toEqual({});
  });
});

describe('toggleFacet / isFacetSelected / clearFacetGroup / clearAllFacets', () => {
  it('adds then removes a value, without mutating the input', () => {
    const start: FacetState = {};
    const withJde = toggleFacet(start, 'app', 'jde');
    expect(start).toEqual({});
    expect(isFacetSelected(withJde, 'app', 'jde')).toBe(true);

    const withoutJde = toggleFacet(withJde, 'app', 'jde');
    expect(isFacetSelected(withoutJde, 'app', 'jde')).toBe(false);
    expect(withoutJde['app']).toBeUndefined();
  });

  it('clearFacetGroup drops only the named group', () => {
    const state: FacetState = { app: ['jde'], verb: ['create'] };
    expect(clearFacetGroup(state, 'app')).toEqual({ verb: ['create'] });
  });

  it('clearAllFacets returns an empty state', () => {
    expect(clearAllFacets()).toEqual({});
  });
});
