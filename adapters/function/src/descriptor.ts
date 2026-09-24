// MCPForge — building the `function` binding descriptor from a tool manifest.
// 02 §3.5. The descriptor is built ONCE, from the manifest, and frozen; nothing
// on the call path can alter it.

import type { ToolManifest } from '@mcpforge/shared/manifest';
import { buildIdentityInputMapping } from './mapping.js';
import { DEFAULT_MAX_CONCURRENCY, type FunctionBindingDescriptor } from './types.js';

export class NotAFunctionBinding extends Error {
  constructor(toolId: string, type: string) {
    super(`${toolId} has binding.type ${type}; the function executor refuses it.`);
    this.name = 'NotAFunctionBinding';
  }
}

/**
 * `binding.ref` is read here and nowhere else on the call path. There is no
 * overload of this function, and no field of any call-time input, that can
 * supply an orchestration name.
 */
export function buildFunctionBindingDescriptor(
  manifest: ToolManifest,
  overrides?: { readonly inputMapping?: Readonly<Record<string, string>> },
): FunctionBindingDescriptor {
  const binding = manifest.binding;
  if (binding.type !== 'function') {
    throw new NotAFunctionBinding(manifest.id, binding.type);
  }
  const ref = binding.ref?.trim() ?? '';
  if (ref.length === 0) {
    throw new Error(
      `${manifest.id}: binding.ref is empty. The orchestration name comes from binding.ref only (02 §3.5) — there is no other source and the tool cannot be dispatched without it.`,
    );
  }

  const inputMapping =
    overrides?.inputMapping ?? buildIdentityInputMapping(manifest.input.map((i) => i.name));

  const maxConcurrency = binding.execution?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;

  return Object.freeze({
    toolId: manifest.id,
    toolVersion: manifest.version,
    write: manifest.write === true,
    ref,
    refVersion: binding.refVersion ?? null,
    inputMapping: Object.freeze({ ...inputMapping }),
    // W0-H3. `echoOn` comes from the manifest and nowhere else; the
    // `policy.function-write-echo` rule guarantees a write tool that reaches
    // here declares `write`. `carries`/`onServiceAccount` are deliberately not
    // copied — they belong to the probe (02 §4.5), not to the call path.
    identity: Object.freeze({
      echoOn: binding.identity.echoOn,
      probe: binding.identity.probe ?? null,
    }),
    execution: Object.freeze({
      timeoutMs: binding.execution.timeoutMs,
      maxConcurrency,
      responseBytesMax: binding.execution.responseBytesMax,
    }),
  });
}
