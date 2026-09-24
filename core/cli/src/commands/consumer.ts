// MCPForge — `forge consumer`. W0-N1, 02 §11.2 / 05 §1.3.
//
//   forge consumer new <id> --class <c> --owner <team> --steward <person>
//                           --human-in-the-loop <true|false> --by <subject> [--label] [--expires]
//   forge consumer list [--json]
//   forge consumer show <id> [--json]
//   forge consumer suspend <id> --reason "..." --by <subject>
//   forge consumer rotate  <id> --by <subject>
//   forge consumer retire  <id> --reason "..." --by <subject>
//   forge consumer issue-credential <id> --by <subject> [--env <class>]
//
// Two things this command will not do, both structural rather than
// conventional:
//
//  1. It never writes to `consumers/**` or `approvals/**`. `new`, `suspend`,
//     `rotate` and `retire` STAGE a change proposal under
//     `.mcpforge/proposals/<id>/` and print where it is; a human proposes it
//     for review and a named approver completes the approval record. A
//     registration is a grant, and a grant that a process can apply to itself
//     is the one grant nobody reviewed (02 §11.2).
//  2. It never defaults an acting identity. `--by <subject>` is required on
//     every mutating verb, exactly as `forge kill --by` is, because a bare
//     CLI invocation carries no authenticated session (CLAUDE.md #1).
//
// The credential value printed by `issue-credential` is printed once, on
// stdout, and appears in no other output this file can produce — not in the
// --json envelope, not in the human report, not in the proposal (CLAUDE.md #8).

import { findRepoRoot } from '@mcpforge/ci';
import {
  DirectWriteRefusedError,
  LocalVerifierFile,
  effectiveStatus,
  findConsumer,
  isoToday,
  issueConsumerCredential,
  loadConsumerRegistry,
  proposeCredentialRotation,
  proposeRegistration,
  proposeRetirement,
  proposeSuspension,
  refuseIssuance,
  scaffoldConsumerRecord,
  writeChangeProposal,
  CONSUMER_CLASSES,
  type ChangeProposal,
  type ConsumerClass,
  type EnvironmentClass,
  type LoadedConsumer,
} from '@mcpforge/gateway/consumer';

const USAGE_EXIT_CODE = 64;
const REFUSED_EXIT_CODE = 64;
const NOT_FOUND_EXIT_CODE = 1;

const ENVIRONMENT_CLASSES: readonly EnvironmentClass[] = ['local', 'probe', 'staging', 'prod'];

export interface ConsumerCliError {
  readonly ok: false;
  readonly code:
    | 'INPUT_INVALID'
    | 'CONSUMER_UNREGISTERED'
    | 'CONSUMER_NOT_ACTIVE'
    | 'ISSUE_CREDENTIAL_REFUSED'
    | 'REGISTRY_INVALID';
  readonly message: string;
  readonly next: string;
}

export interface ConsumerCommandOptions {
  readonly json: boolean;
  readonly target?: string;
  readonly class?: string;
  readonly label?: string;
  readonly owner?: string;
  readonly steward?: string;
  readonly humanInTheLoop?: string;
  readonly expires?: string;
  readonly reason?: string;
  readonly by?: string;
  readonly env?: string;
  readonly root?: string;
}

export interface ConsumerCommandDeps {
  readonly repoRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly today?: string;
  readonly now?: string;
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
}

function emitError(error: ConsumerCliError, json: boolean, deps: ConsumerCommandDeps): number {
  const out = deps.stdout ?? ((t: string) => process.stdout.write(t));
  const err = deps.stderr ?? ((t: string) => process.stderr.write(t));
  if (json) {
    out(`${JSON.stringify(error)}\n`);
  } else {
    err(`forge: consumer — ${error.message}\n`);
    err(`forge: next — ${error.next}\n`);
  }
  return error.code === 'INPUT_INVALID' || error.code === 'ISSUE_CREDENTIAL_REFUSED'
    ? error.code === 'INPUT_INVALID'
      ? USAGE_EXIT_CODE
      : REFUSED_EXIT_CODE
    : NOT_FOUND_EXIT_CODE;
}

function usage(message: string, next: string): ConsumerCliError {
  return { ok: false, code: 'INPUT_INVALID', message, next };
}

function requireBy(opts: ConsumerCommandOptions): string | ConsumerCliError {
  const by = opts.by?.trim();
  if (by) return by;
  return usage(
    '--by <subject> is required.',
    'Re-run with --by <Principal.subject> naming who is asking. There is no default acting identity for a bare CLI invocation (CLAUDE.md non-negotiable 1).',
  );
}

function isError(v: unknown): v is ConsumerCliError {
  return typeof v === 'object' && v !== null && (v as { ok?: unknown }).ok === false;
}

function resolveRoot(opts: ConsumerCommandOptions, deps: ConsumerCommandDeps): string {
  return deps.repoRoot ?? opts.root ?? findRepoRoot();
}

// --- list / show -------------------------------------------------------------

function publicView(loaded: LoadedConsumer): Record<string, unknown> {
  const r = loaded.record;
  return {
    id: r.id,
    label: r.label,
    class: r.class,
    owner: r.owner,
    steward: r.steward,
    status: r.status,
    effectiveStatus: loaded.effectiveStatus,
    expiresAt: r.expiresAt,
    file: loaded.file,
    recordSha: loaded.recordSha,
    // A REFERENCE, never a value — the only credential fact this CLI prints.
    credential: {
      method: r.credential.method,
      ref: r.credential.ref,
      boundIssuers: r.credential.boundIssuers,
      rotation: r.credential.rotation,
    },
    authorizations: r.authorizations,
    limits: r.limits,
    attestation: r.attestation,
    ...(r.bindingGrants === undefined ? {} : { bindingGrants: r.bindingGrants }),
  };
}

function runList(opts: ConsumerCommandOptions, deps: ConsumerCommandDeps): number {
  const out = deps.stdout ?? ((t: string) => process.stdout.write(t));
  const registry = loadConsumerRegistry(resolveRoot(opts, deps), deps.today ?? isoToday());
  const consumers = registry.consumers.map(publicView);
  if (opts.json) {
    out(
      `${JSON.stringify({ ok: registry.failures.length === 0, consumers, failures: registry.failures })}\n`,
    );
  } else if (consumers.length === 0 && registry.failures.length === 0) {
    out(
      'forge consumer list: no consumers registered.\n' +
        '  Register one with "forge consumer new <id> --class <class> --owner <team> --steward <person> --human-in-the-loop <true|false> --by <subject>".\n',
    );
  } else {
    for (const c of registry.consumers) {
      out(
        `${c.record.id}  ${c.effectiveStatus.padEnd(9)} ${c.record.class.padEnd(19)} expires ${c.record.expiresAt}  ${c.record.label}\n`,
      );
    }
    for (const f of registry.failures) {
      out(`! ${f.file}: ${f.message}\n`);
    }
  }
  return registry.failures.length === 0 ? 0 : 1;
}

function unregistered(id: string): ConsumerCliError {
  return {
    ok: false,
    code: 'CONSUMER_UNREGISTERED',
    message: `No consumer is registered with id "${id}".`,
    next: `Run "forge consumer list" to see the registered consumers, or "forge consumer new ${id} --class <class> --owner <team> --steward <person> --human-in-the-loop <true|false> --by <subject>" to stage a registration for review. Dynamic Client Registration does not exist here (02 §11.2).`,
  };
}

function runShow(opts: ConsumerCommandOptions, deps: ConsumerCommandDeps): number {
  const out = deps.stdout ?? ((t: string) => process.stdout.write(t));
  const id = opts.target?.trim();
  if (!id) {
    return emitError(
      usage('A consumer id is required.', 'Run "forge consumer show <id>".'),
      opts.json,
      deps,
    );
  }
  const registry = loadConsumerRegistry(resolveRoot(opts, deps), deps.today ?? isoToday());
  const found = findConsumer(registry, id);
  if (!found) return emitError(unregistered(id), opts.json, deps);
  const view = publicView(found);
  if (opts.json) {
    out(`${JSON.stringify({ ok: true, consumer: view })}\n`);
  } else {
    out(`${JSON.stringify(view, null, 2)}\n`);
  }
  return 0;
}

// --- the four proposal-producing verbs ---------------------------------------

function emitProposal(
  proposal: ChangeProposal,
  repoRoot: string,
  opts: ConsumerCommandOptions,
  deps: ConsumerCommandDeps,
): number {
  const out = deps.stdout ?? ((t: string) => process.stdout.write(t));
  const written = writeChangeProposal(repoRoot, proposal);
  const payload = {
    ok: true as const,
    proposalId: written.proposalId,
    kind: proposal.kind,
    consumerId: proposal.consumerId,
    summary: proposal.summary,
    requestedBy: proposal.requestedBy,
    state: 'draft' as const,
    directory: written.directory,
    files: written.files.map((f) => ({ target: f.targetPath, staged: f.stagedPath })),
    next: `Review the staged files, apply them in a change proposal, and have the named approver complete ${written.files.find((f) => f.targetPath.startsWith('approvals/'))?.targetPath ?? 'the approval record'}. Nothing under consumers/ or approvals/ has been written: there is no direct-write path (02 §11.2).`,
  };
  if (opts.json) {
    out(`${JSON.stringify(payload)}\n`);
  } else {
    out(
      [
        `forge consumer ${proposal.kind.replace('consumer-', '')}: change proposal staged (nothing was written to consumers/ or approvals/).`,
        `  proposal: ${written.proposalId}`,
        `  summary:  ${proposal.summary}`,
        `  requested by: ${proposal.requestedBy}`,
        ...written.files.map(
          (f) => `  proposes: ${f.targetPath}\n            staged at ${f.stagedPath}`,
        ),
        `  next: ${payload.next}`,
        '',
      ].join('\n'),
    );
  }
  return 0;
}

function runNew(opts: ConsumerCommandOptions, deps: ConsumerCommandDeps): number {
  const id = opts.target?.trim();
  if (!id) {
    return emitError(
      usage(
        'A consumer id is required.',
        'Run "forge consumer new <id> --class <class> --owner <team> --steward <person> --human-in-the-loop <true|false> --by <subject>". The id is immutable: renaming later is a retire-and-register pair.',
      ),
      opts.json,
      deps,
    );
  }
  const by = requireBy(opts);
  if (isError(by)) return emitError(by, opts.json, deps);

  const consumerClass = opts.class?.trim();
  if (!consumerClass || !CONSUMER_CLASSES.includes(consumerClass as ConsumerClass)) {
    return emitError(
      usage(
        `--class ${JSON.stringify(opts.class ?? null)} is not a consumer class.`,
        `Run "forge consumer new ${id} --class <${CONSUMER_CLASSES.join('|')}>". 02 §11.2 names these four and no others.`,
      ),
      opts.json,
      deps,
    );
  }

  const owner = opts.owner?.trim();
  const steward = opts.steward?.trim();
  if (!owner || !steward) {
    return emitError(
      usage(
        '--owner <team> and --steward <person> are both required.',
        'Name the accountable team and the named human who stewards this consumer. 02 §11.2 requires a named human at review, and this command will not scaffold a placeholder in their place.',
      ),
      opts.json,
      deps,
    );
  }

  const hitl = opts.humanInTheLoop?.trim().toLowerCase();
  if (hitl !== 'true' && hitl !== 'false') {
    return emitError(
      usage(
        '--human-in-the-loop <true|false> is required and must be stated explicitly.',
        'Declaring false is not a formality: it forces humanApprovalRequired: true on every write this consumer attempts, so the plan is read by a named approver rather than by nobody (02 §11.2). A default here would be an assertion about a human that nobody made.',
      ),
      opts.json,
      deps,
    );
  }

  const repoRoot = resolveRoot(opts, deps);
  const today = deps.today ?? isoToday();
  const registry = loadConsumerRegistry(repoRoot, today);
  if (findConsumer(registry, id)) {
    return emitError(
      usage(
        `A consumer with id "${id}" is already registered.`,
        `Consumer ids are immutable. Change the existing registration with "forge consumer suspend|rotate|retire ${id}", or register a different id — never reuse one, because audit rows and consumption edges reference it (CLAUDE.md §5).`,
      ),
      opts.json,
      deps,
    );
  }

  const record = scaffoldConsumerRecord({
    id,
    consumerClass: consumerClass as ConsumerClass,
    label: opts.label?.trim() || id,
    owner,
    steward,
    humanInTheLoop: hitl === 'true',
    ...(opts.expires?.trim() ? { expiresAt: opts.expires.trim() } : {}),
    today,
  });

  const proposal = proposeRegistration(record, {
    requestedBy: by,
    today,
    ...(deps.now ? { now: deps.now } : {}),
    ...(opts.reason?.trim() ? { reason: opts.reason.trim() } : {}),
  });
  return emitProposal(proposal, repoRoot, opts, deps);
}

type LifecycleVerb = 'suspend' | 'retire' | 'rotate';

function runLifecycle(
  verb: LifecycleVerb,
  opts: ConsumerCommandOptions,
  deps: ConsumerCommandDeps,
): number {
  const id = opts.target?.trim();
  if (!id) {
    return emitError(
      usage('A consumer id is required.', `Run "forge consumer ${verb} <id> --by <subject>".`),
      opts.json,
      deps,
    );
  }
  const by = requireBy(opts);
  if (isError(by)) return emitError(by, opts.json, deps);

  const reason = opts.reason?.trim();
  if ((verb === 'suspend' || verb === 'retire') && !reason) {
    return emitError(
      usage(
        `--reason is required for "forge consumer ${verb}".`,
        'State why, in the words a reviewer and the audit record will read. A lifecycle change with no stated reason is unreviewable.',
      ),
      opts.json,
      deps,
    );
  }

  const repoRoot = resolveRoot(opts, deps);
  const today = deps.today ?? isoToday();
  const registry = loadConsumerRegistry(repoRoot, today);
  const found = findConsumer(registry, id);
  if (!found) return emitError(unregistered(id), opts.json, deps);

  const actor = {
    requestedBy: by,
    today,
    ...(deps.now ? { now: deps.now } : {}),
    ...(reason ? { reason } : {}),
  };
  const proposal =
    verb === 'suspend'
      ? proposeSuspension(found.record, actor)
      : verb === 'retire'
        ? proposeRetirement(found.record, actor)
        : proposeCredentialRotation(found.record, actor);
  return emitProposal(proposal, repoRoot, opts, deps);
}

// --- issue-credential --------------------------------------------------------

function runIssueCredential(opts: ConsumerCommandOptions, deps: ConsumerCommandDeps): number {
  const out = deps.stdout ?? ((t: string) => process.stdout.write(t));
  const id = opts.target?.trim();
  if (!id) {
    return emitError(
      usage(
        'A consumer id is required.',
        'Run "forge consumer issue-credential <id> --by <subject>".',
      ),
      opts.json,
      deps,
    );
  }
  const by = requireBy(opts);
  if (isError(by)) return emitError(by, opts.json, deps);

  const envRaw = (opts.env?.trim() || 'local') as EnvironmentClass;
  if (!ENVIRONMENT_CLASSES.includes(envRaw)) {
    return emitError(
      usage(
        `--env "${String(opts.env)}" is not an environment class.`,
        'Run with --env <local|probe|staging|prod>. 02 §7.1 names these four and no others.',
      ),
      opts.json,
      deps,
    );
  }

  // Checked BEFORE the registry is read and before any value is minted: a
  // refused issuance must never have generated a secret at all.
  const refusal = refuseIssuance(envRaw, deps.env ?? process.env);
  if (refusal) {
    return emitError(
      { ok: false, code: 'ISSUE_CREDENTIAL_REFUSED', message: refusal.message, next: refusal.next },
      opts.json,
      deps,
    );
  }

  const repoRoot = resolveRoot(opts, deps);
  const today = deps.today ?? isoToday();
  const registry = loadConsumerRegistry(repoRoot, today);
  const found = findConsumer(registry, id);
  if (!found) return emitError(unregistered(id), opts.json, deps);

  const status = effectiveStatus(found.record, today);
  if (status !== 'active') {
    return emitError(
      {
        ok: false,
        code: 'CONSUMER_NOT_ACTIVE',
        message: `Consumer "${id}" is ${status}; no credential is issued to it.`,
        next:
          status === 'expired'
            ? `The registration expired on ${found.record.expiresAt}. Renewal is a re-approval, not a no-op: stage the renewal as a change proposal and have the named approver record it, then re-run this command.`
            : `A ${status} registration is refused at session establishment, so a credential would be inert. Reactivating it is a change proposal reviewed like any other grant.`,
      },
      opts.json,
      deps,
    );
  }

  const issued = issueConsumerCredential({
    consumerId: id,
    environmentClass: envRaw,
    issuedBy: by,
    store: new LocalVerifierFile(repoRoot),
    ...(deps.env ? { env: deps.env } : {}),
    today,
  });

  // THE ONE PRINT. The value appears here and nowhere else: not in the
  // consumer record, not in a proposal, not in a log line (CLAUDE.md #8).
  if (opts.json) {
    out(
      `${JSON.stringify({
        ok: true,
        consumerId: id,
        secretRef: issued.secretRef,
        version: issued.version,
        issuedAt: issued.issuedAt,
        issuedBy: by,
        value: issued.value,
        printedOnce: true,
        next: `Store this value in the consumer's own client configuration now. It is not recoverable: only a salted verifier was persisted, and re-running this command mints a new value and supersedes this one. The record keeps ${issued.secretRef} — a reference, never a value.`,
      })}\n`,
    );
  } else {
    out(
      [
        `forge consumer issue-credential: ${id}`,
        `  secretRef: ${issued.secretRef}  (version ${issued.version})`,
        '',
        `  ${issued.value}`,
        '',
        '  Printed once. Not recoverable — only a salted verifier was persisted.',
        "  Store it in the consumer's client configuration now; re-running this command mints a new value.",
        '',
      ].join('\n'),
    );
  }
  return 0;
}

// --- entry point -------------------------------------------------------------

export function runConsumerCommand(
  verb: 'new' | 'list' | 'show' | 'suspend' | 'rotate' | 'retire' | 'issue-credential',
  opts: ConsumerCommandOptions,
  deps: ConsumerCommandDeps = {},
): number {
  try {
    switch (verb) {
      case 'list':
        return runList(opts, deps);
      case 'show':
        return runShow(opts, deps);
      case 'new':
        return runNew(opts, deps);
      case 'suspend':
      case 'retire':
      case 'rotate':
        return runLifecycle(verb, opts, deps);
      case 'issue-credential':
        return runIssueCredential(opts, deps);
    }
  } catch (err) {
    if (err instanceof DirectWriteRefusedError) {
      return emitError(
        usage(
          err.message,
          'A consumer-registry change is staged as a change proposal and applied by a reviewer. Report this as a bug if a legitimate change was refused.',
        ),
        opts.json,
        deps,
      );
    }
    throw err;
  }
}
