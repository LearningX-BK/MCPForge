'use server';
// MCPForge — W0-N12: the LIVE compile behind the Consumers tab's right pane.
//
// 03 §16.2: "edit on the left, **the compiled authorization artefact rendered
// explicitly on the right**, and nothing saves directly ... A consumer editor
// that hides what a consumer may actually reach is the same failure 02 §8.1
// item 4 names for the role editor, and it gets the same treatment."
//
// So this is not a preview, and it is deliberately the SAME mechanism W0-J18's
// `../../_lib/compile-role.ts` uses, not a parallel one:
//
//   runCodegen -> writes `generated/consumers/<id>.authorization.json` through
//                 `compileGovernanceArtefacts` / `compileConsumerAuthorization`
//                 (core/codegen/src/compile/**, W0-B8 + W0-N4). Every field the
//                 right pane shows — the five `authorizations` keys, the
//                 limits, the attestation, `effectiveStatus`, every
//                 `bindingGrant` with its `expired` verdict and its RESOLVED
//                 `standingAuthorization` (approver, own expiry, `effective`)
//                 — is READ OUT OF THAT ARTEFACT, and its bytes are the file
//                 the change proposal carries. One compiler, one artefact,
//                 one diff.
//
// WHY A SANDBOX, NOT THE LIVE REPO: identical to `compile-role.ts` and
// W0-J14's `build/_lib/checks.ts`, whose headers state it in full — the draft
// is not a file in the working tree (`ChangeHost.saveDraft` is what commits
// it), consumer compilation is cross-file (`standingAuthorization` resolves
// against every record under `approvals/`), and writing an unsaved
// registration into the real tree on every keystroke could corrupt a
// concurrent `forge codegen`. Never a subprocess: `forge` is called as a
// library.
//
// WHY `today` IS INJECTABLE, and what it does NOT do: it pins the PRESENTATION
// threshold only — 03 §16.2's "within 30 days of expiry", which the artefact
// does not carry. Whether a grant is EXPIRED stays the compiler's own
// fail-closed verdict, read out of the artefact (`expired`, `effective`), so
// no argument to this function can make a dead grant render as live. The
// default is the real clock; nothing in the UI passes anything else.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCodegen } from '@mcpforge/codegen/emit';
import { todayIso } from '@mcpforge/codegen/compile';

import { resolveRepoRoot } from '../../../build/_lib/repo-root';
import type { CompiledConsumerDraft } from '../types';
import { buildCompiledView } from './authorization-view';

/** The definitional trees a consumer compile reads. Mirrors `compile-role.ts`. */
const COPY_DIRS = [
  'manifests',
  'roles',
  'packages',
  'consumers',
  'enums',
  'approvals',
  'generated',
] as const;

/** Root files the deterministic writer reads — `.prettierrc` decides the artefact's bytes. */
const COPY_FILES = ['.prettierrc', '.prettierignore', '.editorconfig'] as const;

function failed(consumerId: string, message: string, next: string): CompiledConsumerDraft {
  return {
    consumerId,
    artefactJson: '',
    label: '',
    consumerClass: '',
    status: '',
    effectiveStatus: '',
    expiresAt: '',
    expired: false,
    bindingTypes: [],
    maxSensitivity: '',
    writeAllowed: false,
    roles: [],
    packages: [],
    limits: [],
    humanInTheLoop: false,
    networkOrigins: [],
    grants: [],
    listDeltas: [],
    scalarDeltas: [],
    error: { message, next },
  };
}

/**
 * Compile `yamlText` as `consumers/<consumerId>.consumer.yaml` and report the
 * compiled authorization artefact, its grants and the delta against
 * `mergedArtefactJson`.
 */
export async function compileConsumerDraft(
  consumerId: string,
  yamlText: string,
  mergedArtefactJson: string,
  today: string = todayIso(),
): Promise<CompiledConsumerDraft> {
  const repoRoot = resolveRepoRoot();
  let sandbox: string;
  try {
    sandbox = mkdtempSync(join(tmpdir(), 'mcpforge-governance-consumer-'));
  } catch (err) {
    return failed(
      consumerId,
      `A sandbox for the live compile could not be created: ${String(err)}.`,
      'Check the portal process can write to the system temp directory, then edit the record again.',
    );
  }
  try {
    for (const dir of COPY_DIRS) {
      const src = join(repoRoot, dir);
      if (existsSync(src)) cpSync(src, join(sandbox, dir), { recursive: true });
    }
    for (const file of COPY_FILES) {
      const src = join(repoRoot, file);
      if (existsSync(src)) cpSync(src, join(sandbox, file));
    }
    const recordPath = join(sandbox, 'consumers', `${consumerId}.consumer.yaml`);
    mkdirSync(dirname(recordPath), { recursive: true });
    writeFileSync(recordPath, yamlText, 'utf8');

    // Remove the COPIED compiled artefact before compiling. Its presence
    // afterwards is then proof that THIS run's compiler wrote it — without
    // this, a record codegen silently skipped (unparseable YAML, wrong kind)
    // would leave the previous artefact in place and the right pane would show
    // a stale authorization as though it were the live one. That is precisely
    // the failure 03 §16.2 names.
    const artefactAbs = join(sandbox, 'generated', 'consumers', `${consumerId}.authorization.json`);
    rmSync(artefactAbs, { force: true });

    try {
      await runCodegen(sandbox);
    } catch (err) {
      return failed(
        consumerId,
        `The edited consumer record did not compile: ${err instanceof Error ? err.message : String(err)}`,
        `Fix consumers/${consumerId}.consumer.yaml in the editor on the left — the compiled authorization stays empty until it compiles, so nothing here is stale.`,
      );
    }

    if (!existsSync(artefactAbs)) {
      return failed(
        consumerId,
        `codegen wrote no generated/consumers/${consumerId}.authorization.json for this edit, so there is no compiled authorization to show.`,
        `Check that consumers/${consumerId}.consumer.yaml still declares "kind: Consumer" and "id: ${consumerId}", then edit again.`,
      );
    }

    const artefactJson = readFileSync(artefactAbs, 'utf8');
    const view = buildCompiledView(consumerId, artefactJson, mergedArtefactJson, today);
    if (view === null) {
      return failed(
        consumerId,
        `The compiled authorization artefact for ${consumerId} could not be read back as JSON.`,
        `Run \`forge codegen\` locally to see the same failure with its full output, then edit consumers/${consumerId}.consumer.yaml again.`,
      );
    }
    return view;
  } catch (err) {
    return failed(
      consumerId,
      `The live compile failed: ${err instanceof Error ? err.message : String(err)}`,
      `Re-open /governance/consumers and edit consumers/${consumerId}.consumer.yaml again; if it persists, run \`forge codegen\` locally to see the same failure with its full output.`,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}
