// MCPForge — `forge identity bootstrap-admin`. W0-P28.
//
// Owner decision, 30 Sep 2026: the FIRST identity admin of a deployment comes
// from this one-time command, run on the host that holds the runtime store.
// Every later account is made in the portal by an admin (`/api/v1/admin/users`).
//
// It refuses, with a `next`, whenever it is not the first admin:
//
//  - when `CI=true`: a pipeline never mints a human's account;
//  - when the deployment's git mapping lists no `identityAdmins:` group, since
//    the account would administer nothing;
//  - once ANY active account holds an identity-admin group. After that the
//    route in is the portal, and a second bootstrap would be a way around it.
//
// The password is read from a no-echo prompt, or from stdin when stdin is not
// a terminal. It is never an argument (argv is visible to every process on
// the host and lands in shell history), never printed, and never audited.
// The account is recorded as one hash-chained `identity` audit row.

import path from 'node:path';
import {
  openRuntimeStore,
  storeConfigFromEnv,
  type RuntimeStore,
} from '@mcpforge/gateway/store/server';
import { localUserStore } from '@mcpforge/gateway/identity';
import {
  identityAdminGroups,
  loadDeploymentGroupRoleMapping,
} from '@mcpforge/gateway/identity/group-role-mapping';
import { findDefinitionsRoot } from '@mcpforge/ci';
import { readHiddenLine } from '../lib/hidden-input.js';

export const BOOTSTRAP_TOOL_ID = 'forge.identity.bootstrap_admin';
const USAGE_EXIT_CODE = 64;
const MIN_PASSWORD_LENGTH = 12;

export interface BootstrapAdminOptions {
  readonly json: boolean;
  readonly username?: string;
  readonly displayName?: string;
  readonly email?: string;
  readonly group?: string;
  readonly deployment?: string;
  readonly root?: string;
}

export interface BootstrapAdminDeps {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly openStore?: () => Promise<RuntimeStore>;
  /** Reads the password without echo. Default: a TTY prompt, or stdin. */
  readonly readPassword?: () => Promise<string>;
}

interface CliError {
  readonly ok: false;
  readonly code: 'INPUT_INVALID' | 'POLICY_GUARDRAIL_BREACH';
  readonly message: string;
  readonly next: string;
}

export async function runBootstrapAdminCommand(
  opts: BootstrapAdminOptions,
  deps: BootstrapAdminDeps = {},
): Promise<number> {
  const env = deps.env ?? process.env;
  const json = opts.json;

  if (env['CI'] === 'true') {
    return emit(
      refused(
        "forge identity bootstrap-admin is refused when CI=true: a pipeline never creates a person's account.",
        'Run it once, by hand, on the host that holds the runtime store, with CI unset.',
      ),
      json,
    );
  }

  const username = opts.username?.trim();
  const displayName = opts.displayName?.trim();
  if (!username || !displayName) {
    return emit(usage('--username and --display-name are both required.'), json);
  }

  const deployment = opts.deployment?.trim() || env['MCPFORGE_DEPLOYMENT'] || 'local';
  // W0-P33a: the mapping is a definition.
  const root = opts.root ?? findDefinitionsRoot(env);
  let admins: readonly string[];
  try {
    admins = identityAdminGroups(
      loadDeploymentGroupRoleMapping(path.join(root, 'overlays'), deployment),
    );
  } catch (error) {
    return emit(
      usage(
        `The group mapping for deployment "${deployment}" cannot be read: ${(error as Error).message}`,
      ),
      json,
    );
  }
  if (admins.length === 0) {
    return emit(
      refused(
        `overlays/${deployment}/mappings/ lists no identityAdmins group, so an admin account would administer nothing.`,
        `Add "identityAdmins: [<group>]" to overlays/${deployment}/mappings/groups-to-roles.yaml through a reviewed change, then run this again.`,
      ),
      json,
    );
  }
  const group = opts.group?.trim() || admins[0]!;
  if (!admins.includes(group)) {
    return emit(
      usage(
        `--group "${group}" is not an identityAdmins group. It must be one of: ${admins.join(', ')}.`,
      ),
      json,
    );
  }

  const store = await (deps.openStore ?? (() => openRuntimeStore(storeConfigFromEnv())))();
  try {
    const users = localUserStore({ store });
    const existing = (await users.listUsers({ includeInactive: false })).filter((u) =>
      u.groups.some((g) => admins.includes(g)),
    );
    if (existing.length > 0) {
      return emit(
        refused(
          `An active identity admin already exists (${existing.map((u) => u.username).join(', ')}), so there is nothing to bootstrap.`,
          'Sign in to the portal as that admin and create the account under Governance, Users. If every admin has lost access, re-enable one there from another admin, or restore the store from backup.',
        ),
        json,
      );
    }

    const password = await (deps.readPassword ?? (() => readHiddenLine({ label: 'Password' })))();
    if (password.length < MIN_PASSWORD_LENGTH) {
      return emit(
        usage(
          `The password must be at least ${MIN_PASSWORD_LENGTH} characters; the one given is shorter.`,
        ),
        json,
      );
    }

    const { user, auditCallId } = await store.transaction(async () => {
      const created = await users.createUser({
        username,
        displayName,
        ...(opts.email?.trim() ? { email: opts.email.trim() } : {}),
        password,
        groups: [group],
      });
      const row = await store.audit.append({
        callerSubject: created.subject,
        ...(created.displayName ? { callerDisplay: created.displayName } : {}),
        humanInTheLoop: true,
        // No registered consumer holds this call: it is the one-time operator
        // act on the store itself, named so a query can tell it apart.
        consumerId: 'forge-cli',
        toolId: BOOTSTRAP_TOOL_ID,
        isWrite: false,
        deploymentId: deployment,
        phase: 'identity',
        outcome: 'ok',
        argsRedacted: { action: 'create', username: created.username, groups: [group] },
        resultKeys: [{ keyName: 'subject', keyValue: created.subject }],
      });
      return { user: created, auditCallId: row.id };
    });

    const report = {
      ok: true as const,
      subject: user.subject,
      username: user.username,
      group,
      deployment,
      auditCallId,
      next: 'Sign in to the portal with this username and password, then create every other account under Governance, Users. This command now refuses.',
    };
    if (json) process.stdout.write(`${JSON.stringify(report)}\n`);
    else
      process.stdout.write(
        `forge identity bootstrap-admin: created ${report.username} (${report.subject}) in ${group}.\n  audit: ${auditCallId}\n  next: ${report.next}\n`,
      );
    return 0;
  } catch (error) {
    // The store's own refusals (username taken…) carry a message and a next.
    const e = error as { toJSON?: () => { message: string; next: string } };
    if (typeof e.toJSON === 'function') {
      const shape = e.toJSON();
      return emit(
        { ok: false, code: 'INPUT_INVALID', message: shape.message, next: shape.next },
        json,
      );
    }
    throw error;
  } finally {
    await store.close();
  }
}

function usage(message: string): CliError {
  return {
    ok: false,
    code: 'INPUT_INVALID',
    message,
    next: 'Run "forge identity bootstrap-admin --username <name> --display-name <name> [--email <address>] [--group <identityAdmins group>]" and type the password at the prompt, or pipe it on stdin. Never pass it as an argument.',
  };
}

function refused(message: string, next: string): CliError {
  return { ok: false, code: 'POLICY_GUARDRAIL_BREACH', message, next };
}

function emit(error: CliError, json: boolean): number {
  if (json) process.stdout.write(`${JSON.stringify(error)}\n`);
  else {
    process.stderr.write(`forge: identity bootstrap-admin — ${error.message}\n`);
    process.stderr.write(`forge: next — ${error.next}\n`);
  }
  return error.code === 'INPUT_INVALID' ? USAGE_EXIT_CODE : 1;
}
