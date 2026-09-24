// MCPForge — the verb chip, plus the separate emphatic write chip
// (03 §8's table: "the 17 [now 19, CLAUDE.md §5] closed verbs; `write` as a
// separate emphatic chip ... read verbs neutral, write verbs amber").
import type { Verb } from '@mcpforge/shared';
import { VERB } from '@mcpforge/shared';

import { StatusChip, type ChipTreatment } from './status-chip';

export interface VerbChipProps {
  verb: Verb;
  treatment?: ChipTreatment;
  className?: string;
}

export function VerbChip({ verb, treatment, className }: VerbChipProps) {
  return <StatusChip entry={VERB[verb]} treatment={treatment} className={className} />;
}

/**
 * The separate emphatic "this tool writes" chip (03 §8, §12.5's own worked
 * example: `write` → "This tool writes to the target system."). Deliberately
 * not derived from `VERB` — every write verb already renders amber via
 * `VerbChip`, and this chip exists to make *write-ness itself* visible even
 * where only the entity/verb text is shown, per 03 §5.3's tool-detail header
 * listing "verb chip, write chip" as two distinct chips.
 */
export function WriteChip({ treatment, className }: { treatment?: ChipTreatment; className?: string }) {
  return (
    <StatusChip
      entry={{
        token: 'status-write',
        label: 'Write',
        srLabel: 'This tool writes to the target system.',
        icon: 'PenSquare',
      }}
      treatment={treatment}
      className={className}
    />
  );
}
