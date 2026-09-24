// MCPForge — W0-J12: the three diffs (03 §6.5).
//
// "Three diffs, always shown together on a Propose, because they are three
// different questions." The rules are structural, not stylistic, so they are
// encoded here rather than left to each caller:
//
//  1. Manifest diff — what a human wrote. Expanded.
//  2. Generated diff — what codegen produced. COLLAPSED BY DEFAULT, but
//     always present, "because `generated/` is committed and reviewable
//     blast radius is the whole reason". Never omitted, even when empty:
//     an empty generated diff on a manifest change is itself a finding.
//  3. Compiled role scope diff — which grants changed. NEVER COLLAPSED.
//     `RoleScopeDiff` therefore has no disclosure control at all — not a
//     closed one, not a defaulted-open one — so no future prop can collapse
//     it. "A tool addition that silently widens a role shows up here and
//     nowhere else."
//
// A fourth, `other`, exists for files that are none of the three; it is
// rendered after them and collapsed, so the headline count stays three.
import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from 'cn';

import type { ChangeDiffSet, DiffFile, RoleScopeDelta } from '@/lib/change-host';

function statusLabel(file: DiffFile): string {
  return `${file.status}, ${file.additions} added, ${file.deletions} removed`;
}

export function DiffFileList({
  files,
  emptyText,
}: {
  files: readonly DiffFile[];
  emptyText: string;
}) {
  if (files.length === 0) {
    return <p className="text-sm text-text-2">{emptyText}</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {files.map((file) => (
        <li key={file.path} className="overflow-hidden rounded-md border border-line">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-surface-2 px-3 py-1.5">
            <code className="font-mono text-xs text-text-1">{file.path}</code>
            <span className="text-[11px] text-text-2">{statusLabel(file)}</span>
          </div>
          <pre
            tabIndex={0}
            aria-label={`Diff for ${file.path}`}
            className="max-h-64 overflow-auto px-3 py-2 font-mono text-xs whitespace-pre text-text-1"
          >
            {file.patch}
          </pre>
        </li>
      ))}
    </ul>
  );
}

function Disclosure({
  id,
  summary,
  defaultOpen,
  children,
}: {
  id: string;
  summary: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        data-testid={`${id}-toggle`}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-sm font-bold text-text-1 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus-ring"
      >
        <ChevronRight aria-hidden="true" className={cn('size-4', open && 'rotate-90')} />
        {summary}
      </button>
      <div id={`${id}-panel`} hidden={!open} className="pt-2">
        {children}
      </div>
    </div>
  );
}

function deltaLine(delta: RoleScopeDelta): string {
  const parts: string[] = [];
  if (delta.toolsAdded.length > 0) parts.push(`${delta.toolsAdded.length} tool(s) added`);
  if (delta.toolsRemoved.length > 0) parts.push(`${delta.toolsRemoved.length} tool(s) removed`);
  if (delta.bindingGrantsAdded.length > 0)
    parts.push(`${delta.bindingGrantsAdded.length} binding grant(s) added`);
  if (delta.bindingGrantsRemoved.length > 0)
    parts.push(`${delta.bindingGrantsRemoved.length} binding grant(s) removed`);
  return parts.join(' · ');
}

/**
 * Never collapsible. There is deliberately no `defaultOpen` prop and no
 * disclosure control in this component — see the file header.
 */
export function RoleScopeDiff({ deltas }: { deltas: readonly RoleScopeDelta[] }) {
  return (
    <section aria-labelledby="diff-role-scope-heading" data-testid="diff-role-scope">
      <h3 id="diff-role-scope-heading" className="text-sm font-bold text-text-1">
        Compiled role scope diff
      </h3>
      <p className="pb-2 text-xs text-text-2">
        Which grants changed. This is the diff a governance reviewer is reviewing.
      </p>
      {deltas.length === 0 ? (
        <p className="text-sm text-text-2">
          No role scope changes. No grant is widened or narrowed.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {deltas.map((delta) => (
            <li
              key={delta.roleId}
              data-testid={`role-scope-${delta.roleId}`}
              className="rounded-md border border-status-write-border bg-status-write-bg px-3 py-2"
            >
              <p className="text-sm font-bold text-text-1">
                {delta.label ? `${delta.label} (${delta.roleId})` : delta.roleId}
              </p>
              <p className="text-xs text-text-2">{deltaLine(delta)}</p>
              {delta.toolsAdded.map((toolId) => (
                <p key={`a-${toolId}`} className="font-mono text-xs text-status-ok-strong">
                  + {toolId}
                </p>
              ))}
              {delta.toolsRemoved.map((toolId) => (
                <p key={`r-${toolId}`} className="font-mono text-xs text-status-danger-strong">
                  − {toolId}
                </p>
              ))}
              {delta.bindingGrantsAdded.map((grant) => (
                <p key={`ba-${grant}`} className="font-mono text-xs text-status-danger-strong">
                  + binding grant {grant}
                </p>
              ))}
              {delta.bindingGrantsRemoved.map((grant) => (
                <p key={`br-${grant}`} className="font-mono text-xs text-text-2">
                  − binding grant {grant}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ThreeDiffs({ diff }: { diff: ChangeDiffSet }) {
  return (
    <div data-testid="three-diffs" className="flex flex-col gap-4">
      <section aria-labelledby="diff-manifest-heading" data-testid="diff-manifest">
        <h3 id="diff-manifest-heading" className="text-sm font-bold text-text-1">
          Manifest diff
        </h3>
        <p className="pb-2 text-xs text-text-2">What a human wrote.</p>
        <DiffFileList files={diff.manifest} emptyText="No hand-authored files changed." />
      </section>

      <Disclosure
        id="diff-generated"
        defaultOpen={false}
        summary={`Generated diff (${diff.generated.length} file${diff.generated.length === 1 ? '' : 's'})`}
      >
        <p className="pb-2 text-xs text-text-2">
          What codegen produced. Committed, so the blast radius is reviewable.
        </p>
        <DiffFileList files={diff.generated} emptyText="Codegen produced no changes." />
      </Disclosure>

      <RoleScopeDiff deltas={diff.roleScope} />

      {diff.other.length > 0 ? (
        <Disclosure
          id="diff-other"
          defaultOpen={false}
          summary={`Other files (${diff.other.length})`}
        >
          <DiffFileList files={diff.other} emptyText="No other files changed." />
        </Disclosure>
      ) : null}
    </div>
  );
}
