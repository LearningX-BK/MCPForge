// MCPForge — W0-J11: reading a `MetaToolCard` defensively.
//
// `MetaToolCard` (`@mcpforge/gateway/meta`) is typed as
// `Readonly<Record<string, unknown>>` DELIBERATELY — its comment says "the
// card's field list is codegen's to own, and a second declaration of it
// here would be a second thing to keep in step with the budget gate." This
// module is the palette's one place that reads it, with guards rather than
// a second hand-typed card interface, so a future card field addition/removal
// cannot silently produce `undefined`-shaped chips.
//
// Field names verified against the real generator
// (`core/codegen/src/templates/card.ts`'s `buildDiscoveryCard`): `id`,
// `purpose`, `verb`, `entity`, `write`, `binding`, `sensitivity`, `roles`,
// `status`.
import { BINDING_TYPES, PROBE_STATUSES, VERBS, type BindingType, type ProbeStatus, type Verb } from '@mcpforge/shared';
import type { MetaToolCard } from './find-client';

export interface ToolCardFields {
  id: string;
  purpose: string | undefined;
  verb: Verb | undefined;
  entity: string | undefined;
  write: boolean | undefined;
  binding: BindingType | undefined;
  sensitivity: string | undefined;
  /**
   * Only set when the card's `status` string is a real `ProbeStatus`. The
   * generated card defaults `status` to `"unresolved"` at codegen time
   * (`core/codegen/src/templates/card.ts`'s own documented judgment call),
   * which is NOT a `ProbeStatus` member — this guard means the palette
   * renders no probe chip at all for a freshly generated, never-probed card
   * rather than forcing an invalid value through `ProbeStatusChip`.
   */
  status: ProbeStatus | undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function asBoolean(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}
function asVerb(v: unknown): Verb | undefined {
  return typeof v === 'string' && (VERBS as readonly string[]).includes(v) ? (v as Verb) : undefined;
}
function asBindingType(v: unknown): BindingType | undefined {
  return typeof v === 'string' && (BINDING_TYPES as readonly string[]).includes(v)
    ? (v as BindingType)
    : undefined;
}
function asProbeStatus(v: unknown): ProbeStatus | undefined {
  return typeof v === 'string' && (PROBE_STATUSES as readonly string[]).includes(v)
    ? (v as ProbeStatus)
    : undefined;
}

export function readCardFields(card: MetaToolCard): ToolCardFields {
  return {
    id: asString(card['id']) ?? '(unknown tool id)',
    purpose: asString(card['purpose']),
    verb: asVerb(card['verb']),
    entity: asString(card['entity']),
    write: asBoolean(card['write']),
    binding: asBindingType(card['binding']),
    sensitivity: asString(card['sensitivity']),
    status: asProbeStatus(card['status']),
  };
}
