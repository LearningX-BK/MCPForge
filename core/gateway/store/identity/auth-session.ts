// MCPForge — the `auth_session` / `auth_refresh_token` repository. W0-P5a,
// W0-P4 §9 decision 6: "a rotating refresh token ... stored hashed in the
// runtime store, rotated on every use, and reuse of a spent refresh token
// revokes the whole session (theft detection)."
//
// **How exactly-one-winner is decided without a driver row count.** `changes`
// (SQLite) and `rowCount` (Postgres) do not survive the dialect swap (see
// `../runtime/approvals.ts`), so the spend is a conditional update that also
// writes the successor's id, `... set replaced_by = <newId> where id = ? and
// spent_at is null`, followed by a re-read. Whoever's id is on the row won. On
// SQLite the transaction serialises writers; on Postgres the loser's update
// re-evaluates `spent_at is null` after the winner commits and matches nothing.
// Either way the loser sees someone else's id, and that is reuse.
//
// Holds on one node, like every other Wave 0 atomicity claim (02 §10.4 item 6).

import { sql } from 'drizzle-orm';
import type { DialectConnection } from '../dialect.js';
import { uuidv7 } from '../id.js';
import { AUTH_REFRESH_TOKEN, AUTH_SESSION } from '../schema/spec.js';
import {
  AUTH_SESSION_REVOKED_REASONS,
  type AuthSessionRecord,
  type AuthSessionRepository,
  type AuthSessionRevokedReason,
  type OpenAuthSessionInput,
  type RefreshTokenRecord,
  type RotateRefreshTokenInput,
  type RotateRefreshTokenOutcome,
} from './auth-session-types.js';

/** The `ses_` prefix, so a session id is recognisable in a log line. */
export const AUTH_SESSION_ID_PREFIX = 'ses_' as const;

const S = sql.identifier(AUTH_SESSION.name);
const R = sql.identifier(AUTH_REFRESH_TOKEN.name);
const col = (name: string) => sql.identifier(name);

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function required(table: string, row: Row, column: string): string {
  const value = text(row[column]);
  if (value === null) throw new Error(`${table}.${column} is NOT NULL but came back null.`);
  return value;
}

function revokedReason(value: unknown): AuthSessionRevokedReason | null {
  const raw = text(value);
  if (raw === null) return null;
  if ((AUTH_SESSION_REVOKED_REASONS as readonly string[]).includes(raw)) {
    return raw as AuthSessionRevokedReason;
  }
  throw new Error(`${AUTH_SESSION.name}.revoked_reason holds "${raw}", outside the closed set.`);
}

function toSession(row: Row): AuthSessionRecord {
  const t = AUTH_SESSION.name;
  const amr = JSON.parse(required(t, row, 'amr')) as unknown;
  if (!Array.isArray(amr) || !amr.every((m) => typeof m === 'string')) {
    throw new Error(`${t}.amr is not a JSON array of strings.`);
  }
  return {
    id: required(t, row, 'id'),
    subject: required(t, row, 'subject'),
    providerId: required(t, row, 'provider_id'),
    amr: Object.freeze([...(amr as string[])]),
    createdAt: required(t, row, 'created_at'),
    absoluteExpiresAt: required(t, row, 'absolute_expires_at'),
    revokedAt: text(row['revoked_at']),
    revokedReason: revokedReason(row['revoked_reason']),
  };
}

function toToken(row: Row): RefreshTokenRecord {
  const t = AUTH_REFRESH_TOKEN.name;
  return {
    id: required(t, row, 'id'),
    sessionId: required(t, row, 'session_id'),
    tokenHash: required(t, row, 'token_hash'),
    issuedAt: required(t, row, 'issued_at'),
    idleExpiresAt: required(t, row, 'idle_expires_at'),
    spentAt: text(row['spent_at']),
    replacedBy: text(row['replaced_by']),
  };
}

export function authSessionRepository(connection: DialectConnection): AuthSessionRepository {
  async function getSession(id: string): Promise<AuthSessionRecord | undefined> {
    const rows = await connection.all<Row>(sql`select * from ${S} where ${col('id')} = ${id}`);
    return rows[0] === undefined ? undefined : toSession(rows[0]);
  }

  async function getTokenById(id: string): Promise<RefreshTokenRecord | undefined> {
    const rows = await connection.all<Row>(sql`select * from ${R} where ${col('id')} = ${id}`);
    return rows[0] === undefined ? undefined : toToken(rows[0]);
  }

  async function getTokenByHash(hash: string): Promise<RefreshTokenRecord | undefined> {
    const rows = await connection.all<Row>(
      sql`select * from ${R} where ${col('token_hash')} = ${hash}`,
    );
    return rows[0] === undefined ? undefined : toToken(rows[0]);
  }

  async function insertToken(
    sessionId: string,
    tokenHash: string,
    issuedAt: string,
    idleExpiresAt: string,
    id: string = uuidv7(),
  ): Promise<RefreshTokenRecord> {
    await connection.run(
      sql`insert into ${R} (${col('id')}, ${col('session_id')}, ${col('token_hash')}, ${col('issued_at')}, ${col('idle_expires_at')}) values (${id}, ${sessionId}, ${tokenHash}, ${issuedAt}, ${idleExpiresAt})`,
    );
    return { id, sessionId, tokenHash, issuedAt, idleExpiresAt, spentAt: null, replacedBy: null };
  }

  async function revokeSession(
    id: string,
    reason: AuthSessionRevokedReason,
    now: string,
  ): Promise<void> {
    // `revoked_at is null` keeps the FIRST reason: a session signed out and
    // then replayed stays `signed_out`, which is what an operator needs to read.
    await connection.run(
      sql`update ${S} set ${col('revoked_at')} = ${now}, ${col('revoked_reason')} = ${reason} where ${col('id')} = ${id} and ${col('revoked_at')} is null`,
    );
  }

  async function revokedAndReread(
    session: AuthSessionRecord,
    reason: AuthSessionRevokedReason,
    now: string,
  ): Promise<AuthSessionRecord> {
    await revokeSession(session.id, reason, now);
    return (await getSession(session.id)) ?? session;
  }

  return {
    open(input: OpenAuthSessionInput) {
      return connection.transaction(async () => {
        const id = `${AUTH_SESSION_ID_PREFIX}${uuidv7()}`;
        const amr = JSON.stringify([...input.amr]);
        await connection.run(
          sql`insert into ${S} (${col('id')}, ${col('subject')}, ${col('provider_id')}, ${col('amr')}, ${col('created_at')}, ${col('absolute_expires_at')}) values (${id}, ${input.subject}, ${input.providerId}, ${amr}, ${input.now}, ${input.absoluteExpiresAt})`,
        );
        const token = await insertToken(id, input.tokenHash, input.now, input.idleExpiresAt);
        const session = await getSession(id);
        if (session === undefined) throw new Error(`auth_session ${id} vanished after insert.`);
        return { session, token };
      });
    },

    get: getSession,

    async findByTokenHash(tokenHash: string) {
      const token = await getTokenByHash(tokenHash);
      if (token === undefined) return undefined;
      const session = await getSession(token.sessionId);
      return session === undefined ? undefined : { session, token };
    },

    rotate(input: RotateRefreshTokenInput): Promise<RotateRefreshTokenOutcome> {
      return connection.transaction(async (): Promise<RotateRefreshTokenOutcome> => {
        const presented = await getTokenByHash(input.presentedHash);
        if (presented === undefined) return { kind: 'unknown' };
        const session = await getSession(presented.sessionId);
        if (session === undefined) return { kind: 'unknown' };

        // Order matters. Reuse is checked before "already revoked" is
        // reported, so a replay against an ended session still reads as
        // reuse to the caller's log, and the session's first reason stands.
        if (presented.spentAt !== null) {
          return {
            kind: 'reused',
            session: await revokedAndReread(session, 'refresh_reuse', input.now),
          };
        }
        if (session.revokedAt !== null) return { kind: 'revoked', session };
        if (input.now >= session.absoluteExpiresAt) {
          return {
            kind: 'absolute_expired',
            session: await revokedAndReread(session, 'absolute_expired', input.now),
          };
        }
        if (input.now >= presented.idleExpiresAt) {
          return {
            kind: 'idle_expired',
            session: await revokedAndReread(session, 'idle_expired', input.now),
          };
        }

        // The claim. See the file header for why the re-read decides it.
        const successorId = uuidv7();
        await connection.run(
          sql`update ${R} set ${col('spent_at')} = ${input.now}, ${col('replaced_by')} = ${successorId} where ${col('id')} = ${presented.id} and ${col('spent_at')} is null`,
        );
        const claimed = await getTokenById(presented.id);
        if (claimed?.replacedBy !== successorId) {
          return {
            kind: 'reused',
            session: await revokedAndReread(session, 'refresh_reuse', input.now),
          };
        }
        const token = await insertToken(
          session.id,
          input.newHash,
          input.now,
          input.idleExpiresAt,
          successorId,
        );
        return { kind: 'rotated', session, token };
      });
    },

    revoke(sessionId, reason, now) {
      return revokeSession(sessionId, reason, now);
    },
  };
}
