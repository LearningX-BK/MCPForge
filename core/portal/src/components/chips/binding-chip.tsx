// MCPForge — the binding-type chip (03 §7.4, §12.5's own worked example).
import { BINDING_TYPE, type BindingType } from '@mcpforge/shared';

import { StatusChip, type ChipTreatment } from './status-chip';

export interface BindingChipProps {
  type: BindingType;
  treatment?: ChipTreatment;
  className?: string;
}

/**
 * `PL/SQL` → *"Binding type: PL/SQL package. Identity does not carry
 * natively; wrapper-schema attribution only. Elevated posture."* — the exact
 * 03 §12.5 worked example, reached by reading `BINDING_TYPE.plsql.srLabel`
 * rather than by hand-writing it a second time here.
 */
export function BindingChip({ type, treatment, className }: BindingChipProps) {
  return <StatusChip entry={BINDING_TYPE[type]} treatment={treatment} className={className} />;
}
