// MCPForge — the package/slice chip (03 §8's table, §12.5's own worked
// example: "JD Edwards Financials" → "Deployment package: JD Edwards
// Financials.").
//
// Judgment call (CLAUDE.md §8, small implementation detail): unlike the
// other five named chips, package labels are not a closed enum in
// `status.ts` — packages are open-ended git artefacts (`packages/*.yaml`,
// 02 §6.3), not a fixed vocabulary, so there is no `PACKAGE_STATUS` map to
// read from. This chip instead takes the package's own `title`/`id` and
// applies the one fixed treatment 03 §8's table assigns the whole family
// (`--status-platform`, purple) directly, rather than inventing a
// per-package status entry that would just be `{token: 'status-platform',
// label, srLabel, icon}` restated for every package in the catalogue.
import type { StatusToken } from '@mcpforge/shared';

import { StatusChip, type ChipTreatment } from './status-chip';

const PACKAGE_TOKEN: StatusToken = 'status-platform';

export interface PackageChipProps {
  /** The package's human-facing label, e.g. "JD Edwards Financials". */
  label: string;
  treatment?: ChipTreatment;
  className?: string;
}

export function PackageChip({ label, treatment, className }: PackageChipProps) {
  return (
    <StatusChip
      entry={{
        token: PACKAGE_TOKEN,
        label,
        srLabel: `Deployment package: ${label}.`,
        icon: 'Boxes',
      }}
      treatment={treatment}
      className={className}
    />
  );
}
