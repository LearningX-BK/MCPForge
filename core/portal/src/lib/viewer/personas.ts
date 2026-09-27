// MCPForge — W0-P5b: the portal's personas (03 §2, W0-P4 §2 and §6).
//
// Client-safe: no node imports, so the persona pill can use it. The list is
// restated from the gateway's `PERSONAS` (`core/gateway/identity/
// group-role-mapping.ts`), which a client bundle cannot import because that
// module reads the filesystem. `personas.test.ts` pins the two together.
//
// **A persona is a lens, never a permission.** It changes where the viewer
// lands and what is emphasised. What the viewer may do in the portal is
// decided from the personas they HOLD (./gates.ts), never from the one
// selected on the pill. What they may do through the gateway is decided by
// the gateway from their roles, whatever the pill says.

export const PERSONAS = ['developer', 'business', 'admin'] as const;
export type Persona = (typeof PERSONAS)[number];

export const PERSONA_LABEL: Readonly<Record<Persona, string>> = {
  developer: 'Developer',
  business: 'Business',
  admin: 'Admin',
};

/** Where each lens lands (03 §2: "it changes where you land"). */
export const PERSONA_LANDING: Readonly<Record<Persona, string>> = {
  developer: '/build',
  business: '/requests',
  admin: '/governance',
};

export function isPersona(value: unknown): value is Persona {
  return typeof value === 'string' && (PERSONAS as readonly string[]).includes(value);
}

/**
 * The lens actually in effect. A requested persona the viewer does not hold is
 * ignored rather than honoured, so a crafted request cannot select one. With
 * none requested, the first held persona applies. With none held, there is no
 * lens: the viewer still sees every page.
 */
export function effectivePersona(
  requested: string | undefined | null,
  held: readonly Persona[],
): Persona | null {
  if (isPersona(requested) && held.includes(requested)) return requested;
  return held[0] ?? null;
}

/** W0-P4 §6, verbatim apart from the held-persona list. */
export function personaTooltip(held: readonly Persona[]): string {
  const list = held.length === 0 ? 'none' : held.map((p) => PERSONA_LABEL[p]).join(', ');
  return (
    'Persona is a view, not a permission. It changes where you land and what is emphasised. ' +
    'What you can actually do is decided by the gateway from your roles, whatever this pill says. ' +
    `You can switch to: ${list}.`
  );
}
