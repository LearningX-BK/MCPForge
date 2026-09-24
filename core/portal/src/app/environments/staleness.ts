// MCPForge — W0-J17: staleness math (03 §11.4 — "staleness markers, not
// presence features"). No date library dependency; the arithmetic is small
// enough that pulling one in for this file alone would be the kind of
// unnecessary dependency the rest of the portal avoids.

/** Whole hours between `fromIso` and `now`. Never negative (clock skew floors to 0). */
export function hoursSince(fromIso: string, now: Date = new Date()): number {
  const ms = now.getTime() - Date.parse(fromIso);
  return Math.max(0, Math.floor(ms / 3_600_000));
}

/** 03 §11.4: "marks itself stale past 24 hours". */
export function isStale(fromIso: string, staleAfterHours: number, now: Date = new Date()): boolean {
  return hoursSince(fromIso, now) >= staleAfterHours;
}

/** "as of when" / "how stale" copy — a staleness marker, never a bare boolean. */
export function asOfLabel(fromIso: string, now: Date = new Date()): string {
  const hours = hoursSince(fromIso, now);
  if (hours < 1) return 'as of less than an hour ago';
  if (hours < 24) return `as of ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `as of ${days}d ago`;
}
