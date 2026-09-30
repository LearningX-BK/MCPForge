'use client';
// MCPForge — W0-J14: "Sandbox run" — for a write tool this exercises the
// FULL plan -> confirm -> execute path against mocks (03 §5.3), reusing the
// real write-path components (`@/components/write-path`, W0-J7/J8/J9) and
// their real state machine (`WritePathStep`) — never a second, parallel
// confirm flow.
import * as React from 'react';
import {
  PlanReviewCard,
  ConfirmAction,
  ResultCard,
  WritePathStepper,
  type WritePathStep,
} from '@/components/write-path';
import { Button } from '@/components/ui/button';
import type { ToolView } from '@mcpforge/codegen/templates';
import { buildSandboxPlan, buildSandboxResult } from '../_lib/sandbox-mocks';

export interface SandboxRunProps {
  readonly tool: ToolView;
}

type Phase = 'idle' | 'planned' | 'confirmed' | 'executed';

const PHASE_TO_STEP: Readonly<Record<Phase, WritePathStep>> = {
  idle: 'plan',
  planned: 'plan',
  confirmed: 'confirm',
  executed: 'execute',
};

export function SandboxRun({ tool }: SandboxRunProps): React.ReactElement {
  const [phase, setPhase] = React.useState<Phase>('idle');
  const sandbox = React.useMemo(() => buildSandboxPlan(tool), [tool]);

  if (!tool.write) {
    return (
      <div className="flex flex-col gap-3 p-3" aria-label="Sandbox run">
        <p className="text-[12.5px] text-text-2">
          This is a read tool. The sandbox run calls the mock target once and shows the result — there is no
          plan/confirm path for a read.
        </p>
        <Button size="sm" onClick={() => setPhase(phase === 'executed' ? 'idle' : 'executed')} data-testid="sandbox-run-button">
          {phase === 'executed' ? 'Reset' : 'Run in sandbox'}
        </Button>
        {phase === 'executed' ? <ResultCard result={buildSandboxResult(tool, sandbox.argValues)} /> : null}
      </div>
    );
  }

  // 03 §12.4: plan-state transitions announce on a polite `role="status"`
  // region — "Plan ready. Expires in 5 minutes." / "Executed. Voucher …
  // created." The sandbox run is the one place in this portal that
  // currently exercises the live write-path state machine end to end, so
  // it is the one place this announcement needs to fire for real.
  const statusText =
    phase === 'planned'
      ? 'Plan ready.'
      : phase === 'confirmed'
        ? 'Confirmed. Ready to execute.'
        : phase === 'executed'
          ? `Executed. ${buildSandboxResult(tool, sandbox.argValues).summary}`
          : null;

  return (
    <div className="flex flex-col gap-3 p-3" aria-label="Sandbox run">
      {statusText ? (
        <p role="status" aria-live="polite" data-testid="sandbox-status" className="sr-only">
          {statusText}
        </p>
      ) : null}
      <WritePathStepper current={PHASE_TO_STEP[phase]} approvalApplies={false} />

      {phase === 'idle' ? (
        <Button size="sm" onClick={() => setPhase('planned')} data-testid="sandbox-plan-button">
          Plan in sandbox
        </Button>
      ) : null}

      {phase === 'planned' || phase === 'confirmed' ? (
        <PlanReviewCard
          plan={sandbox.plan}
          guardrails={sandbox.guardrails}
          identity={sandbox.identity}
          locked={sandbox.locked}
          actions={
            <ConfirmAction
              consequence={sandbox.consequence}
              onConfirm={() => setPhase('confirmed')}
              onDiscard={() => setPhase('idle')}
              disabled={phase === 'confirmed'}
              disabledReason={phase === 'confirmed' ? 'Already confirmed in this sandbox run.' : undefined}
            />
          }
        />
      ) : null}

      {phase === 'confirmed' ? (
        <Button size="sm" onClick={() => setPhase('executed')} data-testid="sandbox-execute-button">
          Execute in sandbox
        </Button>
      ) : null}

      {phase === 'executed' ? (
        <>
          <ResultCard result={buildSandboxResult(tool, sandbox.argValues)} />
          <Button size="sm" variant="outline" onClick={() => setPhase('idle')} data-testid="sandbox-reset-button">
            Reset
          </Button>
        </>
      ) : null}
    </div>
  );
}
