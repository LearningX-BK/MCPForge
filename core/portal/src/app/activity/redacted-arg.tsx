// MCPForge — W0-J16: redacted-argument rendering (03 §5.3 "Activity"; 02
// §4.6). "the args (redacted per sensitivity, with redacted values shown as
// their `sha256[:12]` so equality is still reasonable about)."
//
// The announced phrase — "Redacted value, hash <hash>" — is both the visible
// text and the accessible name, so it reads identically for sighted and
// screen-reader users (03 §12.5's rule for chip-shaped controls, applied
// here to a definition-list value).
import { cn } from 'cn';

import { redactedAnnouncement } from './fixtures';
import type { ActivityArgEntryView } from './types';

export interface RedactedArgProps {
  entry: ActivityArgEntryView;
  className?: string | undefined;
}

export function RedactedArg({ entry, className }: RedactedArgProps) {
  if (!entry.redacted) {
    return (
      <span data-testid="arg-value" className={cn('font-mono text-[12.5px]/[1.5] text-text-1', className)}>
        {entry.value ?? '—'}
      </span>
    );
  }

  const hash = entry.hash ?? '';
  return (
    <span
      data-testid="arg-value-redacted"
      data-hash={hash}
      className={cn('font-mono text-[12.5px]/[1.5] text-text-2', className)}
    >
      {redactedAnnouncement(hash)}
    </span>
  );
}
