// MCPForge — the environment chip (03 §11.1). Not one of the six chip
// families in §8's table ("two singular indicators that are not chips: the
// environment chip ... and the sensitivity marker") but W0-J5's own `done:`
// criterion names it as part of "the MCPForge chip family" to build, so it
// is implemented here with the rest, reusing the same `StatusChip`
// primitive rather than a bespoke one-off.
//
// 03 §11.1's table gives each class a *specific* treatment, not just a
// colour — `prod` is deliberately the only **filled** chip in the product
// ("the asymmetry is the signal"); every other class is outline. This
// component hard-codes that mapping so a caller cannot accidentally soften
// the one visual signal the design intentionally keeps sharp.
//
// The accompanying 3px top-of-viewport rule (local: platform, prod: danger)
// is shell-level chrome, not this chip — it belongs to `W0-J6`'s app shell,
// which renders it once around the whole viewport rather than per-chip.
import { ENV_CLASS, type EnvClass } from '@mcpforge/shared';

import { StatusChip, type ChipTreatment } from './status-chip';

const TREATMENT: Record<EnvClass, ChipTreatment> = {
  local: 'outline',
  probe: 'outline',
  staging: 'outline',
  prod: 'filled',
};

export interface EnvChipProps {
  envClass: EnvClass;
  className?: string;
}

export function EnvChip({ envClass, className }: EnvChipProps) {
  return (
    <StatusChip entry={ENV_CLASS[envClass]} treatment={TREATMENT[envClass]} className={className} />
  );
}
