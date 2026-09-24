// MCPForge — W0-J13: tool detail, the ten sections of 03 §5.3.
'use client';

import * as React from 'react';
import Link from 'next/link';

import { BindingChip, ChangeStateChip, PackageChip, ProbeStatusChip, VerbChip, WriteChip } from '@/components/chips';
import { Button } from '@/components/ui/button';
import { ERROR_TAXONOMY, type ErrorCode } from '@mcpforge/shared';
import type { CatalogData, CatalogTool } from '../types';
import { toYamlText } from '../yaml-render';
import { IdentityCarriage } from './identity-carriage';

export interface ToolDetailProps {
  tool: CatalogTool;
  data: CatalogData;
  onOpenAgentView?: () => void;
}

function CopyableId({ id }: { id: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      data-testid="tool-id-copy"
      onClick={() => {
        void navigator.clipboard?.writeText?.(id);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
      className="font-mono text-[12.5px] text-text-2 underline decoration-dotted underline-offset-2 hover:text-text-1"
      aria-label={`Copy tool id ${id}`}
    >
      {id}
      {copied ? ' — copied' : ''}
    </button>
  );
}

function SensitivityChip({ sensitivity }: { sensitivity: string }) {
  // No closed `StatusEntry` vocabulary exists for `Sensitivity` in
  // `@mcpforge/shared/status` (only PROBE_STATUS/CHANGE_STATE/BINDING_TYPE/
  // VERB are closed enums there) — same open-label pattern `PackageChip`
  // already documents for packages. Rendered as plain text, not a chip, so
  // no new colour token is invented for a five-value enum the design system
  // has not assigned one to.
  return <span className="rounded-full border border-line px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.4px] text-text-2">{sensitivity}</span>;
}

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId: string }) {
  return (
    <section data-testid={testId} className="flex flex-col gap-2 border-b border-line py-5 first:pt-0 last:border-b-0">
      <h2 className="text-sm font-semibold text-text-1">{title}</h2>
      {children}
    </section>
  );
}

export function ToolDetail({ tool, data, onOpenAgentView }: ToolDetailProps) {
  const m = tool.manifest;
  const siblings = data.tools.filter(
    (t) => t.manifest.id !== m.id && t.manifest.app === m.app && t.manifest.module === m.module && t.manifest.entity === m.entity,
  );

  const identity = {
    subject: 'you@example.com',
    bindingType: m.binding.type,
    carries: tool.probeIdentity?.carries ?? 'unverified',
    probeRef: tool.probeIdentity?.probeRef ?? '',
    probedAt: tool.probeIdentity?.probedAt,
    compensatingControl:
      m.binding.type === 'plsql' || m.binding.type === 'wrapped-vendor'
        ? 'Wrapper/service-connection records the calling subject in an attribution column, echoed into the audit record.'
        : undefined,
  } as const;

  const relevantErrorCodes: ErrorCode[] = m.write
    ? ['INPUT_INVALID', 'IDENTITY_UNRESOLVED', 'TOOL_NOT_IN_SCOPE', 'TOOL_DISABLED', 'POLICY_GUARDRAIL_BREACH', 'APPROVAL_REQUIRED', 'PLAN_REQUIRED', 'PLAN_EXPIRED', 'PLAN_ARGUMENT_MISMATCH', 'TARGET_ERROR', 'TARGET_TIMEOUT']
    : ['INPUT_INVALID', 'IDENTITY_UNRESOLVED', 'TOOL_NOT_IN_SCOPE', 'TOOL_DISABLED', 'ROW_CAP_EXCEEDED', 'TARGET_ERROR', 'TARGET_TIMEOUT'];

  return (
    <article data-testid="tool-detail" className="flex flex-col">
      {/* 1. Header */}
      <header data-testid="tool-detail-header" className="flex flex-col gap-2 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-xl text-text-1">{m.title}</h1>
          <CopyableId id={m.id} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <VerbChip verb={m.verb} />
          {m.write ? <WriteChip /> : null}
          <span className="rounded-full border border-line px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.4px] text-text-2">{m.archetype}</span>
          <BindingChip type={m.binding.type} />
          <SensitivityChip sensitivity={m.sensitivity} />
          <ProbeStatusChip status={tool.probeStatus} owningTeam={m.governance.owner} />
          {tool.packages.map((pkg) => (
            <PackageChip key={pkg} label={pkg} />
          ))}
          <ChangeStateChip state={tool.changeState} />
        </div>
      </header>

      {/* 2. Action bar */}
      <div data-testid="tool-detail-actions" className="flex flex-wrap gap-2 border-b border-line pb-4">
        <Button size="sm" disabled={!m.write} title={m.write ? undefined : 'Read tools have no write path to run through this action.'}>
          Run
        </Button>
        <Button size="sm" variant="secondary" onClick={onOpenAgentView} data-testid="open-agent-view">
          Describe
        </Button>
        <Button size="sm" variant="secondary" asChild>
          <Link href={`/build?from=${encodeURIComponent(m.id)}`}>Propose change</Link>
        </Button>
        <Button size="sm" variant="ghost">
          Add to activation set
        </Button>
      </div>

      {/* 3. Purpose, aliases, disambiguation */}
      <Section title="Purpose" testId="section-purpose">
        <p className="text-[13.5px]/[1.6] text-text-1">{m.purpose}</p>
        {m.aliases && m.aliases.length > 0 ? (
          <p className="text-xs text-text-2">Also known as: {m.aliases.join(', ')}</p>
        ) : null}
        {m.disambiguation ? (
          <div className="rounded-md border border-status-write-border bg-status-write-bg p-3 text-[13px]/[1.55] text-status-write-strong">
            {m.disambiguation}
          </div>
        ) : siblings.length > 0 ? (
          <div className="rounded-md border border-status-danger-border bg-status-danger-bg p-3 text-[13px]/[1.55] text-status-danger-strong">
            No disambiguation is declared, but sibling tools exist ({siblings.map((s) => s.manifest.id).join(', ')}).
            CLAUDE.md §5 requires disambiguation to be mandatory and mutual on any two tools sharing this prefix — this is
            a manifest gap, not a rendering gap.
          </div>
        ) : null}
        {siblings.length > 0 ? (
          <ul className="flex flex-col gap-1 text-[13px] text-text-2">
            {siblings.map((s) => (
              <li key={s.manifest.id}>
                <Link href={`/catalog/${s.manifest.id}`} className="underline decoration-dotted underline-offset-2">
                  {s.manifest.id}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      {/* 4. Manifest YAML */}
      <Section title="Manifest" testId="section-manifest">
        <div className="flex items-center justify-between text-xs text-text-2">
          <span>
            sha <span className="font-mono">{tool.manifestSha}</span>
          </span>
          <a
            className="underline decoration-dotted underline-offset-2"
            href={`https://example.invalid/manifests/${m.id}.tool.yaml`}
            target="_blank"
            rel="noreferrer"
          >
            View on git
          </a>
        </div>
        {/* axe `scrollable-region-focusable`: a scrollable region needs
            keyboard access of its own — `tabIndex=0` plus a real accessible
            name (its own manifest yaml has no visible heading to label it
            with). */}
        <pre
          tabIndex={0}
          aria-label={`${m.id} manifest YAML`}
          className="max-h-96 overflow-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-[12px]/[1.6] text-text-1"
        >
          {toYamlText(m)}
        </pre>
      </Section>

      {/* 5. Binding & handshake */}
      <Section title="Binding & handshake" testId="section-binding">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[13.5px]/[1.55] text-text-1">
          <dt className="text-text-2">Type</dt>
          <dd>
            <BindingChip type={m.binding.type} />
          </dd>
          <dt className="text-text-2">Technology</dt>
          <dd>{m.binding.technology}</dd>
          <dt className="text-text-2">Calls</dt>
          <dd className="font-mono text-[12px]">{m.binding.ref}</dd>
          <dt className="text-text-2">Default review path</dt>
          <dd>{m.governance.reviewPath}</dd>
        </dl>
        <IdentityCarriage identity={identity} className="mt-2" />
      </Section>

      {/* 6. Inputs / output */}
      <Section title="Inputs and output" testId="section-io">
        <table className="w-full text-[13px]">
          <caption className="sr-only">Tool inputs</caption>
          <thead>
            <tr className="border-b border-line text-left text-text-2">
              <th className="py-1 pr-2 font-medium">Name</th>
              <th className="py-1 pr-2 font-medium">Type</th>
              <th className="py-1 pr-2 font-medium">Required</th>
              <th className="py-1 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {m.input.map((i) => (
              <tr key={i.name} className="border-b border-line last:border-0">
                <td className="py-1 pr-2 font-mono">{i.name}</td>
                <td className="py-1 pr-2">{i.type}</td>
                <td className="py-1 pr-2">{i.required ? 'yes' : 'no'}</td>
                <td className="py-1 text-text-2">{i.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[13px] text-text-1">
          <span className="text-text-2">Result summary: </span>
          {m.output.summaryTemplate}
        </p>
        {m.output.resultKeys.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {m.output.resultKeys.map((k) => (
              <span key={k.name} className="rounded-full border border-status-ok-border bg-status-ok-bg px-2 py-0.5 font-mono text-[11px] text-status-ok-strong">
                {k.name}
              </span>
            ))}
          </div>
        ) : null}
      </Section>

      {/* 7. Write safety */}
      {m.write && m.writeSafety ? (
        <Section title="Write safety" testId="section-write-safety">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[13.5px]/[1.55] text-text-1">
            <dt className="text-text-2">Dry-run strategy</dt>
            <dd>{m.writeSafety.dryRun.strategy}</dd>
            <dt className="text-text-2">Confirm TTL</dt>
            <dd>{m.writeSafety.confirm.tokenTtlSeconds}s</dd>
            <dt className="text-text-2">Human approval required</dt>
            <dd>{m.writeSafety.humanApprovalRequired ? 'Yes' : 'No'}</dd>
            <dt className="text-text-2">Reversal class</dt>
            <dd>{m.writeSafety.reversal.class}</dd>
            {m.writeSafety.reversal.class !== 'irreversible' && 'tool' in m.writeSafety.reversal && m.writeSafety.reversal.tool ? (
              <>
                <dt className="text-text-2">Reversing tool</dt>
                <dd>
                  <Link href={`/catalog/${m.writeSafety.reversal.tool}`} className="underline decoration-dotted underline-offset-2">
                    {m.writeSafety.reversal.tool}
                  </Link>
                </dd>
              </>
            ) : null}
            <dt className="text-text-2">Window</dt>
            <dd>{m.writeSafety.reversal.windowHours != null ? `${m.writeSafety.reversal.windowHours} hours` : '—'}</dd>
            <dt className="text-text-2">Preconditions</dt>
            <dd>{m.writeSafety.reversal.preconditions ?? '—'}</dd>
          </dl>
          {m.writeSafety.guardrails && m.writeSafety.guardrails.length > 0 ? (
            <ul className="flex flex-col gap-1 text-[13px] text-text-1">
              {m.writeSafety.guardrails.map((g, idx) => (
                <li key={idx} className="rounded-md border border-line bg-surface-2 p-2">
                  <span className="font-mono text-[11.5px] text-text-2">{g.kind}</span>
                  {g.message ? <span className="ml-2">{g.message}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      ) : null}

      {/* 8. Error catalogue */}
      <Section title="Error catalogue" testId="section-errors">
        <table className="w-full text-[13px]">
          <caption className="sr-only">Error catalogue for this tool</caption>
          <thead>
            <tr className="border-b border-line text-left text-text-2">
              <th className="py-1 pr-2 font-medium">Condition</th>
              <th className="py-1 pr-2 font-medium">Agent is told</th>
              <th className="py-1 font-medium">Next</th>
            </tr>
          </thead>
          <tbody>
            {relevantErrorCodes.map((code) => {
              const spec = ERROR_TAXONOMY[code];
              return (
                <tr key={code} className="border-b border-line align-top last:border-0">
                  <td className="py-1 pr-2">
                    <span className="font-mono text-[11px] text-text-2">{code}</span>
                    <div>{spec.condition}</div>
                  </td>
                  <td className="py-1 pr-2 text-text-2">{spec.condition}</td>
                  <td className="py-1 text-text-1">{spec.next}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      {/* 9. Eval intents and last benchmark */}
      <Section title="Eval intents and benchmark" testId="section-eval">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[13.5px]/[1.55] text-text-1">
          <dt className="text-text-2">Intents file</dt>
          <dd className="font-mono text-[12px]">{m.eval.intentsFile}</dd>
          <dt className="text-text-2">Minimum intents</dt>
          <dd>{m.eval.minIntents}</dd>
          {tool.lastBenchmark ? (
            <>
              <dt className="text-text-2">Last SA@1</dt>
              <dd>{Math.round(tool.lastBenchmark.saAt1 * 100)}%</dd>
              <dt className="text-text-2">Run at</dt>
              <dd>{tool.lastBenchmark.runAt}</dd>
            </>
          ) : (
            <>
              <dt className="text-text-2">Last benchmark</dt>
              <dd>No benchmark run recorded yet.</dd>
            </>
          )}
        </dl>
      </Section>

      {/* 10. Consumption */}
      <Section title="Consumption" testId="section-consumption">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[13.5px]/[1.55] text-text-1">
          <dt className="text-text-2">30-day volume</dt>
          <dd>{tool.consumption.last30dCalls}</dd>
          <dt className="text-text-2">Last call</dt>
          <dd>{tool.consumption.lastCallAt ?? 'Never called'}</dd>
        </dl>
        {tool.consumption.consumers.length > 0 ? (
          <table className="w-full text-[13px]">
            <caption className="sr-only">Consuming agents and platforms</caption>
            <thead>
              <tr className="border-b border-line text-left text-text-2">
                <th className="py-1 pr-2 font-medium">Consumer</th>
                <th className="py-1 pr-2 font-medium">Platform</th>
                <th className="py-1 font-medium">30-day calls</th>
              </tr>
            </thead>
            <tbody>
              {tool.consumption.consumers.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <td className="py-1 pr-2 font-mono">{c.id}</td>
                  <td className="py-1 pr-2">{c.platform}</td>
                  <td className="py-1">{c.calls30d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-[13px] text-text-2">No consumer has called this tool yet.</p>
        )}
        <Link href={`/activity?tool=${encodeURIComponent(m.id)}`} className="text-[13px] underline decoration-dotted underline-offset-2">
          View in Activity
        </Link>
      </Section>
    </article>
  );
}
