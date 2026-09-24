// W0-P1 — stage 2's gate. Every case drives the gate through its injected
// runner, so the behaviour under test is the gate's own decision-making and
// not `forge validate`'s rule set (which has its own suite in
// core/codegen). The "does it really spawn the command" proof lives in
// stages.test.ts, where the fixture repo has no `core/cli/bin/forge.js` and
// the stage consequently fails.

import { describe, expect, it } from 'vitest';
import { runValidateGate, type ValidateRun } from './validate-gate.js';

const runnerReturning = (run: ValidateRun) => () => run;

const json = (value: unknown): ValidateRun => ({
  code: 0,
  stdout: `${JSON.stringify(value)}\n`,
  stderr: '',
});

describe('stage 2 — forge validate', () => {
  it('passes on a clean report and names how many files were checked', () => {
    const outcome = runValidateGate('/repo', runnerReturning(json({ ok: true, filesChecked: 17 })));
    expect(outcome.status).toBe('passed');
    expect(outcome.detail).toContain('17 manifest file(s) checked, 0 failures');
  });

  it('fails on any failure, naming the rule id, the file and the fix', () => {
    const outcome = runValidateGate(
      '/repo',
      runnerReturning({
        code: 1,
        stdout: `${JSON.stringify({
          ok: false,
          filesChecked: 17,
          failures: [
            {
              ruleId: 'policy.write-safety-incomplete',
              file: 'manifests/jde/fin/journal.create.tool.yaml',
              path: '.writeSafety',
              message: 'write: true requires a complete writeSafety block with a non-none dry-run strategy.',
              fix: 'add writeSafety.dryRun.strategy and reversal.class.',
            },
          ],
        })}\n`,
        stderr: '',
      }),
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toContain('1 failure(s)');
    expect(outcome.detail).toContain('policy.write-safety-incomplete');
    expect(outcome.detail).toContain('manifests/jde/fin/journal.create.tool.yaml.writeSafety');
    expect(outcome.detail).toContain('fix: add writeSafety.dryRun.strategy');
  });

  it('reports warnings without failing — W0-B8: a computed warning that is never printed is not a warning', () => {
    const outcome = runValidateGate(
      '/repo',
      runnerReturning(
        json({
          ok: true,
          filesChecked: 17,
          warnings: [
            {
              ruleId: 'sod-conflict-declared',
              file: 'roles/p2p.yaml',
              path: '.tools',
              message: 'p2p grants both voucher.create and voucher.approve.',
              fix: 'split the role or record the accepted conflict.',
            },
          ],
        }),
      ),
    );
    expect(outcome.status).toBe('passed');
    expect(outcome.detail).toContain('1 warning(s) — reported, not failing');
    expect(outcome.detail).toContain('sod-conflict-declared');
  });

  it('fails — never passes — when stdout is not parseable JSON, because it cannot tell a pass from a failure', () => {
    const outcome = runValidateGate(
      '/repo',
      runnerReturning({ code: 1, stdout: 'Cannot find module', stderr: 'node: no such file' }),
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toContain('not parseable JSON');
    expect(outcome.detail).toContain('next:');
  });

  it('fails when the command cannot be spawned at all, rather than skipping', () => {
    const outcome = runValidateGate('/repo', () => {
      throw new Error('ENOENT');
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toContain('could not be spawned');
  });

  it('never returns not_implemented under any input', () => {
    const inputs: ValidateRun[] = [
      json({ ok: true }),
      json({ ok: false, failures: [] }),
      { code: 137, stdout: '', stderr: 'killed' },
    ];
    for (const run of inputs) {
      expect(runValidateGate('/repo', runnerReturning(run)).status).not.toBe('not_implemented');
    }
  });
});
