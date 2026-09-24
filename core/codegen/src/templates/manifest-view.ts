// MCPForge — a small, tolerant reader over a parsed Tool manifest document.
// W0-B6.
//
// SCOPE: this is NOT a second validator. By the time codegen reaches a tool
// (per `runCodegen`'s existing flow) the manifest has already passed
// `forge validate`'s ~40 rules (W0-B1/B2/B3) — that is a precondition of
// `forge codegen`, not something this module re-checks. This module exists
// only because `doc: unknown` (the shape every emit-pipeline module reads,
// same as `core/codegen/src/emit/custom.ts`) needs one tolerant, shared way
// to reach into a manifest's fields with sane fallbacks, so seven template
// generators don't each hand-roll their own `asRecord`/`asString` walk.
//
// Mirrors the field set in `@mcpforge/shared/manifest`'s `ToolManifest` —
// see core/shared/src/manifest/tool.ts — but reads `doc: unknown` rather than
// assuming a typed manifest, exactly as `emit/custom.ts` does for the same
// reason (a YAML-parsed document has no compile-time shape).

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

export interface ViewInput {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly desc: string;
  readonly example?: string | number | boolean;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly format?: string;
  readonly enum?: readonly (string | number)[];
  readonly enumRef?: string;
}

export interface ViewResultKey {
  readonly name: string;
  readonly path: string;
}

export interface ViewGuardrail {
  readonly kind: string;
  readonly field?: string;
  readonly value?: number | string | readonly (string | number)[];
  readonly with?: string;
  readonly scope?: string;
  /** `rateLimit`: N executes per caller per window (02 §3.1.3). W0-F4. */
  readonly limit?: number;
  /** `rateLimit`: the window the limit is counted over. W0-F4. */
  readonly windowSeconds?: number;
  /** `timeWindow`: the named precondition read the window is evaluated from. W0-F4. */
  readonly ref?: string;
  readonly message?: string;
}

export interface ViewWriteSafety {
  readonly dryRunStrategy: string | null;
  readonly dryRunRef: string | null;
  readonly confirmTokenTtlSeconds: number | null;
  readonly planTemplate: string | null;
  readonly humanApprovalRequired: boolean;
  readonly reversalClass: string | null;
  readonly reversalTool: string | null;
  /** `writeSafety.reversal.argMap` — original result-key name -> `"$.result.<field>"` path into the reversing tool's arguments. Empty when absent. W0-B7. */
  readonly reversalArgMap: Readonly<Record<string, string>>;
  readonly idempotencyScopeHours: number | null;
  readonly guardrails: readonly ViewGuardrail[];
}

export interface ToolView {
  readonly id: string;
  readonly version: string;
  readonly server: string;
  readonly title: string;
  readonly purpose: string;
  readonly aliases: readonly string[];
  readonly disambiguation: string | null;
  readonly archetype: string;
  readonly verb: string;
  readonly entity: string;
  readonly app: string;
  readonly module: string;
  readonly functionalArea: string;
  readonly processTags: readonly string[];
  readonly sensitivity: string;
  readonly write: boolean;
  readonly coreForRoles: readonly string[];
  readonly bindingType: string;
  readonly bindingTechnology: string;
  readonly bindingRef: string;
  readonly bindingRefVersion: string | null;
  readonly identityCarries: string;
  readonly bindingCustom: boolean;
  readonly input: readonly ViewInput[];
  readonly summaryTemplate: string;
  readonly resultKeys: readonly ViewResultKey[];
  readonly writeSafety: ViewWriteSafety | null;
  readonly reviewPath: string;
  readonly owner: string;
  readonly steward: string;
  readonly policyException: string | null;
}

/** Tolerant read of one Tool manifest document into a flat, typed view. */
export function readTool(doc: unknown): ToolView {
  const r = asRecord(doc) ?? {};
  const binding = asRecord(r['binding']) ?? {};
  const identity = asRecord(binding['identity']) ?? {};
  const output = asRecord(r['output']) ?? {};
  const writeSafetyRaw = asRecord(r['writeSafety']);
  const dryRun = asRecord(writeSafetyRaw?.['dryRun']);
  const confirm = asRecord(writeSafetyRaw?.['confirm']);
  const reversal = asRecord(writeSafetyRaw?.['reversal']);
  const idempotency = asRecord(writeSafetyRaw?.['idempotency']);
  const governance = asRecord(r['governance']) ?? {};

  const input: ViewInput[] = asArray(r['input']).map((raw) => {
    const item = asRecord(raw) ?? {};
    const enumArr = asArray(item['enum']);
    return {
      name: asString(item['name']) ?? '',
      type: asString(item['type']) ?? 'string',
      required: asBool(item['required'], false),
      desc: asString(item['desc']) ?? '',
      ...(item['example'] === undefined
        ? {}
        : { example: item['example'] as string | number | boolean }),
      ...(asNumber(item['minimum']) === null ? {} : { minimum: asNumber(item['minimum'])! }),
      ...(asNumber(item['maximum']) === null ? {} : { maximum: asNumber(item['maximum'])! }),
      ...(asString(item['format']) === null ? {} : { format: asString(item['format'])! }),
      ...(enumArr.length === 0 ? {} : { enum: enumArr as (string | number)[] }),
      ...(asString(item['enumRef']) === null ? {} : { enumRef: asString(item['enumRef'])! }),
    };
  });

  const resultKeys: ViewResultKey[] = asArray(output['resultKeys']).map((raw) => {
    const item = asRecord(raw) ?? {};
    return { name: asString(item['name']) ?? '', path: asString(item['path']) ?? '' };
  });

  const guardrails: ViewGuardrail[] = asArray(writeSafetyRaw?.['guardrails']).map((raw) => {
    const item = asRecord(raw) ?? {};
    return {
      kind: asString(item['kind']) ?? '',
      ...(asString(item['field']) === null ? {} : { field: asString(item['field'])! }),
      ...(item['value'] === undefined
        ? {}
        : { value: item['value'] as number | string | readonly (string | number)[] }),
      ...(asString(item['with']) === null ? {} : { with: asString(item['with'])! }),
      ...(asString(item['scope']) === null ? {} : { scope: asString(item['scope'])! }),
      ...(asNumber(item['limit']) === null ? {} : { limit: asNumber(item['limit'])! }),
      ...(asNumber(item['windowSeconds']) === null
        ? {}
        : { windowSeconds: asNumber(item['windowSeconds'])! }),
      ...(asString(item['ref']) === null ? {} : { ref: asString(item['ref'])! }),
      ...(asString(item['message']) === null ? {} : { message: asString(item['message'])! }),
    };
  });

  const writeSafety: ViewWriteSafety | null = writeSafetyRaw
    ? {
        dryRunStrategy: asString(dryRun?.['strategy']),
        dryRunRef: asString(dryRun?.['ref']),
        confirmTokenTtlSeconds: asNumber(confirm?.['tokenTtlSeconds']),
        planTemplate: asString(confirm?.['planTemplate']),
        humanApprovalRequired: asBool(writeSafetyRaw['humanApprovalRequired'], false),
        reversalClass: asString(reversal?.['class']),
        reversalTool: asString(reversal?.['tool']),
        reversalArgMap: (() => {
          const raw = asRecord(reversal?.['argMap']) ?? {};
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(raw)) {
            const s = asString(v);
            if (s !== null) out[k] = s;
          }
          return out;
        })(),
        idempotencyScopeHours: asNumber(idempotency?.['scopeHours']),
        guardrails,
      }
    : null;

  return {
    id: asString(r['id']) ?? '',
    version: asString(r['version']) ?? '0.0.0',
    server: asString(r['server']) ?? '',
    title: asString(r['title']) ?? '',
    purpose: asString(r['purpose']) ?? '',
    aliases: asArray(r['aliases']).filter((a): a is string => typeof a === 'string'),
    disambiguation: asString(r['disambiguation']),
    archetype: asString(r['archetype']) ?? 'transactional',
    verb: asString(r['verb']) ?? '',
    entity: asString(r['entity']) ?? '',
    app: asString(r['app']) ?? '',
    module: asString(r['module']) ?? '',
    functionalArea: asString(r['functionalArea']) ?? '',
    processTags: asArray(r['processTags']).filter((a): a is string => typeof a === 'string'),
    sensitivity: asString(r['sensitivity']) ?? 'internal',
    write: asBool(r['write'], false),
    coreForRoles: asArray(r['coreForRoles']).filter((a): a is string => typeof a === 'string'),
    bindingType: asString(binding['type']) ?? 'function',
    bindingTechnology: asString(binding['technology']) ?? '',
    bindingRef: asString(binding['ref']) ?? '',
    bindingRefVersion: asString(binding['refVersion']),
    identityCarries: asString(identity['carries']) ?? 'unverified',
    bindingCustom: asBool(r['bindingCustom'], false),
    input,
    summaryTemplate: asString(output['summaryTemplate']) ?? '',
    resultKeys,
    writeSafety,
    reviewPath: asString(governance['reviewPath']) ?? 'standard',
    owner: asString(governance['owner']) ?? '',
    steward: asString(governance['steward']) ?? '',
    policyException: asString(governance['policyException']),
  };
}
