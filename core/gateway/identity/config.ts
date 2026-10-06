// MCPForge — `identity.providers`, the overlay block that selects the identity
// providers. W0-D1 (single provider), W0-P23 (a list), 02 §4.4 item 1.
//
// 02 §4.4: "`identity.provider: local | oidc` in the overlay, plus a provider
// block. **No other code path knows which is in use.**" W0-P4 §2.1 item 1 (owner,
// 25 Sep 2026) turned it into a list: "`identity.providers: [{ id, kind: local |
// oidc, ... }]`, replacing the single `identity.provider`. Each entry is values
// only (issuer, client id, groups claim, discovery URL ...). The overlay-purity
// rule is unchanged." Several providers may be active at once (§9 decision 1).
//
// **Where it lives.** `overlays/<deployment>/identity.yaml`, a values-only file
// beside `deployment.yaml` and `ais-targets.yaml`, `kind: Identity`. It also
// gives the sign-in session limits (W0-P4 §9 decision 6: 8 h idle, 12 h
// absolute) their overlay home, which W0-P5a deferred to this task.
//
// **No secret anywhere in this block, and no field for one.** The gateway is a
// Resource Server for every OIDC provider: it verifies tokens against the
// provider's PUBLISHED JWKS and needs no client secret. The portal signs its
// viewers in with authorization code + PKCE as a PUBLIC client, because
// non-negotiable 8 forbids `SecretStore.get()` in the portal. A `clientSecret`
// or `clientSecretRef` key is therefore refused as an undeclared key, not
// carried around unused.
//
// **No file means the Wave 0 default:** the one local provider, as before this
// task. That is a configuration default, not an identity fallback: a request
// still resolves to a real human through a configured provider or is refused.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { IdentityProviderKind } from './types.js';
import { PROVIDER_ID_RE, isProviderId } from './subject.js';

/** Wave 0's default issuer identity for the local provider. */
export const DEFAULT_LOCAL_ISSUER = 'https://mcpforge.local/identity';
/** Wave 0's default audience for the local provider — the gateway itself. */
export const DEFAULT_LOCAL_AUDIENCE = 'mcpforge-gateway';
/** The one id a `kind: local` provider may have: local subjects are `local:<uuid>`. */
export const LOCAL_PROVIDER_ID = 'local' as const;
/** Scopes the portal asks an OIDC provider for when the overlay names none. */
export const DEFAULT_OIDC_SCOPES: readonly string[] = Object.freeze([
  'openid',
  'profile',
  'email',
  'offline_access',
]);
/** W0-P4 §9 decision 6. */
export const DEFAULT_IDLE_SECONDS = 8 * 60 * 60;
export const DEFAULT_ABSOLUTE_SECONDS = 12 * 60 * 60;

/** The file, under `overlays/<deployment>/`. */
export const IDENTITY_OVERLAY_FILE = 'identity.yaml';

interface ProviderBase {
  /** Qualifies every subject this provider resolves: `<id>:<sub>`. Immutable once rows exist. */
  readonly id: string;
  /** What the portal's sign-in chooser shows. */
  readonly displayName: string;
}

/** The gateway's own issuer and `LocalUserStore`. At most one, and its id is `local`. */
export interface LocalProviderConfig extends ProviderBase {
  readonly kind: 'local';
}

/** Any OIDC provider: Entra ID, OCI IAM Identity Domains, Keycloak, Agentis. */
export interface OidcProviderConfig extends ProviderBase {
  readonly kind: 'oidc';
  /** The `iss` this deployment trusts for this provider; discovery must agree. */
  readonly issuer: string;
  readonly discoveryUrl: string;
  /** The `aud` its access tokens must carry: this gateway as Resource Server. */
  readonly audience: string;
  /** The portal's PUBLIC client id at this provider (authorization code + PKCE). */
  readonly clientId: string;
  /** Scopes the portal requests. Default: openid profile email offline_access. */
  readonly scopes: readonly string[];
  readonly groupsClaim?: string;
  readonly nameClaim?: string;
}

export type IdentityProviderConfig = LocalProviderConfig | OidcProviderConfig;

export interface SessionLimitsConfig {
  readonly idleSeconds: number;
  readonly absoluteSeconds: number;
}

/** The whole `identity:` block of one deployment. */
export interface IdentityConfig {
  readonly providers: readonly IdentityProviderConfig[];
  readonly sessionLimits: SessionLimitsConfig;
}

/** The provider kind an entry selects. Total over the union. */
export function identityProviderKind(config: IdentityProviderConfig): IdentityProviderKind {
  return config.kind;
}

/** Wave 0's configuration when a deployment has no `identity.yaml`: local only. */
export function defaultIdentityConfig(): IdentityConfig {
  return {
    providers: [{ id: LOCAL_PROVIDER_ID, kind: 'local', displayName: 'MCPForge account' }],
    sessionLimits: { idleSeconds: DEFAULT_IDLE_SECONDS, absoluteSeconds: DEFAULT_ABSOLUTE_SECONDS },
  };
}

/** Why an identity overlay cannot be used. The gateway refuses to start on it. */
export class IdentityConfigInvalid extends Error {
  readonly problems: readonly string[];
  constructor(file: string, problems: readonly string[]) {
    super(`${file} cannot be used:\n  ${problems.join('\n  ')}`);
    this.name = 'IdentityConfigInvalid';
    this.problems = problems;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const TOP_KEYS = new Set(['apiVersion', 'kind', 'deployment', 'identity']);
const IDENTITY_KEYS = new Set(['providers', 'sessionLimits']);
const LOCAL_KEYS = new Set(['id', 'kind', 'displayName']);
const OIDC_KEYS = new Set([
  'id',
  'kind',
  'displayName',
  'issuer',
  'discoveryUrl',
  'audience',
  'clientId',
  'scopes',
  'groupsClaim',
  'nameClaim',
]);
const LIMIT_KEYS = new Set(['idleSeconds', 'absoluteSeconds']);

/**
 * https, or http on loopback only (a disposable Keycloak in a test, a local
 * dev IdP). The same posture `fetchOidcDiscovery` enforces at startup; checked
 * here too so a bad URL is a config error with the file named.
 */
function acceptableUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
  );
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Parse one `identity.yaml`'s text. Every problem is collected, so an operator
 * fixes the file in one pass.
 */
export function parseIdentityConfig(
  file: string,
  text: string,
  deployment?: string,
): IdentityConfig {
  const problems: string[] = [];
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    throw new IdentityConfigInvalid(file, [`invalid YAML: ${(error as Error).message}`]);
  }
  if (!isRecord(raw)) throw new IdentityConfigInvalid(file, ['must be a YAML mapping document']);
  for (const key of Object.keys(raw)) {
    if (!TOP_KEYS.has(key)) problems.push(`top-level key "${key}" is not part of kind: Identity`);
  }
  if (raw['apiVersion'] !== 'mcpforge/v1') problems.push('apiVersion must be "mcpforge/v1"');
  if (raw['kind'] !== 'Identity') problems.push('kind must be "Identity"');
  if (!nonEmpty(raw['deployment'])) problems.push('deployment must be a non-empty string');
  else if (deployment !== undefined && raw['deployment'] !== deployment) {
    problems.push(
      `declares deployment "${String(raw['deployment'])}", but it lives under overlays/${deployment}/`,
    );
  }

  const identity = raw['identity'];
  const providers: IdentityProviderConfig[] = [];
  let sessionLimits: SessionLimitsConfig = defaultIdentityConfig().sessionLimits;
  if (!isRecord(identity)) {
    problems.push('identity must be a mapping with a "providers" list');
  } else {
    for (const key of Object.keys(identity)) {
      if (!IDENTITY_KEYS.has(key)) problems.push(`identity.${key} is not a declared key`);
    }
    const list = identity['providers'];
    if (!Array.isArray(list) || list.length === 0) {
      problems.push('identity.providers must be a non-empty list');
    } else {
      list.forEach((entry, index) => {
        const parsed = parseProvider(entry, `identity.providers[${index}]`, problems);
        if (parsed !== undefined) providers.push(parsed);
      });
    }
    const seen = new Set<string>();
    for (const p of providers) {
      if (seen.has(p.id)) problems.push(`provider id "${p.id}" is configured twice`);
      seen.add(p.id);
    }
    const issuers = new Set<string>();
    for (const p of providers) {
      if (p.kind !== 'oidc') continue;
      if (issuers.has(p.issuer)) {
        problems.push(
          `issuer ${p.issuer} is configured twice; one issuer is one provider, or a token could be read in two namespaces`,
        );
      }
      issuers.add(p.issuer);
    }
    const limits = identity['sessionLimits'];
    if (limits !== undefined) {
      const parsed = parseLimits(limits, problems);
      if (parsed !== undefined) sessionLimits = parsed;
    }
  }
  if (problems.length > 0) throw new IdentityConfigInvalid(file, problems);
  return { providers, sessionLimits };
}

function parseProvider(
  entry: unknown,
  at: string,
  problems: string[],
): IdentityProviderConfig | undefined {
  if (!isRecord(entry)) {
    problems.push(`${at} must be a mapping`);
    return undefined;
  }
  const id = entry['id'];
  if (!isProviderId(id)) {
    problems.push(`${at}.id must match ${PROVIDER_ID_RE.source} (it prefixes every subject)`);
    return undefined;
  }
  const displayName = nonEmpty(entry['displayName']) ? entry['displayName'].trim() : undefined;
  const kind = entry['kind'];
  if (kind === 'local') {
    for (const key of Object.keys(entry)) {
      if (!LOCAL_KEYS.has(key))
        problems.push(`${at}.${key} is not a declared key of a local provider`);
    }
    if (id !== LOCAL_PROVIDER_ID) {
      problems.push(
        `${at}: a local provider's id must be "${LOCAL_PROVIDER_ID}", because local subjects are already written as local:<uuid>`,
      );
      return undefined;
    }
    return { id, kind, displayName: displayName ?? 'MCPForge account' };
  }
  if (kind !== 'oidc') {
    problems.push(`${at}.kind must be "local" or "oidc"`);
    return undefined;
  }
  for (const key of Object.keys(entry)) {
    if (!OIDC_KEYS.has(key)) {
      problems.push(
        /secret/i.test(key)
          ? `${at}.${key}: no client secret is configured anywhere; the gateway only verifies tokens and the portal is a public PKCE client`
          : `${at}.${key} is not a declared key of an oidc provider`,
      );
    }
  }
  const before = problems.length;
  const url = (key: string): string => {
    const v = entry[key];
    if (!nonEmpty(v) || !acceptableUrl(v)) {
      problems.push(`${at}.${key} must be an https URL (http only on loopback)`);
      return '';
    }
    return v;
  };
  const text = (key: string): string => {
    const v = entry[key];
    if (!nonEmpty(v)) {
      problems.push(`${at}.${key} must be a non-empty string`);
      return '';
    }
    return v;
  };
  const optional = (key: string): string | undefined => {
    const v = entry[key];
    if (v === undefined) return undefined;
    if (!nonEmpty(v)) {
      problems.push(`${at}.${key} must be a non-empty string when present`);
      return undefined;
    }
    return v;
  };
  const issuer = url('issuer');
  const discoveryUrl = url('discoveryUrl');
  const audience = text('audience');
  const clientId = text('clientId');
  let scopes = DEFAULT_OIDC_SCOPES;
  const rawScopes = entry['scopes'];
  if (rawScopes !== undefined) {
    if (
      !Array.isArray(rawScopes) ||
      rawScopes.length === 0 ||
      !rawScopes.every((s) => typeof s === 'string' && /^[\x21\x23-\x5B\x5D-\x7E]+$/.test(s))
    ) {
      problems.push(`${at}.scopes must be a non-empty list of scope tokens`);
    } else if (!rawScopes.includes('openid')) {
      problems.push(`${at}.scopes must include "openid"`);
    } else {
      scopes = Object.freeze([...new Set(rawScopes as string[])]);
    }
  }
  const groupsClaim = optional('groupsClaim');
  const nameClaim = optional('nameClaim');
  if (problems.length > before) return undefined;
  return {
    id,
    kind,
    displayName: displayName ?? id,
    issuer,
    discoveryUrl,
    audience,
    clientId,
    scopes,
    ...(groupsClaim === undefined ? {} : { groupsClaim }),
    ...(nameClaim === undefined ? {} : { nameClaim }),
  };
}

function parseLimits(value: unknown, problems: string[]): SessionLimitsConfig | undefined {
  if (!isRecord(value)) {
    problems.push('identity.sessionLimits must be a mapping of idleSeconds and absoluteSeconds');
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (!LIMIT_KEYS.has(key)) problems.push(`identity.sessionLimits.${key} is not a declared key`);
  }
  const whole = (key: string, fallback: number): number => {
    const v = value[key];
    if (v === undefined) return fallback;
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
      problems.push(`identity.sessionLimits.${key} must be a positive whole number of seconds`);
      return fallback;
    }
    return v;
  };
  const idleSeconds = whole('idleSeconds', DEFAULT_IDLE_SECONDS);
  const absoluteSeconds = whole('absoluteSeconds', DEFAULT_ABSOLUTE_SECONDS);
  if (idleSeconds > absoluteSeconds) {
    problems.push('identity.sessionLimits.idleSeconds cannot be longer than absoluteSeconds');
    return undefined;
  }
  return { idleSeconds, absoluteSeconds };
}

/**
 * This deployment's identity block, from `overlays/<deployment>/identity.yaml`,
 * or the local-only default when the file does not exist. Throws
 * `IdentityConfigInvalid` on a file that exists but cannot be used: a gateway
 * that silently dropped a configured provider would be serving a different set
 * of humans than the one a reviewer approved.
 */
export function loadIdentityConfig(overlaysRoot: string, deployment: string): IdentityConfig {
  const file = join(overlaysRoot, deployment, IDENTITY_OVERLAY_FILE);
  if (!existsSync(file)) return defaultIdentityConfig();
  return parseIdentityConfig(file, readFileSync(file, 'utf8'), deployment);
}
