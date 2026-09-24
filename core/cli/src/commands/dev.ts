// MCPForge — `forge dev`. W0-N11, 02 §11.2 (local bootstrap self-registration).
//
//   forge dev [--env <local|probe|staging|prod>] [--json] [--root <dir>]
//
// 02 §11.2, verbatim and load-bearing:
//
//   "`forge dev` self-registers a `portal-local` consumer on first boot **in
//    environment class `local` only**, because the portal is itself a consumer
//    of the gateway API and a fresh clone would otherwise deadlock."
//
// THIS FILE IS THE ONE DOCUMENTED EXCEPTION TO "consumers/ is written only by
// the change-proposal flow", AND IT IS AN EXCEPTION THE ARCHITECTURE MAKES
// EXPLICITLY — not a convenience this task invented. Everything about how it
// is bounded follows from the failure mode it guards against, which is 04
// §1.1 Test 2 exactly: **a silent self-registration in production**. So:
//
//  1. It self-registers ONE id, `portal-local`, and nothing else. There is no
//     `--id`. A general self-registration verb is Dynamic Client Registration
//     with a nicer name, and 02 §11.2 makes DCR structurally absent.
//  2. The gate is an ALLOW-LIST OF EXACTLY ONE VALUE. The bootstrap proceeds
//     only when the resolved environment class is the literal string `local`
//     and `CI` is not `true`. Every other value — `probe`, `staging`, `prod`,
//     a typo, an empty string, a mixed-case `Local` — refuses. There is no
//     branch that reaches the write on an unrecognised value; see
//     `resolveEnvironmentClass` and `refuseBootstrap` below, which are the two
//     functions to read line by line.
//  3. What it writes is an ORDINARY `consumers/<id>.consumer.yaml` — the same
//     schema, the same path, the same `forge validate` rules, the same
//     `loadConsumerRegistry` read path as a human-registered consumer. It is
//     not a hidden built-in, not an in-memory fake and not a special case in
//     the gateway. A grant you cannot see in the working tree is a grant
//     nobody reviews.
//  4. It carries a VISIBLE SHORT EXPIRY — `BOOTSTRAP_REGISTRATION_DAYS`, one
//     day, against the 365-day `DEFAULT_REGISTRATION_DAYS` a reviewed
//     registration gets. See the constant's own note for the reasoning.
//  5. It grants NOTHING. `scaffoldConsumerRecord` starts every authorization
//     empty and every ceiling at its narrowest, and this file widens none of
//     them. `portal-local` is registered — which is what unblocks session
//     establishment — and authorized for no binding type, no role, no package
//     and no write. Widening it is a reviewed diff like any other grant.
//
// CLAUDE.md #6 is not weakened by any of this: registering the portal as a
// consumer resolves no human identity and stands in for none. A call still
// needs BOTH, and the intersection is still an intersection.
//
// WHAT THIS COMMAND DOES NOT DO YET: actually run the gateway and portal
// processes (02 §10.3). W0-N11's `touches:` is this file and its `done:` is
// the bootstrap; the process supervisor is not this task and is not stubbed
// here. The command says so on stdout rather than pretending.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@mcpforge/ci';
import {
  LocalVerifierFile,
  addDays,
  consumerCredentialRef,
  consumerRecordPath,
  isoToday,
  issueConsumerCredential,
  renderConsumerRecord,
  scaffoldConsumerRecord,
  type ConsumerRecord,
  type EnvironmentClass,
} from '@mcpforge/gateway/consumer';

const REFUSED_EXIT_CODE = 64;
const USAGE_EXIT_CODE = 64;

/** 02 §7.1's four classes, as an exhaustive allow-list. Nothing else parses. */
const ENVIRONMENT_CLASSES: readonly EnvironmentClass[] = ['local', 'probe', 'staging', 'prod'];

/**
 * The ONE environment class in which the bootstrap may run. Written as its own
 * constant, and compared with `===` against a value already narrowed by
 * `ENVIRONMENT_CLASSES`, so the gate is an allow-list rather than a
 * deny-list of `staging`/`prod`. A deny-list is how a fifth environment class
 * added in Wave 1 would silently become a self-registering one.
 */
const BOOTSTRAP_ENVIRONMENT: EnvironmentClass = 'local';

/** The one id this command may ever register. There is no `--id`. */
export const PORTAL_LOCAL_CONSUMER_ID = 'portal-local';

/**
 * ONE DAY, against `DEFAULT_REGISTRATION_DAYS`'s 365.
 *
 * The reasoning, stated because the number is a judgment call:
 *
 *  - `expiresAt` is an ISO **date** in the record schema, so sub-day expiry is
 *    not expressible. One day is therefore the shortest visible expiry the
 *    artefact can carry, and shortest is what this record wants to be.
 *  - `effectiveStatus` reduces `active` + a past `expiresAt` to `expired`,
 *    fail-closed, on every registry load. So a `portal-local` record left in
 *    an abandoned checkout, copied into an overlay, or pushed somewhere it
 *    should not be is inert within a day, without anyone noticing it or
 *    revoking it. That is the property that makes an unreviewed grant
 *    tolerable, and it gets weaker every day you extend it.
 *  - The cost of the short window is zero for the developer it exists for:
 *    `forge dev` refreshes the expiry on every boot, and running `forge dev`
 *    is the precondition for wanting the record at all.
 *  - It is deliberately NOT the 90-day credential rotation interval and not
 *    the 365-day registration default. Reusing either would make the one
 *    unreviewed registration in the system look, in a diff, exactly like a
 *    reviewed one — and the whole point is that it should not.
 */
export const BOOTSTRAP_REGISTRATION_DAYS = 1;

/**
 * The marker line the bootstrap stamps into the file it writes, and the only
 * thing that gives it permission to overwrite an existing `portal-local`
 * record. A record without this line was put there by a human through the
 * change-proposal flow, and this command will not clobber a reviewed grant.
 */
export const BOOTSTRAP_MARKER = '# mcpforge:bootstrap forge-dev';

export type DevRefusalReason = 'ci' | 'environment-class';

export interface DevCliError {
  readonly ok: false;
  readonly code: 'INPUT_INVALID' | 'DEV_BOOTSTRAP_REFUSED' | 'REGISTRY_CONFLICT';
  readonly message: string;
  readonly next: string;
  readonly reason?: DevRefusalReason;
}

export interface DevCommandOptions {
  readonly json: boolean;
  readonly env?: string;
  readonly root?: string;
}

export interface DevCommandDeps {
  readonly repoRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly today?: string;
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
}

function isError(v: unknown): v is DevCliError {
  return typeof v === 'object' && v !== null && (v as { ok?: unknown }).ok === false;
}

function emitError(error: DevCliError, json: boolean, deps: DevCommandDeps): number {
  const out = deps.stdout ?? ((t: string) => process.stdout.write(t));
  const err = deps.stderr ?? ((t: string) => process.stderr.write(t));
  if (json) {
    out(`${JSON.stringify(error)}\n`);
  } else {
    err(`forge: dev — ${error.message}\n`);
    err(`forge: next — ${error.next}\n`);
  }
  return error.code === 'INPUT_INVALID' ? USAGE_EXIT_CODE : REFUSED_EXIT_CODE;
}

/**
 * Resolve the environment class, FAIL-CLOSED.
 *
 * Read this against the failure mode: the only value that may reach the
 * bootstrap is one that parses as one of 02 §7.1's four classes. The absent
 * case defaults to `local` — matching `forge probe`'s `DEFAULT_ENV` and
 * `forge consumer issue-credential`'s existing default, so there is one
 * convention rather than two — and every PRESENT-BUT-UNRECOGNISED case is an
 * error, never a default. A typo, an empty `--env=`, a mixed-case `Local`, a
 * `production`, a `LOCAL ` with a stray character: each returns
 * `INPUT_INVALID` and reaches no write. There is deliberately no
 * `?? 'local'` on the parse result and no `catch` that widens back to a
 * default; the only `local` this function can return is one that was either
 * absent or spelled exactly.
 */
export function resolveEnvironmentClass(
  optsEnv: string | undefined,
  env: NodeJS.ProcessEnv,
): EnvironmentClass | DevCliError {
  const raw = optsEnv ?? env['MCPFORGE_ENV'];
  if (raw === undefined) return BOOTSTRAP_ENVIRONMENT;
  // No `.trim() || default` here, on purpose: `--env "  "` is a stated
  // intention that failed to state anything, and treating it as `local` is
  // exactly the "malformed value falls through to the permissive branch" bug
  // this gate exists to not have.
  const candidate = raw.trim();
  const matched = ENVIRONMENT_CLASSES.find((c) => c === candidate);
  if (matched === undefined) {
    return {
      ok: false,
      code: 'INPUT_INVALID',
      message: `Environment class ${JSON.stringify(raw)} is not one of local | probe | staging | prod.`,
      next: 'Re-run with --env <local|probe|staging|prod> (or set MCPFORGE_ENV to one of them). 02 §7.1 names these four and no others; an unrecognised value is refused rather than assumed to be local, because the assumption would be a self-registration in whatever environment this actually is.',
    };
  }
  return matched;
}

/**
 * The gate. Both refusals are checked BEFORE the repository is read and before
 * anything is written or minted — a refused bootstrap must never have created
 * a registration or a credential in the first place, exactly as
 * `refuseIssuance` refuses before minting.
 *
 * The CI check reuses `process.env.CI === 'true'` verbatim, the same detection
 * as `refuseIssuance` (W0-N1) and `forge codegen --accept-contract` (W0-B5).
 */
export function refuseBootstrap(
  environmentClass: EnvironmentClass,
  env: NodeJS.ProcessEnv,
): DevCliError | undefined {
  if (env['CI'] === 'true') {
    return {
      ok: false,
      code: 'DEV_BOOTSTRAP_REFUSED',
      reason: 'ci',
      message: 'forge dev self-registration is refused when CI=true.',
      next: 'Register the consumer the reviewed way: "forge consumer new <id> --class portal --owner <team> --steward <person> --human-in-the-loop true --by <subject>" stages a change proposal a named approver completes. A CI job that registers its own consumer is the one grant nobody reviewed (02 §11.2).',
    };
  }
  if (environmentClass !== BOOTSTRAP_ENVIRONMENT) {
    return {
      ok: false,
      code: 'DEV_BOOTSTRAP_REFUSED',
      reason: 'environment-class',
      message: `forge dev self-registration is refused when the environment class is "${environmentClass}". It runs in "local" only.`,
      next: 'Register the portal through the portal registration flow, which produces the approval record, or stage it with "forge consumer new". 02 §11.2 confines self-registration to environment class local because the portal is a consumer and a fresh clone would otherwise deadlock — which is a clean-clone problem, not a staging or production one.',
    };
  }
  return undefined;
}

/** The bootstrap record: an ordinary Consumer record that grants nothing. */
export function buildBootstrapRecord(today: string): ConsumerRecord {
  const record = scaffoldConsumerRecord({
    id: PORTAL_LOCAL_CONSUMER_ID,
    consumerClass: 'portal',
    label: 'MCPForge portal (local development)',
    owner: 'Local development checkout',
    steward: 'The developer running forge dev on this machine',
    // The portal is operated by the person sitting in front of it. Declaring
    // `false` here would force `humanApprovalRequired: true` on every write —
    // which is the right answer for a headless agent and the wrong one for a
    // browser a human is looking at (02 §11.2).
    humanInTheLoop: true,
    expiresAt: addDays(today, BOOTSTRAP_REGISTRATION_DAYS),
    today,
  });
  return {
    ...record,
    credential: {
      ...record.credential,
      // `client-secret` rather than the scaffold's `private-key-jwt`: a
      // private-key-jwt registration is incomplete until a public key is
      // committed into it (05 §A.5), and `loadConsumerRegistry` reports such a
      // record as a LOAD FAILURE rather than a live registration. A bootstrap
      // that writes a record the gateway then refuses to load has not broken
      // the deadlock it exists to break. The value is still a secretRef and
      // still lives only in the local verifier store (CLAUDE.md #8).
      method: 'client-secret',
    },
  };
}

/** The file text, marker first so the marker is visible in any diff or `cat`. */
export function renderBootstrapRecord(record: ConsumerRecord): string {
  return [
    BOOTSTRAP_MARKER,
    '# Self-registered by `forge dev` in environment class local (02 §11.2). This is the',
    '# ONE registration in this repository that no human approved, which is why it expires',
    `# in ${BOOTSTRAP_REGISTRATION_DAYS} day(s), grants no binding type, no role, no package and no write, and is`,
    '# refused outright under probe, staging, prod and CI=true. `forge dev` rewrites this',
    '# file on each boot; delete it and it is gone. Remove this marker line and `forge dev`',
    '# will never overwrite the file again — that is how you turn it into a reviewed grant.',
    '',
    renderConsumerRecord(record),
  ].join('\n');
}

export interface DevBootstrapResult {
  readonly ok: true;
  readonly environmentClass: EnvironmentClass;
  readonly consumerId: string;
  readonly file: string;
  readonly expiresAt: string;
  readonly expiresInDays: number;
  readonly created: boolean;
  readonly secretRef: string;
  /** Present only on the one boot that minted it. Printed once, stored never. */
  readonly credentialValue?: string;
  readonly serversStarted: false;
}

export function runDevCommand(opts: DevCommandOptions, deps: DevCommandDeps = {}): number {
  const out = deps.stdout ?? ((t: string) => process.stdout.write(t));
  const env = deps.env ?? process.env;

  const environmentClass = resolveEnvironmentClass(opts.env, env);
  if (isError(environmentClass)) return emitError(environmentClass, opts.json, deps);

  const refusal = refuseBootstrap(environmentClass, env);
  if (refusal) return emitError(refusal, opts.json, deps);

  // Past this line the environment class is the literal 'local' and CI is not
  // 'true'. Nothing below re-derives either fact.
  const repoRoot = deps.repoRoot ?? opts.root ?? findRepoRoot();
  const today = deps.today ?? isoToday();
  const relPath = consumerRecordPath(PORTAL_LOCAL_CONSUMER_ID);
  const absPath = join(repoRoot, ...relPath.split('/'));

  const existed = existsSync(absPath);
  if (existed) {
    const current = readFileSync(absPath, 'utf8');
    if (!current.includes(BOOTSTRAP_MARKER)) {
      return emitError(
        {
          ok: false,
          code: 'REGISTRY_CONFLICT',
          message: `${relPath} exists and is not a forge dev bootstrap record.`,
          next: `Leave it alone: a consumer record without the "${BOOTSTRAP_MARKER}" marker is a reviewed grant, and this command will not overwrite one. If you want the short-lived bootstrap record instead, delete ${relPath} deliberately and re-run "forge dev".`,
        },
        opts.json,
        deps,
      );
    }
  }

  const record = buildBootstrapRecord(today);
  mkdirSync(join(repoRoot, 'consumers'), { recursive: true });
  writeFileSync(absPath, renderBootstrapRecord(record), 'utf8');

  // Mint the client secret only on the boot that has none: the portal needs a
  // value to present, and re-minting on every boot would invalidate a working
  // one daily for no gain. `issueConsumerCredential` re-checks CI and the
  // environment class itself before generating anything.
  const secretRef = consumerCredentialRef(PORTAL_LOCAL_CONSUMER_ID);
  const store = new LocalVerifierFile(repoRoot);
  let credentialValue: string | undefined;
  if (store.find(secretRef) === undefined) {
    credentialValue = issueConsumerCredential({
      consumerId: PORTAL_LOCAL_CONSUMER_ID,
      environmentClass,
      issuedBy: 'forge dev (local bootstrap)',
      store,
      env,
      today,
    }).value;
  }

  const result: DevBootstrapResult = {
    ok: true,
    environmentClass,
    consumerId: PORTAL_LOCAL_CONSUMER_ID,
    file: relPath,
    expiresAt: record.expiresAt,
    expiresInDays: BOOTSTRAP_REGISTRATION_DAYS,
    created: !existed,
    secretRef,
    ...(credentialValue === undefined ? {} : { credentialValue }),
    serversStarted: false,
  };

  if (opts.json) {
    out(`${JSON.stringify(result)}\n`);
  } else {
    out(
      `forge: dev — ${existed ? 'refreshed' : 'self-registered'} consumer "${PORTAL_LOCAL_CONSUMER_ID}" at ${relPath}\n`,
    );
    out(
      `forge: dev — environment class local; expires ${record.expiresAt} (${BOOTSTRAP_REGISTRATION_DAYS} day). It grants no binding type, no role, no package and no write.\n`,
    );
    out(`forge: dev — credential reference ${secretRef}\n`);
    if (credentialValue !== undefined) {
      // THE ONE PRINT, on the same discipline as `forge consumer
      // issue-credential`: the value exists here and in no record, no
      // proposal, no log line and no later call (CLAUDE.md #8).
      out(`forge: dev — client secret (shown once, not recoverable):\n${credentialValue}\n`);
    }
    out(
      'forge: dev — the gateway and portal processes are not started by this command yet (02 §10.3); W0-N11 covers the bootstrap registration only.\n',
    );
  }
  return 0;
}
