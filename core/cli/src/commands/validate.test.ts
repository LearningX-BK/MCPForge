import { describe, expect, it } from 'vitest';
import { formatValidationReportHuman } from './validate.js';

// The two Role-ahead-of-its-tools rules are warnings, not failures (a named
// W0-I1 exception). A warning that is downgraded AND invisible would be a
// silent hole, so this asserts the human rendering still prints it on an
// otherwise-passing run.
describe('formatValidationReportHuman — warnings stay visible on a passing run', () => {
  it('prints the warning block, its rule id and its fix even when ok is true', () => {
    const text = formatValidationReportHuman({
      ok: true,
      filesChecked: 5,
      failures: [],
      warnings: [
        {
          ruleId: 'ref.role-core-tool-not-found',
          severity: 'warning',
          file: 'roles/p2p.yaml',
          path: '/coreTools/0',
          message: 'coreTools entry "jde.scm.purchase_order.create" does not match any Tool yet.',
          fix: 'Author the Tool manifest for "jde.scm.purchase_order.create".',
        },
      ],
    });
    expect(text).toContain('OK');
    expect(text).toContain('1 warning(s)');
    expect(text).toContain('ref.role-core-tool-not-found');
    expect(text).toContain('roles/p2p.yaml/coreTools/0');
    expect(text).toContain('fix:');
  });
});
