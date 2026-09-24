// `forge ci` stage 4 — the custom-binding contract check.
// W0-P1, 02 §2.4, 02 §7.2 stage 4, CLAUDE.md §3 ("drift ... fails the build").
//
// WHICH STAGE, AND WHY NOT A NEW ONE. Stage 4 is already named
// "Custom-binding contract check", failing on
// `CUSTOM_BINDING_CONTRACT_DRIFT`. Until now it carried
// `notImplemented('W0-B5')` — but W0-B5 landed and
// `core/codegen/src/emit/custom.ts` has been computing and enforcing the
// contract hash ever since. The stage was never connected to it.
//
// WHY AN IMPORT AND NOT A SUBPROCESS — the one place this file departs from
// `bench-gate.ts` and `validate-gate.ts`, deliberately, and the reason is the
// whole design of this gate:
//
//   There is no `forge` subcommand that checks contract drift WITHOUT writing.
//   `forge codegen` detects drift, but it also regenerates the entire
//   `generated/` tree as a side effect, and `forge codegen --accept-contract`
//   MUTATES the very hash this gate exists to verify. Stage 3 already runs
//   `runCodegen` and already fails on `contractDrift` — so spawning
//   `forge codegen` here would duplicate stage 3's work, rewrite files a
//   second time mid-pipeline, and make stage 4 a slower restatement of its
//   neighbour rather than an independent check.
//
// So stage 4 is a READ-ONLY reimplementation of the same comparison over the
// same exported primitives — `contractSnapshot`, `contractHash`,
// `readContractHashComment`, `readContractSnapshot`, `diffContracts` — and it
// writes nothing. That independence is the point: stage 3 proves the tree
// regenerates clean, stage 4 proves every hand-owned binding body still
// matches its manifest even in a working tree where codegen has NOT been run.
// The two can fail separately and mean different things.
//
// It does not duplicate the hash ALGORITHM — it calls the same exported
// `contractHash`, so the two can never disagree about what the hash is.
//
// FAILURE MODES, ALL REAL FAILURES, NEVER A SOFT PASS:
//   1. hash mismatch -> CUSTOM_BINDING_CONTRACT_DRIFT, naming the exact
//      changed fields when the previous snapshot is readable;
//   2. hash-comment marker absent from a hand-owned file -> drift (the file
//      cannot be shown to match anything);
//   3. `bindingCustom: true` but no `binding.custom.ts` on disk -> failure
//      (codegen has never created the stub — the tool has no binding body);
//   4. a `binding.custom.ts` on disk for a tool that no longer declares
//      `bindingCustom` -> failure (an orphaned hand-owned file is exactly the
//      drift this gate exists to catch, from the other direction).
// Zero custom bindings in the repo is a legitimate PASS, not a skip: the
// check ran, found nothing to check, and says so.

import { existsSync, readFileSync } from 'node:fs';
import {
  contractHash,
  contractSnapshot,
  customBindingPath,
  customBindingRepoPath,
  diffContracts,
  formatContractDriftHuman,
  hasCustomBinding,
  readContractHashComment,
  readContractSnapshot,
  CUSTOM_BINDING_CONTRACT_DRIFT,
  type ContractChange,
  type ContractDriftFailure,
} from '@mcpforge/codegen/emit';
import { loadManifestFiles, resolvedKindAndId } from '@mcpforge/codegen/validate';
import type { StageOutcome } from './stages.js';

export interface ContractCheckReport {
  /** True when every hand-owned binding body matches its manifest's contract. */
  readonly ok: boolean;
  /** How many tools declare `bindingCustom: true`. */
  readonly customBindingsChecked: number;
  /** Every drift, sorted by tool id. */
  readonly drift: readonly ContractDriftFailure[];
  /**
   * Structural problems that are not a hash mismatch: a declared custom
   * binding with no file, or a file with no declaration. Each is a failure.
   */
  readonly structural: readonly { readonly toolId: string; readonly message: string; readonly fix: string }[];
}

/**
 * The read-only contract comparison. Exported separately from the stage
 * wrapper so a test can assert the report rather than a formatted string.
 */
export function checkCustomBindingContracts(repoRoot: string): ContractCheckReport {
  const files = loadManifestFiles(repoRoot);

  const tools: { readonly doc: unknown; readonly id: string }[] = [];
  for (const file of files) {
    const resolved = resolvedKindAndId(file);
    if (resolved && resolved.kind === 'Tool') {
      tools.push({ doc: file.doc, id: resolved.id });
    }
  }
  tools.sort((a, b) => a.id.localeCompare(b.id));

  const drift: ContractDriftFailure[] = [];
  const structural: { toolId: string; message: string; fix: string }[] = [];
  let checked = 0;

  for (const { doc, id } of tools) {
    const declared = hasCustomBinding(doc);
    const absPath = customBindingPath(repoRoot, id);
    const onDisk = existsSync(absPath);

    if (!declared) {
      if (onDisk) {
        structural.push({
          toolId: id,
          message: `${customBindingRepoPath(id)} exists but ${id} no longer declares \`bindingCustom: true\` — an orphaned hand-owned binding body.`,
          fix: `either restore \`bindingCustom: true\` in the manifest, or delete ${customBindingRepoPath(id)} in the same change that removed it.`,
        });
      }
      continue;
    }

    checked += 1;

    if (!onDisk) {
      structural.push({
        toolId: id,
        message: `${id} declares \`bindingCustom: true\` but ${customBindingRepoPath(id)} does not exist — the tool has no binding body.`,
        fix: 'run `forge codegen` once to create the typed stub, then implement it.',
      });
      continue;
    }

    const expectedHash = contractHash(contractSnapshot(id, doc));
    const foundHash = readContractHashComment(readFileSync(absPath, 'utf8'));

    if (foundHash === expectedHash) continue;

    // Name the exact fields when the accepted snapshot is readable; say so
    // plainly when it is not, rather than implying precision we do not have.
    const previous = readContractSnapshot(repoRoot, id);
    const changed: readonly ContractChange[] =
      previous === null
        ? [
            `contract changed (hash ${foundHash ?? 'absent'} -> ${expectedHash}); the previous contract snapshot at generated/tools/${id}/contract.json is missing, so the individual fields cannot be named`,
          ]
        : diffContracts(previous, contractSnapshot(id, doc));

    drift.push({
      code: CUSTOM_BINDING_CONTRACT_DRIFT,
      toolId: id,
      file: customBindingRepoPath(id),
      changed:
        changed.length > 0
          ? changed
          : [
              `contract hash changed (${foundHash ?? 'absent'} -> ${expectedHash}) but no individual field difference was found — the accepted snapshot is stale`,
            ],
      fix: `update the file, then \`forge codegen --accept-contract ${id}\``,
      foundHash,
      expectedHash,
    });
  }

  return {
    ok: drift.length === 0 && structural.length === 0,
    customBindingsChecked: checked,
    drift,
    structural,
  };
}

/** Stage 4's `run`. Never writes; never soft-passes. */
export function runContractCheckGate(repoRoot: string): StageOutcome {
  let report: ContractCheckReport;
  try {
    report = checkCustomBindingContracts(repoRoot);
  } catch (err) {
    return {
      status: 'failed',
      detail: [
        `The custom-binding contract check threw before it could finish: ${err instanceof Error ? err.message : String(err)}`,
        'next: run `forge codegen` by hand — this gate fails closed rather than reporting a pass it cannot back up.',
      ].join('\n'),
    };
  }

  if (report.ok) {
    return {
      status: 'passed',
      detail:
        report.customBindingsChecked === 0
          ? 'No tool declares `bindingCustom: true` — 0 hand-owned binding bodies to check.'
          : `${report.customBindingsChecked} hand-owned binding body/bodies checked; every contract-hash matches its manifest.`,
    };
  }

  return {
    status: 'failed',
    detail: [
      `${report.drift.length} contract drift(s) and ${report.structural.length} structural problem(s) across ${report.customBindingsChecked} hand-owned binding body/bodies.`,
      ...report.drift.map((d) => formatContractDriftHuman(d)),
      ...report.structural.map((s) => `${s.toolId}\n  ${s.message}\n  fix:     ${s.fix}`),
    ].join('\n'),
  };
}
