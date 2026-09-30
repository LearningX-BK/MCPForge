// MCPForge — how the approval blocks name a person and a time. W0-J8.
//
// Moved out of `approval-gate-card.tsx` in W0-P3f, when that card was deleted
// (owner decision, 30 Sep 2026: it needs the call's argument values, which the
// approval queue deliberately does not store). The approver's panel and the
// replay notice still use these two.

import type { ApprovalPersonView } from './types';

/** How a person is named in prose. Subject is the audit value; it always shows. */
export function personLabel(person: ApprovalPersonView): string {
  return person.displayName ? `${person.displayName} (${person.subject})` : person.subject;
}

/** `14:02` — a local time of day, for "already made at 14:03". */
export function timeOfDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
