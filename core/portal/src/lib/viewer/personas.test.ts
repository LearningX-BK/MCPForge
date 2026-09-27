// MCPForge — W0-P5b: the persona list and the lens rules.

import { describe, expect, it } from 'vitest';
import { PERSONAS as GATEWAY_PERSONAS } from '@mcpforge/gateway/identity/group-role-mapping';

import { PERSONAS, effectivePersona, personaTooltip } from './personas';

describe('personas', () => {
  it('restates the gateway’s closed persona list exactly (the client cannot import it)', () => {
    expect([...PERSONAS]).toEqual([...GATEWAY_PERSONAS]);
  });

  it('the lens is a held persona: a requested one not held is ignored, never honoured', () => {
    expect(effectivePersona('admin', ['business'])).toBe('business');
    expect(effectivePersona('superuser', ['developer', 'admin'])).toBe('developer');
    expect(effectivePersona('admin', ['developer', 'admin'])).toBe('admin');
    expect(effectivePersona(undefined, ['business'])).toBe('business');
  });

  it('holding no persona means no lens, not a default one', () => {
    expect(effectivePersona('admin', [])).toBeNull();
    expect(effectivePersona(null, [])).toBeNull();
  });

  it('the tooltip is W0-P4 §6, naming only held personas', () => {
    expect(personaTooltip(['developer', 'admin'])).toBe(
      'Persona is a view, not a permission. It changes where you land and what is emphasised. ' +
        'What you can actually do is decided by the gateway from your roles, whatever this pill says. ' +
        'You can switch to: Developer, Admin.',
    );
    expect(personaTooltip([])).toMatch(/You can switch to: none\.$/);
  });
});
