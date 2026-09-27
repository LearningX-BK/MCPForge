// MCPForge — W0-P5b: the viewer of the CURRENT request.
//
// SERVER-ONLY (`next/headers`). The one place the session cookie is read.
// Server components call `getViewer()` to render; server actions call it to
// decide. Nothing takes a viewer, an author or a persona from a component
// argument (W0-P4 §3).

import { cookies } from 'next/headers';

import { gatewayRefresh } from './gateway-auth';
import { heldPersonas } from './mapping';
import { resolveViewer, type Viewer } from './viewer';

/** The session cookie. Its value is an opaque id; see `./session-store.ts`. */
export const SESSION_COOKIE = 'mcpforge_session';

export async function sessionIdFromCookies(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function getViewer(): Promise<Viewer | null> {
  const id = await sessionIdFromCookies();
  if (id === undefined || id.length === 0) return null;
  return resolveViewer(id, {
    refresh: (refreshToken) => gatewayRefresh(refreshToken),
    personasFor: (groups) => heldPersonas(groups),
  });
}

export type { Viewer };
