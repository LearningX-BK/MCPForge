// MCPForge — how the runtime store is addressed and described. 02 §10.2.

/**
 * The dialects the one schema definition is projected into. SQLite is the Wave
 * 0 and local-development store; Postgres is the OCI-era store and is contract
 * -tested from day one so the swap is proven, not hoped (02 §10.4 item 8).
 * Oracle Database is deferred, not designed-out (02 §1.5) — do not add it here
 * speculatively.
 */
export type StoreKind = 'sqlite' | 'postgres';

/** 02 §10.2 — one file, `./.mcpforge/runtime.db`. */
export const DEFAULT_SQLITE_PATH = './.mcpforge/runtime.db';

export interface SqliteStoreConfig {
  readonly kind: 'sqlite';
  /** Defaults to `./.mcpforge/runtime.db`. `:memory:` is allowed for tests. */
  readonly file?: string;
}

export interface PostgresStoreConfig {
  readonly kind: 'postgres';
  readonly connectionString: string;
}

export type StoreConfig = SqliteStoreConfig | PostgresStoreConfig;

/**
 * What the portal's data-class chip renders (03 §11.2, restated in 02 §10.5).
 * `ephemeral` is the honest bit: on SQLite the audit trail starts empty on a
 * fresh checkout, because the store is one local file (02 §10.3).
 */
export interface StoreDescriptor {
  readonly kind: StoreKind;
  readonly label: string;
  readonly location: string;
  readonly ephemeral: boolean;
}

/**
 * The Wave 0 gateway runs as ONE instance (02 §10.4 item 6). SQLite is a
 * single-writer, single-host store; multi-replica is a Postgres-era property
 * and may not be claimed, written or evidenced as a Wave 0 property anywhere.
 */
export const WAVE_0_SINGLE_INSTANCE = true;

export function describeStore(config: StoreConfig): StoreDescriptor {
  if (config.kind === 'sqlite') {
    return {
      kind: 'sqlite',
      label: 'SQLite · local file',
      location: config.file ?? DEFAULT_SQLITE_PATH,
      ephemeral: true,
    };
  }
  return {
    kind: 'postgres',
    label: 'PostgreSQL · server',
    // Never the connection string: it can carry a credential, and a credential
    // is a `secretRef://` everywhere a human or a log can see it (CLAUDE.md
    // non-negotiable 8). The chip needs the class, not the address.
    location: 'configured connection',
    ephemeral: false,
  };
}

/**
 * Resolve the store configuration from the environment. SQLite is the default
 * and requires nothing — Wave 0 must build, test, run, probe and demo on one
 * developer machine with no managed database (02 §10.1 item 2).
 */
export function storeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StoreConfig {
  const kind = env['MCPFORGE_STORE_KIND'];
  if (kind === 'postgres') {
    const connectionString = env['MCPFORGE_STORE_URL'];
    if (connectionString === undefined || connectionString.trim().length === 0) {
      throw new Error(
        'MCPFORGE_STORE_KIND=postgres requires MCPFORGE_STORE_URL. Set it, or unset MCPFORGE_STORE_KIND to use the default local SQLite store.',
      );
    }
    return { kind: 'postgres', connectionString };
  }
  if (kind !== undefined && kind !== 'sqlite') {
    throw new Error(
      `Unknown MCPFORGE_STORE_KIND "${kind}". The runtime store is "sqlite" (Wave 0 default) or "postgres" (02 §10.2).`,
    );
  }
  const file = env['MCPFORGE_STORE_FILE'];
  return file === undefined ? { kind: 'sqlite' } : { kind: 'sqlite', file };
}
