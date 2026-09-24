// MCPForge — W0-J11: recents/pins, browser-local, wrapped safely (03 §9.2
// rule 6). Every read/write is exercised against a fake storage, including
// one that throws — the same caveat every prior browser-storage use in this
// codebase carries (`shell/topbar.tsx`'s `persistTheme`).
import { describe, expect, it } from 'vitest';

import { addRecent, getPins, getRecents, togglePin } from './local-list';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

function throwingStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  return {
    getItem: () => {
      throw new Error('storage blocked');
    },
    setItem: () => {
      throw new Error('storage blocked');
    },
  };
}

describe('getRecents / addRecent', () => {
  it('starts empty and records a tool id on addRecent', () => {
    const storage = memoryStorage();
    expect(getRecents(storage)).toEqual([]);
    const next = addRecent('jde.ap.voucher.create', storage);
    expect(next).toEqual(['jde.ap.voucher.create']);
    expect(getRecents(storage)).toEqual(['jde.ap.voucher.create']);
  });

  it('moves a re-added id to the front, de-duplicated', () => {
    const storage = memoryStorage();
    addRecent('a', storage);
    addRecent('b', storage);
    const next = addRecent('a', storage);
    expect(next).toEqual(['a', 'b']);
  });

  it('caps recents at 8, dropping the oldest', () => {
    const storage = memoryStorage();
    for (let i = 0; i < 10; i++) addRecent(`tool.${i}`, storage);
    const recents = getRecents(storage);
    expect(recents).toHaveLength(8);
    expect(recents[0]).toBe('tool.9');
    expect(recents).not.toContain('tool.0');
    expect(recents).not.toContain('tool.1');
  });
});

describe('getPins / togglePin', () => {
  it('pins and unpins a tool id', () => {
    const storage = memoryStorage();
    expect(togglePin('jde.ap.voucher.create', storage)).toEqual(['jde.ap.voucher.create']);
    expect(getPins(storage)).toEqual(['jde.ap.voucher.create']);
    expect(togglePin('jde.ap.voucher.create', storage)).toEqual([]);
    expect(getPins(storage)).toEqual([]);
  });
});

describe('a storage that throws on every call — the private-mode / blocked-site-data case', () => {
  it('getRecents returns [] rather than throwing', () => {
    expect(() => getRecents(throwingStorage())).not.toThrow();
    expect(getRecents(throwingStorage())).toEqual([]);
  });

  it('getPins returns [] rather than throwing', () => {
    expect(() => getPins(throwingStorage())).not.toThrow();
    expect(getPins(throwingStorage())).toEqual([]);
  });

  it('addRecent does not throw and still returns the in-memory-computed next list', () => {
    const storage = throwingStorage();
    expect(() => addRecent('jde.ap.voucher.create', storage)).not.toThrow();
    expect(addRecent('jde.ap.voucher.create', storage)).toEqual(['jde.ap.voucher.create']);
  });

  it('togglePin does not throw', () => {
    const storage = throwingStorage();
    expect(() => togglePin('jde.ap.voucher.create', storage)).not.toThrow();
  });
});

describe('malformed stored data', () => {
  it('ignores non-array JSON and returns []', () => {
    const storage = memoryStorage();
    storage.data.set('mcpforge-palette-recents', JSON.stringify({ not: 'an array' }));
    expect(getRecents(storage)).toEqual([]);
  });

  it('ignores unparsable JSON and returns []', () => {
    const storage = memoryStorage();
    storage.data.set('mcpforge-palette-recents', 'not json{{{');
    expect(getRecents(storage)).toEqual([]);
  });

  it('filters out non-string array entries', () => {
    const storage = memoryStorage();
    storage.data.set('mcpforge-palette-recents', JSON.stringify(['a', 42, null, 'b']));
    expect(getRecents(storage)).toEqual(['a', 'b']);
  });
});
