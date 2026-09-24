'use client';

// MCPForge — W0-J6: the branch / change-set chip (03 §6.4, §11.3).
// W0-J12: wired to real `ChangeHost` data — through the interface only.
//
// The chip now reads `RepoState` (branch + `RemoteInfo`) from
// `ChangeHostProvider` (`@/lib/change-host`), which the provider obtains
// from whichever `ChangeHost` the app was given. This file imports the
// interface and the hook, never `LocalGit` or `HostedGit`, so the chip
// cannot know — and must not know — which implementation produced the
// values. Explicit props still win over context, because the shell's own
// tests and any server component that already knows the branch should not
// have to stand up a host.
//
// The two documented behaviours are unchanged: (1) an outline treatment that
// becomes unmistakable when the branch is not `main` (03 §6.4's "previewed
// on that branch"); (2) a hover tooltip naming the remote, or "local only —
// no remote configured" (03 §11.3).
import { GitBranch } from 'lucide-react';
import { cn } from 'cn';

import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { useRepoState } from '@/lib/change-host';

/** 03 §11.3, verbatim — the no-remote hover string. */
export const NO_REMOTE_LABEL = 'local only — no remote configured';

export interface BranchChipProps {
  /** Overrides the `ChangeHost` branch. Default comes from context (`main`). */
  branch?: string | undefined;
  /** Overrides the remote name. Empty/absent renders `NO_REMOTE_LABEL`. */
  remote?: string | undefined;
  className?: string;
}

export function BranchChip({ branch: branchProp, remote: remoteProp, className }: BranchChipProps) {
  const repo = useRepoState();
  const branch = branchProp ?? repo.branch;
  const remote = remoteProp ?? (repo.remote.configured ? repo.remote.name : undefined);
  const isPreview = branch !== 'main';
  const remoteLabel = remote && remote.length > 0 ? remote : NO_REMOTE_LABEL;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={
            isPreview
              ? `Previewing definitional data on branch ${branch}. Remote: ${remoteLabel}.`
              : `Reading definitional data from ${branch}. Remote: ${remoteLabel}.`
          }
          className={cn(
            'inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2 py-0.5',
            'text-[10.5px] font-bold tracking-[0.4px] whitespace-nowrap',
            isPreview
              ? 'border-accent bg-accent-tint text-accent'
              : 'border-line bg-transparent text-text-2',
            className,
          )}
        >
          <GitBranch aria-hidden="true" className="size-3" />
          <span>{branch}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>Remote: {remoteLabel}</TooltipContent>
    </Tooltip>
  );
}
