// MCPForge — W0-I5, the DESIGN-TIME half of the segregation-of-duties
// demonstration, run against THIS REPOSITORY rather than against a fixture.
//
// `./compile.test.ts` (W0-B8) proves the two SoD rules work, using a fixture
// repo it controls. That is the right test for the RULE. It is not evidence
// about the real catalogue: it would keep passing if
// `manifests/jde/scm/po/purchase_order.create.tool.yaml` and
// `…approve.tool.yaml` were never authored, or if `roles/p2p.yaml` stopped
// granting them. This file asserts the thing W0-I5's done criterion actually
// claims — that the create/approve pair, as it really exists in `manifests/`,
// trips `sod.implicit-create-approve` when `roles/p2p.yaml` is really compiled.
//
// The call-time half is a SEPARATE test, deliberately:
// `tests/write-path/c.sod-po-create-approve.test.ts`. 02 §4.3 — "the role check
// catches design-time mistakes, the call check catches a caller who legitimately
// holds two roles that are individually fine."
//
// Severity is a `warning`, and 02 §4.3 says a warning "plus a required
// sodException record naming an approver". NO `sodException` RECORD SHAPE
// EXISTS ANYWHERE IN THIS REPOSITORY YET, and this task did not invent one:
// the warning is non-blocking by design, so `forge validate` and `forge codegen`
// pass without it, and the missing record is a governance artefact for a human
// (CLAUDE.md §8), not a schema for an agent to guess at. The assertions below
// pin the current, honest behaviour: reported, non-fatal, and visible.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateRepo } from '../validate/engine.js';
import { loadManifestFiles } from '../validate/loader.js';
import { resolvedKindAndId } from '../validate/structural.js';
import type { ValidationFailure } from '../validate/types.js';

const here = dirname(fileURLToPath(import.meta.url));
/** core/codegen/src/compile -> the repository root. */
const REPO_ROOT = join(here, '..', '..', '..', '..');

const PO_CREATE = 'jde.scm.purchase_order.create';
const PO_APPROVE = 'jde.scm.purchase_order.approve';
const ENTITY_PREFIX = 'jde.scm.purchase_order';

function byRule(list: readonly ValidationFailure[], ruleId: string): ValidationFailure[] {
  return list.filter((f) => f.ruleId === ruleId);
}

describe('W0-I5 DONE (design time): the real PO create/approve pair trips SoD detection', () => {
  it('both manifests are in the catalogue and validate', () => {
    const report = validateRepo(REPO_ROOT);
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);

    const ids = loadManifestFiles(REPO_ROOT)
      .map((file) => resolvedKindAndId(file))
      .filter((resolved): resolved is NonNullable<typeof resolved> => resolved !== null)
      .filter((resolved) => resolved.kind === 'Tool')
      .map((resolved) => resolved.id);
    expect(ids).toContain(PO_CREATE);
    expect(ids).toContain(PO_APPROVE);
  });

  it('roles/p2p.yaml compilation reports sod.implicit-create-approve as a WARNING', () => {
    const report = validateRepo(REPO_ROOT);

    const implicit = byRule(report.warnings, 'sod.implicit-create-approve');
    expect(implicit).toHaveLength(1);
    expect(implicit[0]!.file).toBe('roles/p2p.yaml');
    expect(implicit[0]!.severity).toBe('warning');
    expect(implicit[0]!.message).toContain(ENTITY_PREFIX);
    expect(implicit[0]!.message).toContain(PO_CREATE);
    expect(implicit[0]!.message).toContain(PO_APPROVE);

    // Non-blocking by design (W0-B8): the pattern is reported, never hidden,
    // and the build still passes. `forge validate` printing it is what puts it
    // in front of the human who owns the exception.
    expect(byRule(report.failures, 'sod.implicit-create-approve')).toEqual([]);
  });

  it('the pair is ALSO declared in the role, and the declared conflict is realised', () => {
    // roles/p2p.yaml declares the conflict with
    // `disposition: warn-and-require-exception`, so the declared rule fires as
    // a warning too — the one that names the required exception record.
    const report = validateRepo(REPO_ROOT);

    const declared = byRule(report.warnings, 'sod.declared-conflict');
    expect(declared).toHaveLength(1);
    expect(declared[0]!.file).toBe('roles/p2p.yaml');
    expect(declared[0]!.message).toContain(PO_CREATE);
    expect(declared[0]!.message).toContain(PO_APPROVE);
    expect(declared[0]!.fix).toContain('approver');

    // The implicit rule reports the pattern EVEN THOUGH it is declared, so a
    // steward cannot hide it from the report by declaring it with a soft
    // disposition (W0-B8).
    const implicit = byRule(report.warnings, 'sod.implicit-create-approve');
    expect(implicit[0]!.message).toContain('also declared');
  });
});
