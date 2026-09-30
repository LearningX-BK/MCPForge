// MCPForge — W0-J14: build the MOCK plan/confirm/execute data the sandbox
// run exercises the real write-path components against.
//
// Every mock value here is clearly a sandbox fabrication (the identity
// block's `probeRef` literally says "sandbox — no probe has run"), never
// something that could be mistaken for a live result: this is what "exercise
// the full plan/confirm path against mocks" means, per 03 §5.3 — NOT a call
// to a real gateway, which does not exist to call at Wave 0 (the same seam
// `write-path/types.ts` documents for the whole component family).
import type {
  ConsequenceView,
  GuardrailResultView,
  LockedArgsView,
  PlanBodyView,
  ProbeIdentityView,
  ResultView,
} from '@/components/write-path';
import type { ToolView } from '@mcpforge/codegen/templates';
import type { EnvClass } from '@mcpforge/shared';

const SANDBOX_ENV: EnvClass = 'local';

function mockValueFor(input: ToolView['input'][number]): string {
  if (input.example !== undefined) return String(input.example);
  if (input.enum && input.enum.length > 0) return String(input.enum[0]);
  if (input.type === 'number' || input.type === 'integer') return '100';
  if (input.type === 'boolean') return 'true';
  return `sandbox-${input.name}`;
}

function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/** A deterministic, non-cryptographic placeholder hash — labelled as sandbox data, never `sha256`. */
function sandboxHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  }
  return `sandbox${(h >>> 0).toString(16).padStart(8, '0')}`;
}

export interface SandboxPlan {
  readonly plan: PlanBodyView;
  readonly identity: ProbeIdentityView;
  readonly locked: LockedArgsView;
  readonly guardrails: readonly GuardrailResultView[];
  readonly consequence: ConsequenceView;
  readonly argValues: Readonly<Record<string, string>>;
}

export function buildSandboxPlan(tool: ToolView): SandboxPlan {
  const argValues: Record<string, string> = {};
  const args: Record<string, unknown> = {};
  for (const input of tool.input) {
    const value = mockValueFor(input);
    argValues[input.name] = value;
    args[input.name] = value;
  }
  // `planTemplate` references fields (e.g. `supplier_name`) that are not
  // always a declared INPUT (they come from a lookup the real target makes)
  // — fall back to the field name itself so the sandbox plan sentence still
  // reads, rather than leaving a literal `{supplier_name}` on screen.
  const planText = tool.writeSafety?.planTemplate
    ? fillTemplate(tool.writeSafety.planTemplate, argValues).replace(/\{(\w+)\}/g, '$1 (sandbox value)')
    : `Run ${tool.id} in the sandbox.`;

  const plan: PlanBodyView = {
    plan: planText,
    effects: [
      {
        system: tool.bindingTechnology || tool.bindingType,
        object: tool.entity,
        action: tool.verb,
        reversible: tool.writeSafety ? tool.writeSafety.reversalClass !== 'irreversible' : true,
      },
    ],
    warnings: [],
    reversal: tool.writeSafety?.reversalClass
      ? {
          class: tool.writeSafety.reversalClass as PlanBodyView['reversal']['class'],
          tool: tool.writeSafety.reversalTool ?? undefined,
        }
      : { class: 'native-reverse' },
  };

  const identity: ProbeIdentityView = {
    subject: 'sandbox.developer@local',
    displayName: 'Sandbox developer',
    bindingType: tool.bindingType as ProbeIdentityView['bindingType'],
    carries: 'unverified',
    probeRef: 'sandbox — no probe has run',
  };

  const locked: LockedArgsView = {
    args,
    argsCanonicalHash: sandboxHash(JSON.stringify(args)),
  };

  const guardrails: GuardrailResultView[] = (tool.writeSafety?.guardrails ?? []).map((g, i) => ({
    id: `${g.kind}-${i}`,
    label: g.kind,
    passed: true,
    valueChecked: g.field
      ? `${argValues[g.field] ?? 'n/a'} against ${g.value ?? 'n/a'} (sandbox — not actually enforced)`
      : `${g.with ?? g.kind} (sandbox — not actually enforced)`,
  }));

  const consequence: ConsequenceView = {
    reversalClass: (tool.writeSafety?.reversalClass ?? 'native-reverse') as ConsequenceView['reversalClass'],
    sensitivity: tool.sensitivity as ConsequenceView['sensitivity'],
    envClass: SANDBOX_ENV,
    entityName: tool.entity,
  };

  return { plan, identity, locked, guardrails, consequence, argValues };
}

export function buildSandboxResult(tool: ToolView, argValues: Readonly<Record<string, string>>): ResultView {
  const resultKeys = tool.resultKeys.length > 0 ? tool.resultKeys : [{ name: 'result', path: '$' }];
  const keyValues: Record<string, string> = {};
  for (const key of resultKeys) {
    keyValues[key.name] = `SANDBOX-${key.name.toUpperCase()}`;
  }
  const summary = fillTemplate(tool.summaryTemplate || `${tool.id} completed.`, { ...argValues, ...keyValues });
  return {
    callId: 'sandbox-call-0001',
    toolId: tool.id,
    toolVersion: tool.version,
    summary,
    resultKeys: resultKeys.map((k) => ({ name: k.name, value: keyValues[k.name] ?? '' })),
  };
}
