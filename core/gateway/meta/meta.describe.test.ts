// MCPForge — `forge.describe`, 02 §5.2 tool 2.
//
// The rungs of 02 §5.8's degradation ladder that matter here: a client that
// never re-lists still reaches every tool through find → describe → invoke, so
// `describe` must answer for anything `find` returned — including a card it
// returned with `access: "disabled"` or `"requires_grant"`, which is the same
// "no dead ends" reading §4.5 applied to the card itself.

import { describe, expect, it } from 'vitest';
import { DESCRIBE_MAX_TOOLS, forgeDescribe } from './describe.js';
import { CORRELATION_ID, metaContext, TOOLS } from './meta.fixtures.js';

describe('forge.describe', () => {
  it('returns the full definition for a tool in scope', () => {
    const response = forgeDescribe(
      metaContext(),
      { toolIds: [TOOLS.voucherSearch] },
      CORRELATION_ID,
    );
    expect(response.result).toBe('tools');
    if (response.result !== 'tools') return;
    expect(response.tools[0]!.id).toBe(TOOLS.voucherSearch);
    expect(response.tools[0]!.access).toBe('available');
    expect(response.tools[0]!.detail['inputSchema']).toBeDefined();
    expect(response.tools[0]!.detail['examples']).toBeDefined();
  });

  it('describes a requires_grant tool, and says so, rather than dead-ending the agent', () => {
    const response = forgeDescribe(
      metaContext(),
      { toolIds: [TOOLS.voucherCreate] },
      CORRELATION_ID,
    );
    if (response.result !== 'tools') throw new Error('expected tools');
    expect(response.tools[0]!.access).toBe('requires_grant');
    expect(response.tools[0]!.agentMessage).toContain('bindingGrant');
  });

  it('refuses a tool outside the findable set with TOOL_NOT_IN_SCOPE and a real next', () => {
    const response = forgeDescribe(
      metaContext(),
      { toolIds: [TOOLS.journalCreate] },
      CORRELATION_ID,
    );
    expect(response.result).toBe('error');
    if (response.result !== 'error') return;
    expect(response.error.code).toBe('TOOL_NOT_IN_SCOPE');
    expect(response.error.next.toLowerCase()).not.toContain('try again');
  });

  it(`refuses more than ${DESCRIBE_MAX_TOOLS} ids, and an empty list`, () => {
    const many = Array.from({ length: DESCRIBE_MAX_TOOLS + 1 }, (_, i) => `jde.ap.x_${i}.get`);
    for (const ids of [many, []]) {
      const response = forgeDescribe(metaContext(), { toolIds: ids }, CORRELATION_ID);
      expect(response.result).toBe('error');
      if (response.result !== 'error') continue;
      expect(response.error.code).toBe('INPUT_INVALID');
      expect(response.error.next.trim().length).toBeGreaterThan(0);
    }
  });
});
