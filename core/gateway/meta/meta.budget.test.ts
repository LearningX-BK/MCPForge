// MCPForge — W0-G4 `done:` clause 1: "all four are ordinary MCP tools, always
// resident, and their combined resident cost measures ≤440 tokens with the
// pinned counter."
//
// A HARD-FAIL BUDGET TEST, in the discipline W0-B6 and W0-G5 already set: the
// number is measured with `@mcpforge/shared`'s pinned cl100k_base counter — the
// only tokenizer anything in MCPForge may measure with — over the exact wire
// shape `tools/list` returns, and the assertion is an inequality against a
// constant from 02 §5.2, not a snapshot that a regeneration could quietly
// re-baseline.

import { countJsonTokens } from '@mcpforge/shared';
import { describe, expect, it } from 'vitest';
import { META_TOOL_DEFINITIONS, META_TOOL_IDS, metaResidentWireShape } from './definitions.js';

/** 02 §5.2: "Total resident cost of the four meta-tools: ~440 tokens." */
const META_RESIDENT_TOKEN_BUDGET = 440;

describe('W0-G4 DONE: the four meta-tools cost ≤440 resident tokens', () => {
  it("there are exactly four, and they are 02 §5.2's four", () => {
    expect([...META_TOOL_IDS]).toEqual([
      'forge.find',
      'forge.describe',
      'forge.activate',
      'forge.invoke',
    ]);
    expect(META_TOOL_DEFINITIONS).toHaveLength(4);
  });

  it('each is an ordinary MCP tool: a name, a description and a plain JSON input schema', () => {
    for (const def of META_TOOL_DEFINITIONS) {
      expect(typeof def.name).toBe('string');
      expect(def.description.trim().length).toBeGreaterThan(0);
      expect(def.inputSchema['type']).toBe('object');
      // Plain JSON — no functions, no undefined, nothing that would not survive
      // a round trip through the wire.
      expect(JSON.parse(JSON.stringify(def))).toEqual(def);
    }
  });

  it('their combined resident cost is at or under 440 tokens with the pinned counter', () => {
    const counted = countJsonTokens(metaResidentWireShape());
    // Reported so a regression names the number, not just the failure.
    expect({ counted, budget: META_RESIDENT_TOKEN_BUDGET }).toMatchObject({
      budget: META_RESIDENT_TOKEN_BUDGET,
    });
    expect(counted).toBeLessThanOrEqual(META_RESIDENT_TOKEN_BUDGET);
  });

  it('no single meta-tool has quietly become most of the budget', () => {
    for (const def of META_TOOL_DEFINITIONS) {
      expect(countJsonTokens(def)).toBeLessThanOrEqual(META_RESIDENT_TOKEN_BUDGET / 2);
    }
  });
});
