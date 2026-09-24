// MCPForge — the generated input mapping, applied. 02 §3.5:
// "Inputs are validated against the generated JSON Schema before dispatch, then
//  mapped to the orchestration's typed inputs by a generated mapping. Unmapped
//  extra fields are dropped, not forwarded."

import type { FunctionBindingDescriptor } from './types.js';

/**
 * Argument names that are MCPForge's own protocol, never the target's. They are
 * dropped like any other unmapped field; they are listed only so a reader can
 * see they were considered.
 */
const PROTOCOL_ARGS: ReadonlySet<string> = new Set(['confirm']);

export interface MappedInputs {
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly droppedArgs: readonly string[];
}

/**
 * Project caller arguments onto the orchestration's typed inputs.
 *
 * The mapping is a CLOSED table. The loop is over the table's keys, never over
 * the caller's keys, so an argument the mapping does not name has no code path
 * to the target — including one whose name or value looks like an orchestration
 * name. `undefined` values are omitted rather than forwarded as nulls.
 */
export function applyInputMapping(
  descriptor: FunctionBindingDescriptor,
  args: Readonly<Record<string, unknown>>,
): MappedInputs {
  const inputs: Record<string, unknown> = {};
  for (const [manifestName, targetName] of Object.entries(descriptor.inputMapping)) {
    if (!Object.prototype.hasOwnProperty.call(args, manifestName)) continue;
    const value = args[manifestName];
    if (value === undefined) continue;
    inputs[targetName] = value;
  }

  const mapped = new Set(Object.keys(descriptor.inputMapping));
  const droppedArgs = Object.keys(args)
    .filter((name) => !mapped.has(name))
    .sort();

  return { inputs, droppedArgs };
}

/** Only for the comment in `droppedArgs` consumers; see PROTOCOL_ARGS. */
export function isProtocolArg(name: string): boolean {
  return PROTOCOL_ARGS.has(name);
}

/**
 * The identity-by-name mapping convention: every manifest input maps to an
 * orchestration input of the same name. This is the ONLY mapping this package
 * will synthesise, and it synthesises nothing the manifest did not already
 * name. Where a JDE orchestration's input name differs from the manifest input
 * name, the manifest must state it and codegen must emit it — see the WAVE 0
 * NOTE on `FunctionBindingDescriptor`.
 */
export function buildIdentityInputMapping(
  manifestInputNames: readonly string[],
): Readonly<Record<string, string>> {
  const mapping: Record<string, string> = {};
  for (const name of manifestInputNames) {
    if (PROTOCOL_ARGS.has(name)) continue;
    mapping[name] = name;
  }
  return Object.freeze(mapping);
}
