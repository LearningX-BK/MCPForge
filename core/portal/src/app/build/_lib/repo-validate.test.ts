// MCPForge — W0-J14: `runFullDraftValidation` — the sandboxed, real
// `validateRepo` seam. Integration-shaped: it runs against a temp copy of
// THIS repo's real manifests/roles/packages/enums, proving the sandbox
// approach actually resolves referential/policy rules (e.g. disambiguation
// against real sibling tools), not just a mocked call.
import { describe, expect, it } from 'vitest';
import { runFullDraftValidation } from './repo-validate';
import { loadBuildDrafts } from '../fixtures';

describe('runFullDraftValidation', () => {
  it('validates a real, already-valid seeded draft clean against the real repo', async () => {
    const draft = loadBuildDrafts()[0]!; // jde.ap.voucher.create
    const result = await runFullDraftValidation('manifests/jde/fin/ap/voucher.create.tool.yaml', draft.yaml);
    expect(result.ok).toBe(true);
    expect(result.failures).toHaveLength(0);
  }, 30000);

  it('fails the elevated-binding expedited-review policy rule for a plsql binding with expedited review', async () => {
    const draft = loadBuildDrafts()[0]!;
    const broken = draft.yaml
      .replace('type: function # rest | database | plsql | function | wrapped-vendor', 'type: plsql')
      .replace('reviewPath: standard # expedited is structurally unavailable for plsql/function and for irreversible writes', 'reviewPath: expedited');
    const result = await runFullDraftValidation('manifests/jde/fin/ap/voucher.create.tool.yaml', broken);
    expect(result.ok).toBe(false);
    const hit = result.failures.find((f) => f.ruleId === 'policy.expedited-review-elevated-binding');
    expect(hit).toBeDefined();
    expect(hit?.concernsDraft).toBe(true);
  }, 30000);

  it('fails structurally when a required field is missing, tagged as concerning the draft', async () => {
    const draft = loadBuildDrafts()[0]!;
    const broken = draft.yaml.replace(/^id: .*$/m, '');
    const result = await runFullDraftValidation('manifests/jde/fin/ap/voucher.create.tool.yaml', broken);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.concernsDraft)).toBe(true);
  }, 30000);
});
