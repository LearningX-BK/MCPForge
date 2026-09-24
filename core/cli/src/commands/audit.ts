// MCPForge — `forge audit verify`. W0-C4.
//
// 02 §10.4 item 1, on why this command is not a nicety: on SQLite the audit
// trail is protected by **detection, not prevention** — there is no grant
// model to revoke `UPDATE`/`DELETE` from, so anyone with `.mcpforge/runtime.db`
// can drop the triggers and rewrite a row. This walk is what makes that
// visible, and it is therefore load-bearing at Wave 0: it runs in CI, on every
// probe run, and on portal load of the Activity → Integrity panel.
//
// The command formats; it does not verify. The recomputation happens inside
// `core/gateway/store/audit/verify.ts`, over the raw stored columns, using
// `auditRowHash` from `store/audit/hash.ts` — the ONE canonical form. A second
// re-derivation out here would be the drift that makes a genuine break look
// like a false alarm.

import {
  openRuntimeStore,
  storeConfigFromEnv,
  type AuditChainVerification,
  type RuntimeStore,
  type StoreDescriptor,
} from '@mcpforge/gateway/store/server';

export interface AuditVerifyReport {
  readonly ok: boolean;
  /** The data-class facts (03 §11.2): which store, where, and is it ephemeral. */
  readonly store: StoreDescriptor;
  /** One entry per deployment walked, in id order. */
  readonly deployments: readonly AuditChainVerification[];
  /**
   * 02 §10.3 — on SQLite an empty trail is the expected state of a fresh
   * checkout, not a finding. Carried in the report so every surface that
   * renders it says so with the same words.
   */
  readonly note: string | null;
}

const EPHEMERAL_NOTE =
  'This local instance stores audit records in SQLite; they start empty on a fresh checkout (02 §10.3).';

export interface AuditVerifyOptions {
  readonly json: boolean;
  /** Narrow the walk to one deployment. Default: every deployment in the store. */
  readonly deployment?: string;
}

export interface AuditVerifyDeps {
  /**
   * Injected by the tests so they walk an isolated store. Production opens the
   * real one from the environment — `MCPFORGE_STORE_FILE` / `MCPFORGE_STORE_KIND`,
   * defaulting to `./.mcpforge/runtime.db` (02 §10.2).
   */
  readonly openStore?: () => Promise<RuntimeStore>;
}

/** The verification itself, separated from the formatting and the exit code. */
export async function verifyAuditChains(
  store: RuntimeStore,
  deployment?: string,
): Promise<AuditVerifyReport> {
  const deploymentIds =
    deployment === undefined ? await store.audit.listDeployments() : [deployment];
  const deployments: AuditChainVerification[] = [];
  for (const id of deploymentIds) {
    deployments.push(await store.audit.verifyChain(id));
  }
  const anyRows = deployments.some((d) => d.rowsChecked > 0);
  return {
    ok: deployments.every((d) => d.firstBreak === null),
    store: store.descriptor,
    deployments,
    note: !anyRows && store.descriptor.ephemeral ? EPHEMERAL_NOTE : null,
  };
}

function describeOrigin(verification: AuditChainVerification): string {
  const origin = verification.origin;
  if (origin === null) {
    return '  origin: unresolved — see the break below.';
  }
  if (origin.kind === 'genesis') {
    return `  origin: genesis — the chain starts at ${origin.firstRowId} and nothing precedes it.`;
  }
  const a = origin.attestation;
  return [
    `  origin: retention boundary — the chain starts at ${origin.firstRowId}, which does NOT link to genesis.`,
    a === undefined
      ? '  (no attestation)'
      : `  ${a.deletedCount} earlier row(s) were removed by the retention sweep recorded in call ${a.callId} (gate ${a.gateId}, cutoff ${a.cutoffTs}) — reason: ${a.reason}.`,
  ].join('\n');
}

/** Human-readable rendering: the origin story, then the first break if there is one. */
export function formatAuditVerifyReportHuman(report: AuditVerifyReport): string {
  const blocks: string[] = [];
  const header = report.ok
    ? `forge audit verify: OK — ${report.deployments.length} deployment chain(s) walked, no break found.`
    : `forge audit verify: BROKEN — the audit hash chain does not verify. On SQLite the trail is tamper-EVIDENT, not tamper-proof (02 §10.4 item 1).`;
  blocks.push(`${header}\n  store: ${report.store.label} · ${report.store.location}`);

  if (report.deployments.length === 0) {
    blocks.push('  No audit rows in this store — no chain to walk.');
  }

  for (const verification of report.deployments) {
    const lines = [
      `deployment "${verification.deploymentId}": ${verification.status} — ${verification.rowsChecked} row(s) checked.`,
      describeOrigin(verification),
    ];
    const b = verification.firstBreak;
    if (b !== null) {
      lines.push(
        `  FIRST BREAK at row ${b.rowId} (chain position ${b.position}, ${b.reason})`,
        `    expected: ${b.expected}`,
        `    actual:   ${b.actual}`,
        `    ${b.message}`,
        `    next: ${b.next}`,
      );
    }
    blocks.push(lines.join('\n'));
  }

  if (report.note !== null) {
    blocks.push(`  note: ${report.note}`);
  }
  return blocks.join('\n\n');
}

/**
 * `forge audit verify [--deployment <id>] [--json]`.
 *
 * Exit 0 when every walked chain verifies, 1 when any of them does not — so
 * the CI gate is `forge audit verify` and nothing else. With no `--deployment`
 * it walks EVERY deployment in the store rather than assuming there is one:
 * the Wave 0 gateway is single-INSTANCE (`WAVE_0_SINGLE_INSTANCE`), which is
 * not the same claim as single-deployment, and a chain that is never walked is
 * a chain nobody is checking.
 */
export async function runAuditVerifyCommand(
  opts: AuditVerifyOptions,
  deps: AuditVerifyDeps = {},
): Promise<number> {
  const open = deps.openStore ?? (() => openRuntimeStore(storeConfigFromEnv()));
  const store = await open();
  try {
    const deployment = typeof opts.deployment === 'string' ? opts.deployment : undefined;
    const report = await verifyAuditChains(store, deployment);
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(report)}\n`);
    } else {
      process.stdout.write(`${formatAuditVerifyReportHuman(report)}\n`);
    }
    return report.ok ? 0 : 1;
  } finally {
    await store.close();
  }
}
