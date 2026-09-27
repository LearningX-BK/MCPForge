'use client';

// MCPForge — W0-P5b: the topbar's persona pill and account control (03 §2,
// W0-P4 §2 and §6).
//
// The pill offers ONLY the personas the viewer holds, from the git mapping,
// and says in its tooltip that it is a view, not a permission (W0-P4 §6).
// Choosing one moves the viewer to that lens's landing page. It changes no
// gate: every gate reads held personas on the server (lib/viewer/gates.ts).
//
// Signed out, the pill is a "Sign in" link. Nothing is hidden: every page
// stays reachable, and actions that need a signed-in viewer say so themselves.

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogIn, LogOut } from 'lucide-react';

import { selectPersonaAction, signOutAction } from '@/lib/viewer/actions';
import { PERSONA_LABEL, PERSONA_LANDING, isPersona, personaTooltip } from '@/lib/viewer/personas';
import type { ViewerSummary } from '@/lib/viewer/summary';

import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

const PILL =
  'flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-text-1 focus-visible:outline-2 focus-visible:outline-focus-ring';

export interface ViewerControlsProps {
  readonly viewer: ViewerSummary | null;
}

export function ViewerControls({ viewer }: ViewerControlsProps): React.ReactElement {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const [refusal, setRefusal] = React.useState<{ message: string; next: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  if (viewer === null) {
    const returnTo = pathname.startsWith('/sign-in') ? '/' : pathname;
    return (
      <Link href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`} className={PILL}>
        <LogIn aria-hidden="true" className="size-3.5" />
        Sign in
      </Link>
    );
  }

  const tooltip = personaTooltip(viewer.personas);

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const chosen = event.target.value;
    if (!isPersona(chosen)) return;
    startTransition(async () => {
      const result = await selectPersonaAction(chosen);
      if (result.ok) {
        setRefusal(null);
        router.push(PERSONA_LANDING[chosen]);
        router.refresh();
      } else {
        setRefusal({ message: result.message, next: result.next });
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          {viewer.personas.length === 0 ? (
            <span className={PILL} tabIndex={0} aria-label={`No persona. ${tooltip}`}>
              No persona
            </span>
          ) : (
            <select
              aria-label={`Persona. ${tooltip}`}
              value={viewer.persona ?? viewer.personas[0]}
              onChange={onChange}
              disabled={pending || viewer.personas.length < 2}
              className={`${PILL} bg-surface`}
            >
              {viewer.personas.map((p) => (
                <option key={p} value={p}>
                  {PERSONA_LABEL[p]}
                </option>
              ))}
            </select>
          )}
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
      </Tooltip>
      {refusal !== null && (
        <span role="alert" className="text-xs text-status-danger-strong">
          {refusal.message} {refusal.next}
        </span>
      )}
      <form action={signOutAction}>
        <button
          type="submit"
          aria-label={`Signed in as ${viewer.displayName}. Sign out.`}
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-text-2 hover:bg-surface-2 hover:text-text-1 focus-visible:outline-2 focus-visible:outline-focus-ring"
        >
          <span className="max-w-32 truncate">{viewer.displayName}</span>
          <LogOut aria-hidden="true" className="size-4" />
        </button>
      </form>
    </div>
  );
}
