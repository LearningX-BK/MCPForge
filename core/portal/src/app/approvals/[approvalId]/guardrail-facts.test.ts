// MCPForge — W0-P3f: the approver is told the DECLARED guardrails, at the
// request's own tool version, and never a value the gateway did not record.
import { describe, expect, it } from 'vitest';

import { resolveRepoRoot } from '../../build/_lib/repo-root';
import { declaredGuardrails, VALUE_NOT_RECORDED } from './guardrail-facts';

const ROOT = resolveRepoRoot();

describe('declaredGuardrails', () => {
  it('lists the committed manifest’s guardrails as passed, with the value not recorded', () => {
    const facts = declaredGuardrails('jde.ap.voucher.create', '1.0.0', ROOT);
    expect(facts.kind).toBe('declared');
    if (facts.kind !== 'declared') return;
    expect(facts.results.length).toBeGreaterThan(0);
    expect(facts.results.map((r) => r.label)).toContain('amount at most 250000');
    for (const r of facts.results) {
      expect(r.passed).toBe(true);
      expect(r.valueChecked).toBe(VALUE_NOT_RECORDED);
    }
  });

  it('lists nothing when the committed manifest is another version', () => {
    expect(declaredGuardrails('jde.ap.voucher.create', '0.9.0', ROOT).kind).toBe('version-unknown');
    expect(declaredGuardrails('jde.ap.voucher.create', null, ROOT).kind).toBe('version-unknown');
  });

  it('lists nothing for a tool that is not committed', () => {
    expect(declaredGuardrails('no.such.tool.create', '1.0.0', ROOT).kind).toBe('version-unknown');
  });
});
