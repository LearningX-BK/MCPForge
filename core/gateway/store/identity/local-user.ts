// MCPForge — the `local_user` / `local_user_group` repository. W0-D2, 02 §4.4.
//
// Persistence only. No password is hashed here, no TOTP code is checked here,
// and no policy about who may sign in is decided here — all three belong to
// `core/gateway/identity/local/**`, which is the only module that calls
// `findCredential`. This file's whole contribution is that credential columns
// leave it through exactly one method and one type.

import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { DialectConnection } from '../dialect.js';
import { uuidv7 } from '../id.js';
import { LOCAL_USER, LOCAL_USER_GROUP } from '../schema/spec.js';
import {
  LocalUserExistsError,
  LocalUserNotFoundError,
  type CreateLocalUserInput,
  type LocalUserCredential,
  type LocalUserRecord,
  type LocalUserRepository,
  type RecordLocalAuthInput,
  type SetLocalPasswordInput,
  type SetLocalTotpInput,
  type UpdateLocalUserInput,
} from './types.js';

const U = sql.identifier(LOCAL_USER.name);
const G = sql.identifier(LOCAL_USER_GROUP.name);

const C = {
  id: sql.identifier('id'),
  subject: sql.identifier('subject'),
  username: sql.identifier('username'),
  displayName: sql.identifier('display_name'),
  email: sql.identifier('email'),
  active: sql.identifier('active'),
  passwordHash: sql.identifier('password_hash'),
  passwordAlgorithm: sql.identifier('password_algorithm'),
  passwordUpdatedAt: sql.identifier('password_updated_at'),
  totpSecret: sql.identifier('totp_secret'),
  totpConfirmedAt: sql.identifier('totp_confirmed_at'),
  totpLastCounter: sql.identifier('totp_last_counter'),
  failedAttempts: sql.identifier('failed_attempts'),
  lockedUntil: sql.identifier('locked_until'),
  lastAuthenticatedAt: sql.identifier('last_authenticated_at'),
  createdAt: sql.identifier('created_at'),
  updatedAt: sql.identifier('updated_at'),
} as const;

const GC = {
  id: sql.identifier('id'),
  userId: sql.identifier('user_id'),
  groupName: sql.identifier('group_name'),
  grantedAt: sql.identifier('granted_at'),
} as const;

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function required(row: Row, column: string): string {
  const value = text(row[column]);
  if (value === null) {
    throw new Error(`${LOCAL_USER.name}.${column} is NOT NULL but came back null.`);
  }
  return value;
}

function integer(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * SQLite stores booleans as 0/1 and Postgres as a native boolean; drizzle's
 * `all()` hands back whatever the driver produced, so the coercion happens once,
 * here, rather than in each caller where the two dialects could drift.
 */
function boolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 't' || value === 'true';
}

/**
 * Usernames are compared case-folded, because a person who enrolled as
 * `A.Okonkwo` will type `a.okonkwo` and both must reach the one account — and
 * more importantly must not be able to become two accounts. Fold on write and
 * on lookup, so the plain `UNIQUE` index does the enforcing in both dialects;
 * a `lower(username)` expression index would not project identically.
 */
function foldUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function localUserRepository(connection: DialectConnection): LocalUserRepository {
  /**
   * Booleans are bound per dialect, exactly as `../audit/repository.ts` does
   * it and for the same reason: `better-sqlite3` refuses to bind a JavaScript
   * boolean at all, and Postgres refuses an integer for a `boolean` column.
   * One place, both shapes — otherwise `active` is a runtime error on whichever
   * engine the author did not have open.
   */
  const bindable = (value: boolean): boolean | number =>
    connection.kind === 'sqlite' ? (value ? 1 : 0) : value;

  async function groupsFor(userId: string): Promise<string[]> {
    const rows = await connection.all<Row>(
      sql`select ${GC.groupName} from ${G} where ${GC.userId} = ${userId} order by ${GC.groupName} asc`,
    );
    return rows.map((row) => required(row, 'group_name'));
  }

  function toRecord(row: Row, groups: readonly string[]): LocalUserRecord {
    return {
      id: required(row, 'id'),
      subject: required(row, 'subject'),
      username: required(row, 'username'),
      displayName: required(row, 'display_name'),
      email: text(row['email']),
      active: boolean(row['active']),
      // Enrolled AND confirmed. A secret generated but never proved by a code
      // is not a second factor, and reporting it as one would let an operator
      // believe an account is protected by something it cannot yet use.
      totpEnrolled: text(row['totp_secret']) !== null && text(row['totp_confirmed_at']) !== null,
      failedAttempts: integer(row['failed_attempts']) ?? 0,
      lockedUntil: text(row['locked_until']),
      lastAuthenticatedAt: text(row['last_authenticated_at']),
      passwordUpdatedAt: required(row, 'password_updated_at'),
      createdAt: required(row, 'created_at'),
      updatedAt: required(row, 'updated_at'),
      groups,
    };
  }

  async function hydrate(row: Row): Promise<LocalUserRecord> {
    return toRecord(row, await groupsFor(required(row, 'id')));
  }

  async function rowWhere(clause: SQL): Promise<Row | undefined> {
    const rows = await connection.all<Row>(sql`select * from ${U} where ${clause}`);
    return rows[0];
  }

  async function requireRow(subject: string): Promise<Row> {
    const row = await rowWhere(sql`${C.subject} = ${subject}`);
    if (row === undefined) {
      throw new LocalUserNotFoundError(subject);
    }
    return row;
  }

  async function readBySubject(subject: string): Promise<LocalUserRecord> {
    return hydrate(await requireRow(subject));
  }

  async function touch(subject: string, now: string): Promise<void> {
    await connection.run(
      sql`update ${U} set ${C.updatedAt} = ${now} where ${C.subject} = ${subject}`,
    );
  }

  async function insertGroups(
    userId: string,
    groups: readonly string[],
    now: string,
  ): Promise<void> {
    const held = new Set(await groupsFor(userId));
    for (const group of new Set(groups.map((g) => g.trim()).filter((g) => g.length > 0))) {
      if (held.has(group)) continue;
      await connection.run(
        sql`insert into ${G} (${GC.id}, ${GC.userId}, ${GC.groupName}, ${GC.grantedAt}) values (${uuidv7()}, ${userId}, ${group}, ${now})`,
      );
    }
  }

  return {
    async create(input: CreateLocalUserInput): Promise<LocalUserRecord> {
      const now = input.now ?? new Date().toISOString();
      const username = foldUsername(input.username);
      return connection.transaction(async () => {
        // Checked, and then also constrained by the two UNIQUE indexes: the
        // read is what lets the refusal name WHICH field collided, and the
        // index is what makes the refusal true under a race.
        if ((await rowWhere(sql`${C.subject} = ${input.subject}`)) !== undefined) {
          throw new LocalUserExistsError('subject');
        }
        if ((await rowWhere(sql`${C.username} = ${username}`)) !== undefined) {
          throw new LocalUserExistsError('username');
        }
        const id = uuidv7();
        await connection.run(
          sql`insert into ${U} (${C.id}, ${C.subject}, ${C.username}, ${C.displayName}, ${C.email}, ${C.active}, ${C.passwordHash}, ${C.passwordAlgorithm}, ${C.passwordUpdatedAt}, ${C.totpSecret}, ${C.totpConfirmedAt}, ${C.totpLastCounter}, ${C.failedAttempts}, ${C.lockedUntil}, ${C.lastAuthenticatedAt}, ${C.createdAt}, ${C.updatedAt}) values (${id}, ${input.subject}, ${username}, ${input.displayName}, ${input.email ?? null}, ${bindable(input.active ?? true)}, ${input.passwordHash}, ${input.passwordAlgorithm}, ${now}, ${null}, ${null}, ${null}, ${0}, ${null}, ${null}, ${now}, ${now})`,
        );
        await insertGroups(id, input.groups ?? [], now);
        return readBySubject(input.subject);
      });
    },

    async findBySubject(subject: string): Promise<LocalUserRecord | undefined> {
      const row = await rowWhere(sql`${C.subject} = ${subject}`);
      return row === undefined ? undefined : hydrate(row);
    },

    async findByUsername(username: string): Promise<LocalUserRecord | undefined> {
      const row = await rowWhere(sql`${C.username} = ${foldUsername(username)}`);
      return row === undefined ? undefined : hydrate(row);
    },

    async findCredential(username: string): Promise<LocalUserCredential | undefined> {
      const row = await rowWhere(sql`${C.username} = ${foldUsername(username)}`);
      if (row === undefined) return undefined;
      const base = await hydrate(row);
      return {
        ...base,
        passwordHash: required(row, 'password_hash'),
        passwordAlgorithm: required(row, 'password_algorithm'),
        totpSecret: text(row['totp_secret']),
        totpConfirmedAt: text(row['totp_confirmed_at']),
        totpLastCounter: integer(row['totp_last_counter']),
      };
    },

    async list(options): Promise<LocalUserRecord[]> {
      const clause =
        options?.includeInactive === true ? sql`` : sql` where ${C.active} = ${bindable(true)}`;
      const rows = await connection.all<Row>(
        sql`select * from ${U}${clause} order by ${C.username} asc`,
      );
      const out: LocalUserRecord[] = [];
      for (const row of rows) out.push(await hydrate(row));
      return out;
    },

    async listByGroup(group: string): Promise<LocalUserRecord[]> {
      const rows = await connection.all<Row>(
        sql`select ${U}.* from ${U} join ${G} on ${G}.${GC.userId} = ${U}.${C.id} where ${G}.${GC.groupName} = ${group} order by ${U}.${C.username} asc`,
      );
      const out: LocalUserRecord[] = [];
      for (const row of rows) out.push(await hydrate(row));
      return out;
    },

    async update(input: UpdateLocalUserInput): Promise<LocalUserRecord> {
      const now = input.now ?? new Date().toISOString();
      return connection.transaction(async () => {
        await requireRow(input.subject);
        if (input.username !== undefined) {
          const username = foldUsername(input.username);
          const clash = await rowWhere(sql`${C.username} = ${username}`);
          if (clash !== undefined && required(clash, 'subject') !== input.subject) {
            throw new LocalUserExistsError('username');
          }
          await connection.run(
            sql`update ${U} set ${C.username} = ${username} where ${C.subject} = ${input.subject}`,
          );
        }
        if (input.displayName !== undefined) {
          await connection.run(
            sql`update ${U} set ${C.displayName} = ${input.displayName} where ${C.subject} = ${input.subject}`,
          );
        }
        if (input.email !== undefined) {
          await connection.run(
            sql`update ${U} set ${C.email} = ${input.email} where ${C.subject} = ${input.subject}`,
          );
        }
        await touch(input.subject, now);
        return readBySubject(input.subject);
      });
    },

    async setPassword(input: SetLocalPasswordInput): Promise<LocalUserRecord> {
      const now = input.now ?? new Date().toISOString();
      return connection.transaction(async () => {
        await requireRow(input.subject);
        // A password reset clears the lockout: the credential that was being
        // guessed no longer exists, so continuing to punish the account would
        // only deny the person their own recovery.
        await connection.run(
          sql`update ${U} set ${C.passwordHash} = ${input.passwordHash}, ${C.passwordAlgorithm} = ${input.passwordAlgorithm}, ${C.passwordUpdatedAt} = ${now}, ${C.failedAttempts} = ${0}, ${C.lockedUntil} = ${null}, ${C.updatedAt} = ${now} where ${C.subject} = ${input.subject}`,
        );
        return readBySubject(input.subject);
      });
    },

    async setTotp(input: SetLocalTotpInput): Promise<LocalUserRecord> {
      const now = input.now ?? new Date().toISOString();
      return connection.transaction(async () => {
        await requireRow(input.subject);
        // The replay counter moves with the secret, never independently: a
        // counter carried across a re-enrolment would refuse valid codes from
        // the new secret, and a counter cleared under an unchanged secret would
        // re-open the replay window this column exists to close.
        //
        // It is SEEDED rather than merely cleared when the caller supplies one,
        // which is the enrolment-confirmation case: the code a person typed to
        // prove the secret is a code that has been used, and leaving the guard
        // null would let that same code buy their first sign-in as well.
        await connection.run(
          sql`update ${U} set ${C.totpSecret} = ${input.secret}, ${C.totpConfirmedAt} = ${input.confirmedAt ?? null}, ${C.totpLastCounter} = ${input.lastCounter ?? null}, ${C.updatedAt} = ${now} where ${C.subject} = ${input.subject}`,
        );
        return readBySubject(input.subject);
      });
    },

    async setActive(subject: string, active: boolean, nowIso?: string): Promise<LocalUserRecord> {
      const now = nowIso ?? new Date().toISOString();
      return connection.transaction(async () => {
        await requireRow(subject);
        await connection.run(
          sql`update ${U} set ${C.active} = ${bindable(active)}, ${C.updatedAt} = ${now} where ${C.subject} = ${subject}`,
        );
        return readBySubject(subject);
      });
    },

    async addGroups(
      subject: string,
      groups: readonly string[],
      nowIso?: string,
    ): Promise<LocalUserRecord> {
      const now = nowIso ?? new Date().toISOString();
      return connection.transaction(async () => {
        const row = await requireRow(subject);
        await insertGroups(required(row, 'id'), groups, now);
        await touch(subject, now);
        return readBySubject(subject);
      });
    },

    async removeGroups(subject: string, groups: readonly string[]): Promise<LocalUserRecord> {
      const now = new Date().toISOString();
      return connection.transaction(async () => {
        const row = await requireRow(subject);
        const userId = required(row, 'id');
        for (const group of groups) {
          await connection.run(
            sql`delete from ${G} where ${GC.userId} = ${userId} and ${GC.groupName} = ${group}`,
          );
        }
        await touch(subject, now);
        return readBySubject(subject);
      });
    },

    async setGroups(
      subject: string,
      groups: readonly string[],
      nowIso?: string,
    ): Promise<LocalUserRecord> {
      const now = nowIso ?? new Date().toISOString();
      return connection.transaction(async () => {
        const row = await requireRow(subject);
        const userId = required(row, 'id');
        await connection.run(sql`delete from ${G} where ${GC.userId} = ${userId}`);
        await insertGroups(userId, groups, now);
        await touch(subject, now);
        return readBySubject(subject);
      });
    },

    async recordAuthAttempt(input: RecordLocalAuthInput): Promise<LocalUserRecord> {
      const now = input.now ?? new Date().toISOString();
      return connection.transaction(async () => {
        const row = await requireRow(input.subject);
        if (input.outcome === 'success') {
          const previous = integer(row['totp_last_counter']);
          const counter =
            input.totpCounter === undefined || input.totpCounter === null
              ? previous
              : // Monotonic, guarded here as well as by the caller: a counter
                // that could move backwards would re-open the replay window.
                Math.max(previous ?? -1, input.totpCounter);
          await connection.run(
            sql`update ${U} set ${C.failedAttempts} = ${0}, ${C.lockedUntil} = ${null}, ${C.lastAuthenticatedAt} = ${now}, ${C.totpLastCounter} = ${counter}, ${C.updatedAt} = ${now} where ${C.subject} = ${input.subject}`,
          );
        } else {
          const attempts = (integer(row['failed_attempts']) ?? 0) + 1;
          const lockedUntil =
            attempts >= input.lockoutThreshold ? (input.lockedUntil ?? null) : null;
          await connection.run(
            sql`update ${U} set ${C.failedAttempts} = ${attempts}, ${C.lockedUntil} = ${lockedUntil}, ${C.updatedAt} = ${now} where ${C.subject} = ${input.subject}`,
          );
        }
        return readBySubject(input.subject);
      });
    },
  };
}
