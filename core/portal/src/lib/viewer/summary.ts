// MCPForge — W0-P5b: the viewer as the client may see it.
//
// Client-safe. Built on the server from a `Viewer` and handed to the shell as
// a prop. It carries no token, no refresh token and no session id, so passing
// it across the server/client boundary leaks no credential.

import type { Persona } from './personas';

export interface ViewerSummary {
  readonly subject: string;
  readonly displayName: string;
  /** HELD personas. The pill offers exactly these and nothing else. */
  readonly personas: readonly Persona[];
  /** The lens in effect, or null when none is held. */
  readonly persona: Persona | null;
}

export function toViewerSummary(
  viewer: {
    readonly subject: string;
    readonly displayName: string;
    readonly personas: readonly Persona[];
    readonly persona: Persona | null;
  } | null,
): ViewerSummary | null {
  if (viewer === null) return null;
  return {
    subject: viewer.subject,
    displayName: viewer.displayName,
    personas: [...viewer.personas],
    persona: viewer.persona,
  };
}
