'use client';
// MCPForge — W0-J14: the right pane (03 §5.3 "Build") — validate rules,
// codegen diff, contract-test results, token budget, role budget impact and
// SoD implications. Runs `_lib/checks.ts`'s server action (the real
// `validateRepo` + `runTokenBudgetGate` + `runCodegen`, sandboxed) on demand,
// never on every keystroke (see that module's header for why).
import * as React from 'react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { runDraftChecks, type DraftChecksResult } from '../_lib/checks';
import type { ViewGuardrail } from '@mcpforge/codegen/templates';

export interface ChecksPaneProps {
  readonly manifestPath: string;
  readonly yamlText: string;
  readonly toolId: string;
  readonly sodGuardrails: readonly ViewGuardrail[];
}

function ResultRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-2 py-1 text-[12.5px]',
        ok
          ? 'border-status-ok-border bg-status-ok-bg text-status-ok-strong'
          : 'border-status-danger-border bg-status-danger-bg text-status-danger-strong',
      )}
    >
      <span aria-hidden="true">{ok ? '✓' : '✕'}</span>
      <span>{label}</span>
    </div>
  );
}

export function ChecksPane({ manifestPath, yamlText, toolId, sodGuardrails }: ChecksPaneProps): React.ReactElement {
  const [result, setResult] = React.useState<DraftChecksResult | null>(null);
  const [running, setRunning] = React.useState(false);

  const runChecks = React.useCallback(() => {
    setRunning(true);
    runDraftChecks(manifestPath, yamlText, toolId)
      .then(setResult)
      .finally(() => setRunning(false));
  }, [manifestPath, yamlText, toolId]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3" aria-label="Checks">
      <div className="flex items-center justify-between">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.4px] text-text-2">Checks</h2>
        <Button size="sm" onClick={runChecks} disabled={running} data-testid="run-checks-button">
          {running ? 'Running…' : 'Run checks'}
        </Button>
      </div>

      {/* SoD implications — always shown, from the draft's own declared guardrails (no sandbox needed). */}
      <section aria-label="SoD implications" data-testid="sod-implications" className="flex flex-col gap-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.4px] text-text-2">SoD implications</h3>
        {sodGuardrails.length === 0 ? (
          <p className="text-[12.5px] text-text-2">No `sodConflict` guardrail declared on this tool.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {sodGuardrails.map((g, i) => (
              <li key={i} className="rounded-md border border-status-write-border bg-status-write-bg p-2 text-[12.5px] text-status-write-strong">
                Conflicts with <span className="font-mono">{g.with}</span> (scope: {g.scope ?? 'unspecified'})
              </li>
            ))}
          </ul>
        )}
      </section>

      {result === null ? (
        <p className="text-[12.5px] text-text-2">Run checks to validate this draft against the repo's other manifests.</p>
      ) : (
        <>
          {result.sandboxError ? (
            <p className="rounded-md border border-status-danger-border bg-status-danger-bg p-2 text-[12.5px] text-status-danger-strong">
              Check run failed: {result.sandboxError}
            </p>
          ) : null}

          <section aria-label="Validate rules" data-testid="validate-rules">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.4px] text-text-2">Validate rules</h3>
            {result.validate.failures.length === 0 ? (
              <ResultRow ok label="forge validate: 0 failures" />
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {result.validate.failures.map((f, i) => (
                  <li key={i} className="rounded-md border border-status-danger-border bg-status-danger-bg p-2 text-[12.5px] text-status-danger-strong">
                    <span className="font-mono">{f.ruleId}</span> {f.path}: {f.message}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Token budget">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.4px] text-text-2">Token budget</h3>
            {result.tokenBudget.toolMeasurement ? (
              <ul className="mt-1 flex flex-col gap-1 text-[12.5px] text-text-1">
                <li>Card: {result.tokenBudget.toolMeasurement.cardTokens} / 60</li>
                <li>Resident: {result.tokenBudget.toolMeasurement.residentTokens} / 400</li>
                <li>Describe: {result.tokenBudget.toolMeasurement.describeTokens} / 600</li>
              </ul>
            ) : (
              <p className="text-[12.5px] text-text-2">No measurement (draft id not resolvable as a Tool).</p>
            )}
          </section>

          <section aria-label="Role budget impact" data-testid="role-budget-impact">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.4px] text-text-2">Role budget impact</h3>
            {result.roleBudgetImpact.length === 0 ? (
              <p className="text-[12.5px] text-text-2">This draft is not core for any role.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1 text-[12.5px]">
                {result.roleBudgetImpact.map((r) => (
                  <li key={r.roleId} className={r.overBudget ? 'text-status-danger-strong' : 'text-text-1'}>
                    {r.roleId}: {r.coreSetTokens} / 1300{r.overBudget ? ' — over budget' : ''}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Codegen" data-testid="codegen-report">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.4px] text-text-2">Codegen</h3>
            <ResultRow ok={result.codegen.ok} label={`forge codegen: ${result.codegen.filesWritten.length} files, ${result.codegen.contractDrift.length} contract drift`} />
            <p className="mt-1 text-[11.5px] text-text-2">
              Contract-test result: not executed by this check (running the generated vitest file per edit is out of
              this task's scope — see the task report's disclosed gap). The generated contract test file is listed
              among codegen's written files above; run it with <span className="font-mono">pnpm test</span> after
              proposing.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
