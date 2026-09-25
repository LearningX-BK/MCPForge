// MCPForge — the per-user AIS token exchange. W0-P14, 02 §3.5 option (a).
//
// 02 §3.5 allows exactly one way for a write to reach JD Edwards: "the gateway
// exchanges the caller's identity for a per-user AIS token via the JDE token
// provider configured on the instance". Option (b), holding the human's own
// JDE password, is structurally excluded; option (c), a shared service account,
// may never run a write. This module is option (a) and nothing else:
//
//   * The ONLY input identity is the caller's `Principal.subject`. There is no
//     default subject, no "system" subject, and no code path that asks for a
//     token without one (CLAUDE.md #1).
//   * The gateway authenticates to the token provider as ITSELF, with a client
//     credential held in the SecretStore and named by a `secretRef://binding/
//     <serverId>/…` (02 §11.5 rule 4: one per binding × module × environment).
//     That credential can only ASK for a per-user token; it is never presented
//     to the orchestration endpoint, and the orchestration runs as the user the
//     token names (which the runtime identity echo then proves, W0-H3). 05
//     §382 lists this "JDE token-provider client credential" in Wave 0's
//     stored set; the binding's class is `per-user-exchanged` (02 §11.5.1).
//   * Tokens are cached PER SUBJECT until shortly before expiry. The cache key
//     is the exact subject string, so one caller's token can never serve another.
//   * A token value is never logged, never put in an error message, never
//     returned above this package.
//
// WIRE PROTOCOL — FLAGGED, not silently decided. 02 §3.5 names the mechanism
// (a trusted token provider on the instance) but not its wire format, and no
// JD Edwards instance exists in this environment to read it from. This module
// speaks one small, documented protocol, which `tests/mocks`'s mock JDE
// implements:
//
//   POST <tokenUrl>
//   Authorization: Basic base64(<clientId>:<client secret>)
//   Content-Type: application/json
//   { "subject": "<Principal.subject>" }
//
//   200 { "token": "<opaque>", "expiresInSeconds": <n>, "username": "<jde user>" }
//   403/404  the subject is not a user on this instance     -> AisIdentityRefused
//   401      the gateway's client credential was rejected   -> AisTokenProviderUnavailable
//   other    / transport failure                            -> AisTokenProviderUnavailable
//
// Pointing this at a real JDE token provider means matching ITS protocol here,
// behind the same `AisTokenProvider` seam; that is a named follow-up for when a
// real instance exists, never a shared token in the meantime.

/** Raised when no per-user token can exist for this caller. Maps to IDENTITY_UNRESOLVED. */
export class AisIdentityRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AisIdentityRefused';
  }
}

/** Raised when the token provider cannot be used at all. Maps to TARGET_UNAVAILABLE. */
export class AisTokenProviderUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AisTokenProviderUnavailable';
  }
}

/** The seam the HTTP AIS client authenticates through. */
export interface AisTokenProvider {
  /**
   * A per-user AIS token for `subject`. Throws `AisIdentityRefused` or
   * `AisTokenProviderUnavailable`; never returns a token for anyone else.
   */
  tokenFor(subject: string, signal: AbortSignal): Promise<string>;
  /** Drop a cached token the target has rejected, so the next call re-exchanges. */
  invalidate(subject: string): void;
}

/**
 * The slice of the gateway's `SecretStore` this module needs, declared
 * structurally because this package may not depend on the gateway. `get()` is
 * called here, inside `adapters/**`, which is one of the two places 02 §11.5
 * rule 2 allows it. The ref is passed through opaquely.
 */
export interface ClientCredentialSource<Ref> {
  readonly ref: Ref;
  readonly secretStore: {
    get(ref: Ref): Promise<{ revealSecretValue(): string }>;
  };
}

export interface HttpAisTokenProviderOptions<Ref> {
  readonly tokenUrl: string;
  /** The gateway's client id at the token provider. Not a secret. */
  readonly clientId: string;
  readonly clientCredential: ClientCredentialSource<Ref>;
  /** Re-exchange this long before expiry. Default 30 s. */
  readonly refreshMarginMs?: number;
  readonly now?: () => number;
  readonly fetch?: typeof fetch;
}

interface CachedToken {
  readonly token: string;
  readonly expiresAt: number;
}

export function createHttpAisTokenProvider<Ref>(
  options: HttpAisTokenProviderOptions<Ref>,
): AisTokenProvider {
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = options.now ?? (() => Date.now());
  const margin = options.refreshMarginMs ?? 30_000;
  const cache = new Map<string, CachedToken>();

  async function exchange(subject: string, signal: AbortSignal): Promise<CachedToken> {
    const secret = await options.clientCredential.secretStore.get(options.clientCredential.ref);
    const basic = Buffer.from(`${options.clientId}:${secret.revealSecretValue()}`, 'utf8').toString(
      'base64',
    );
    let response: Response;
    try {
      response = await doFetch(options.tokenUrl, {
        method: 'POST',
        headers: { authorization: `Basic ${basic}`, 'content-type': 'application/json' },
        body: JSON.stringify({ subject }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error; // the executor maps an abort to TARGET_TIMEOUT
      throw new AisTokenProviderUnavailable(
        `token provider unreachable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const text = await response.text();
    if (response.status === 403 || response.status === 404) {
      throw new AisIdentityRefused(
        `the token provider does not recognise subject "${subject}" as a user on this instance (HTTP ${response.status})`,
      );
    }
    if (response.status === 401) {
      throw new AisTokenProviderUnavailable(
        "the token provider rejected the gateway's client credential (HTTP 401)",
      );
    }
    if (!response.ok) {
      throw new AisTokenProviderUnavailable(`the token provider answered HTTP ${response.status}`);
    }
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      throw new AisTokenProviderUnavailable('the token provider answered with a non-JSON body');
    }
    const token = (doc as { token?: unknown }).token;
    const ttl = (doc as { expiresInSeconds?: unknown }).expiresInSeconds;
    if (typeof token !== 'string' || token.length === 0 || typeof ttl !== 'number' || ttl <= 0) {
      throw new AisTokenProviderUnavailable(
        'the token provider answered without a token and a positive expiresInSeconds',
      );
    }
    return { token, expiresAt: now() + ttl * 1000 };
  }

  return {
    async tokenFor(subject, signal) {
      if (typeof subject !== 'string' || subject.trim().length === 0) {
        throw new AisIdentityRefused('no caller subject was resolved for this call');
      }
      const cached = cache.get(subject);
      if (cached !== undefined && cached.expiresAt - margin > now()) return cached.token;
      cache.delete(subject);
      const fresh = await exchange(subject, signal);
      cache.set(subject, fresh);
      return fresh.token;
    },
    invalidate(subject) {
      cache.delete(subject);
    },
  };
}
