// MCPForge — W0-Q9: the overlay block that configures authoring providers.
// Note §2.1, §4. Values only (config, never code, never a secret): a provider's
// key is a `secretRef://` and nothing else. `.strict()` rejects any `apiKey`,
// `token` or `password` field outright, so a pasted credential fails the parse
// instead of being carried around.
//
// Lives at `overlays/<deployment>/authoring.yaml`. Absent file = feature off.

import { isSecretRef } from '@mcpforge/gateway/secrets';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { failure, type SuggestFailure } from './types.js';

export const SENSITIVITY_CLASSES = [
  'public',
  'internal',
  'confidential',
  'financial',
  'personal',
] as const;
export type SensitivityClass = (typeof SENSITIVITY_CLASSES)[number];

/** D4: `personal` and `financial` are NOT in the default. A provider's overlay may add them. */
export const DEFAULT_ALLOWED_SENSITIVITIES: readonly SensitivityClass[] = [
  'public',
  'internal',
  'confidential',
];

const keyRef = z.string().refine(isSecretRef, {
  message:
    'must be a secretRef://<scope>/<subject>/<purpose> reference. A key value is never accepted here.',
});

const common = {
  id: z.string().regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  keyRef,
  allowedSensitivities: z
    .array(z.enum(SENSITIVITY_CLASSES))
    .default([...DEFAULT_ALLOWED_SENSITIVITIES]),
};

/** BlueVerse: the model is chosen inside the flow, so there is no `model` (note §2.2). */
const blueverse = z
  .object({
    ...common,
    kind: z.literal('blueverse'),
    baseUrl: z.string().url().default('https://blueverse-foundry.ltm.com/chatservice/chat'),
    /** Human-supplied: the BlueVerse space and flow created for copy drafting. Empty until set. */
    spaceName: z.string().default(''),
    flowId: z.string().default(''),
  })
  .strict();

const anthropic = z
  .object({
    ...common,
    kind: z.literal('anthropic'),
    model: z.string().min(1),
    baseUrl: z.string().url().default('https://api.anthropic.com/v1/messages'),
  })
  .strict();

const openaiCompatible = z
  .object({
    ...common,
    kind: z.literal('openai-compatible'),
    model: z.string().min(1),
    /** Required: there is no vendor default. May point at a local server. */
    baseUrl: z.string().url(),
  })
  .strict();

export const providerSchema = z.discriminatedUnion('kind', [
  blueverse,
  anthropic,
  openaiCompatible,
]);
export type ProviderConfig = z.infer<typeof providerSchema>;

export const authoringConfigSchema = z
  .object({
    apiVersion: z.literal('mcpforge/v1'),
    kind: z.literal('AuthoringModels'),
    /** Off until an overlay turns it on, everywhere. */
    enabled: z.boolean().default(false),
    default: z.string().optional(),
    providers: z.array(providerSchema).default([]),
  })
  .strict()
  .superRefine((c, ctx) => {
    const ids = c.providers.map((p) => p.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'provider ids must be unique', path: ['providers'] });
    }
    if (c.default !== undefined && !ids.includes(c.default)) {
      ctx.addIssue({
        code: 'custom',
        message: `default "${c.default}" is not one of the configured providers`,
        path: ['default'],
      });
    }
  });
export type AuthoringConfig = z.infer<typeof authoringConfigSchema>;

/** The feature-absent config: nothing enabled, nothing configured. */
export const UNCONFIGURED: AuthoringConfig = {
  apiVersion: 'mcpforge/v1',
  kind: 'AuthoringModels',
  enabled: false,
  providers: [],
};

export function parseAuthoringConfig(
  text: string,
): { ok: true; config: AuthoringConfig } | { ok: false; message: string; next: string } {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (e) {
    return {
      ok: false,
      message: `authoring.yaml is not valid YAML: ${e instanceof Error ? e.message : String(e)}`,
      next: 'Fix overlays/<deployment>/authoring.yaml through a change proposal.',
    };
  }
  const r = authoringConfigSchema.safeParse(doc);
  if (!r.success) {
    const first = r.error.issues[0];
    return {
      ok: false,
      message:
        `authoring.yaml is invalid: ${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim(),
      next: 'Correct overlays/<deployment>/authoring.yaml. A provider key is a keyRef (secretRef://...), never a value; store the key with "forge secrets put".',
    };
  }
  return { ok: true, config: r.data };
}

/**
 * Pick a provider. NO SILENT FALLBACK (note §2.1): a requested provider that
 * fails is a failure naming the others, never a quiet switch, because switching
 * silently sends the draft to a provider nobody chose.
 */
export function selectProvider(
  config: AuthoringConfig,
  requestedId?: string,
): { ok: true; provider: ProviderConfig } | SuggestFailure {
  if (!config.enabled || config.providers.length === 0) {
    return failure(
      'AUTHORING_NOT_CONFIGURED',
      'Model-assisted authoring is not configured.',
      'Nothing else depends on it. To enable it, add overlays/<deployment>/authoring.yaml with enabled: true and a provider, and store its key with "forge secrets put".',
    );
  }
  const wanted = requestedId ?? config.default ?? config.providers[0]?.id;
  const found = config.providers.find((p) => p.id === wanted);
  if (found === undefined) {
    return failure(
      'AUTHORING_PROVIDER_UNKNOWN',
      `No configured provider "${String(wanted)}".`,
      `Choose one of: ${config.providers.map((p) => p.id).join(', ')}.`,
    );
  }
  return { ok: true, provider: found };
}

/** D4: may this provider see a tool of this sensitivity? A per-provider overlay setting, not a hard block. */
export function sensitivityAllowed(
  provider: ProviderConfig,
  sensitivity: string,
): SuggestFailure | undefined {
  if ((provider.allowedSensitivities as readonly string[]).includes(sensitivity)) return undefined;
  return failure(
    'AUTHORING_SENSITIVITY_BLOCKED',
    `Provider "${provider.id}" is not allowed to see ${sensitivity} tools.`,
    `Either write this copy by hand, choose a provider whose allowedSensitivities includes "${sensitivity}", or add it to "${provider.id}" in overlays/<deployment>/authoring.yaml through a change proposal.`,
  );
}
