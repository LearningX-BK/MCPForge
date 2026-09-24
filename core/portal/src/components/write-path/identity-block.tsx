// MCPForge — W0-J7: the identity block (03 §7.2 item 6).
//
// "who is executing, whether identity carries into the target for this
// binding, and if not, which compensating control applies. **Sourced from the
// probe, not the manifest.**"
//
// SECURITY SHAPE — read this before changing the props.
// CLAUDE.md non-negotiable #2 and 02 §11.5.1: `identity.carries: verified` may
// only ever be written by the capability probe, and "the UI never renders
// 'verified' without a probe reference". Two consequences are built into this
// component:
//
//  1. It accepts `ProbeIdentityView` — a probe-report-shaped view, NOT a
//     manifest's `ToolBinding`/`BindingIdentity`. There is no code path here
//     that reads `binding.identity`, and the type deliberately does not
//     structurally accept one: `probeRef` is required and `onServiceAccount` /
//     `echoOn` (the manifest-only fields) are absent. A manifest object cannot
//     be passed in its place without being reshaped by a caller who has to
//     supply a probe reference to do it.
//  2. If `probeRef` is empty, NOTHING about carriage is asserted — the block
//     renders "Not established by a probe" instead of any carriage claim. It
//     cannot fall through to a manifest-asserted value, because it has none.
//
// SEAM: there is no probe-report artefact wired into the portal at Wave 0 (the
// probe orchestrator lands in core/probe/**, and the portal has no API client
// yet). `ProbeIdentityView` is that seam: when a probe report becomes readable
// from the portal, this prop is populated from it and nothing in this file
// changes. Do not substitute a manifest read in the meantime.
import { cn } from 'cn';

import { BindingChip } from '../chips';
import type { ProbeIdentityView } from './types';

export interface IdentityBlockProps {
  /** Probe-sourced. See the file header before widening this type. */
  identity: ProbeIdentityView;
  className?: string | undefined;
}

const CARRIAGE_TEXT: Record<ProbeIdentityView['carries'], string> = {
  verified:
    'Yes — the probe observed the calling user’s own identity arriving in the target system.',
  unverified:
    'Not established — the binding is expected to carry identity, but no probe has confirmed it in the target.',
  no: 'No — this binding type cannot carry the calling user’s identity into the target.',
};

export function IdentityBlock({ identity, className }: IdentityBlockProps) {
  const hasProbe = identity.probeRef.trim().length > 0;

  return (
    <section
      data-testid="identity-block"
      data-probe-ref={identity.probeRef}
      aria-labelledby="plan-identity-heading"
      className={cn('w-full', className)}
    >
      <h3
        id="plan-identity-heading"
        className="mb-1 text-[11px]/[1.4] font-semibold tracking-[0.5px] uppercase text-text-2"
      >
        Identity
      </h3>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[13.5px]/[1.55] text-text-1">
        <dt className="text-text-2">Executing as</dt>
        <dd>
          {identity.displayName ? `${identity.displayName} — ` : ''}
          <span className="font-mono text-[11.5px]/[1.45]">{identity.subject}</span>
        </dd>

        <dt className="text-text-2">Binding</dt>
        <dd>
          <BindingChip type={identity.bindingType} />
        </dd>

        <dt className="text-text-2">Identity carries into target</dt>
        <dd data-testid="identity-carries">
          {hasProbe
            ? CARRIAGE_TEXT[identity.carries]
            : 'Not established by a probe. Nothing is asserted about identity carriage for this binding.'}
        </dd>

        {hasProbe && identity.carries !== 'verified' && identity.compensatingControl ? (
          <>
            <dt className="text-text-2">Compensating control</dt>
            <dd data-testid="compensating-control">{identity.compensatingControl}</dd>
          </>
        ) : null}

        <dt className="text-text-2">Source</dt>
        <dd data-testid="identity-source">
          {hasProbe ? (
            <>
              Capability probe{' '}
              <span className="font-mono text-[11.5px]/[1.45]">{identity.probeRef}</span>
              {identity.probedAt ? `, ${identity.probedAt}` : ''}
            </>
          ) : (
            'No probe report'
          )}
        </dd>
      </dl>
    </section>
  );
}
