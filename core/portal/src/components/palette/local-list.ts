// MCPForge — W0-J11: recents/pins, per-user browser-local state (03 §9.2
// rule 6: "Recents and pins are per-user browser-local state"). Judgment
// call, same caveats as every prior browser-storage use in this codebase
// (`shell/topbar.tsx`'s `persistTheme`, `data/use-facet-state.ts`'s URL
// state is server-shareable but this is deliberately NOT — recents/pins are
// per-device convenience, not state a change proposal or an agent needs to
// see): wrapped in try/catch throughout, an injectable storage so tests can
// simulate a browser that throws (private mode, blocked site data), and a
// `null`-safe fallback on the server (`typeof window === 'undefined'`) so
// this module is safe to import from a server component without a guard at
// every call site.
const RECENTS_KEY = 'mcpforge-palette-recents';
const PINS_KEY = 'mcpforge-palette-pins';
const MAX_RECENTS = 8;

type MinimalStorage = Pick<Storage, 'getItem' | 'setItem'>;

function resolveStorage(storage: MinimalStorage | undefined): MinimalStorage | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function safeGetList(storage: MinimalStorage | undefined, key: string): string[] {
  const target = resolveStorage(storage);
  if (!target) return [];
  try {
    const raw = target.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function safeSetList(storage: MinimalStorage | undefined, key: string, list: readonly string[]): void {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.setItem(key, JSON.stringify(list));
  } catch {
    /* storage blocked/unavailable — state stays in-memory for this session only. */
  }
}

export function getRecents(storage?: MinimalStorage): string[] {
  return safeGetList(storage, RECENTS_KEY);
}

/** Move `toolId` to the front, de-duplicated, capped at `MAX_RECENTS`. */
export function addRecent(toolId: string, storage?: MinimalStorage): string[] {
  const next = [toolId, ...getRecents(storage).filter((id) => id !== toolId)].slice(0, MAX_RECENTS);
  safeSetList(storage, RECENTS_KEY, next);
  return next;
}

export function getPins(storage?: MinimalStorage): string[] {
  return safeGetList(storage, PINS_KEY);
}

/** Toggle `toolId`'s pinned state. Returns the new pin list. */
export function togglePin(toolId: string, storage?: MinimalStorage): string[] {
  const current = getPins(storage);
  const next = current.includes(toolId)
    ? current.filter((id) => id !== toolId)
    : [...current, toolId];
  safeSetList(storage, PINS_KEY, next);
  return next;
}
