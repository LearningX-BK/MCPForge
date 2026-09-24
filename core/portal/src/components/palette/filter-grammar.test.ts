// MCPForge — W0-J11: filter-grammar parsing (03 §9.2 rule 1).
import { describe, expect, it } from 'vitest';

import { completionsForPartialPrefix, parseQuery } from './filter-grammar';

describe('parseQuery — each documented prefix, extracted and mapped', () => {
  it('extracts app: into findInput.app and strips it from the free text', () => {
    const parsed = parseQuery('record a supplier invoice app:jde');
    expect(parsed.findInput.app).toBe('jde');
    expect(parsed.text).toBe('record a supplier invoice');
  });

  it('extracts module:, entity:, verb:, package: and process: onto their FindInput fields', () => {
    const parsed = parseQuery('module:ap entity:voucher verb:create package:jde-fin process:p2p');
    expect(parsed.findInput).toMatchObject({
      module: 'ap',
      entity: 'voucher',
      verb: 'create',
      package: 'jde-fin',
      process: 'p2p',
    });
    expect(parsed.text).toBe('');
  });

  it('maps binding: onto FindInput.bindingType (the one prefix whose name differs from the field)', () => {
    const parsed = parseQuery('binding:plsql');
    expect(parsed.findInput.bindingType).toBe('plsql');
    expect(parsed.findInput).not.toHaveProperty('binding');
  });

  it('parses write:true and write:false as real booleans, not strings', () => {
    expect(parseQuery('write:true').findInput.write).toBe(true);
    expect(parseQuery('write:false').findInput.write).toBe(false);
  });

  it('drops a write: token with a garbage value rather than passing a bad type through', () => {
    const parsed = parseQuery('write:maybe');
    expect(parsed.findInput.write).toBeUndefined();
  });

  it('parses role:, status: and sens: into clientFilters, NOT into findInput (documented gap: no FindInput field for these)', () => {
    const parsed = parseQuery('role:p2p status:disabled sens:financial');
    expect(parsed.clientFilters).toEqual({ role: 'p2p', status: 'disabled', sens: 'financial' });
    expect(parsed.findInput).toEqual({});
    expect(parsed.text).toBe('');
  });

  it('mixes free text and multiple filter tokens in one query', () => {
    const parsed = parseQuery('  record a supplier invoice against a PO  app:jde   write:true  ');
    expect(parsed.text).toBe('record a supplier invoice against a PO');
    expect(parsed.findInput).toMatchObject({ app: 'jde', write: true });
  });

  it('leaves an unrecognised key:value token in the free text untouched', () => {
    const parsed = parseQuery('supplier:acme corp');
    expect(parsed.findInput).toEqual({});
    expect(parsed.clientFilters).toEqual({});
    expect(parsed.text).toBe('supplier:acme corp');
  });

  it('round-trips a plain query with no filter tokens at all', () => {
    const parsed = parseQuery('find a way to submit an invoice');
    expect(parsed.text).toBe('find a way to submit an invoice');
    expect(parsed.findInput).toEqual({});
  });
});

describe('completionsForPartialPrefix — "app:" discoverable inline (03 §9.2 rule 1)', () => {
  it('offers every prefix starting with the typed partial', () => {
    expect(completionsForPartialPrefix('ap')).toEqual(['app']);
    expect(completionsForPartialPrefix('s')).toEqual(expect.arrayContaining(['sens', 'status']));
  });

  it('returns nothing for an empty partial', () => {
    expect(completionsForPartialPrefix('')).toEqual([]);
  });

  it('returns nothing when no prefix matches', () => {
    expect(completionsForPartialPrefix('zzz')).toEqual([]);
  });
});
