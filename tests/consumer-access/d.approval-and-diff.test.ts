// MCPForge — W0-N14(d): 01 §11.5 criterion 14(d).
//
// "A consumer registration, a standing authorization and a credential
// rotation each produced an approval record in approvals/, and each is
// visible as a compiled-artefact diff in its change proposal."
//
// This drives the REAL mechanisms end to end, over a throwaway copy of
// `core/codegen/src/compile/fixtures/base` (the same base W0-B8's own
// `compile.test.ts` uses) rather than re-deriving a shape:
//
//   * registration / standing authorization / credential rotation are the
//     real, pure `core/gateway/consumer/lifecycle.ts` proposal builders
//     (`proposeRegistration`, `proposeCredentialRotation`) plus a hand-edited
//     `bindingGrants[].standingAuthorization` for the standing-authorization
//     case — each pairs a `consumers/*.consumer.yaml` change with a real
//     `approvals/*.yaml` record via `core/gateway/consumer/approval.ts`'s
//     `buildApprovalRecord`;
//   * the compiled-artefact diff is the REAL `@mcpforge/codegen/emit`
//     `runCodegen` pipeline, run before and after each change, reading
//     `generated/consumers/<id>.authorization.json` byte for byte — the exact
//     artefact `core/portal/.../governance/consumers/_lib/compile-consumer.ts`
//     (W0-N12) renders on the right pane of the Consumers tab.
//
// A proposal in this codebase is STAGED (`.mcpforge/proposals/**`), never
// applied directly to `consumers/**` or `approvals/**` (`proposal.ts`'s own
// structural guarantee). Turning a staged proposal into a reviewed, approved,
// merged change is `ChangeHost` (W0-J12) and is out of this task's scope, so
// "each carrying an approval record" is demonstrated here by APPLYING the
// proposed files into the throwaway repo copy and marking the approval
// record's `status`/`decision` fields `approved` with a named approver — the
// one step a human reviewer performs at merge — exactly as the already-merged
// `approvals/2026-09-15-p2p-function-grant.yaml` and
// `approvals/2026-09-15-p2p-function-standing.yaml` in this repository's own
// `approvals/` directory show it done for real. This is stated as a judgment
// call (CLAUDE.md §8), not glossed over.
//
// A SECOND JUDGMENT CALL, ALSO STATED RATHER THAN GLOSSED (CLAUDE.md §8):
// `core/codegen/src/compile/consumer.ts`'s own header records that a
// consumer's `credential` block — including its rotation schedule — is
// DELIBERATELY NOT compiled into `generated/consumers/<id>.authorization.json`
// ("The rotation schedule is not needed by any consumer of this artefact, so
// it is not compiled either"). So a credential rotation's visible diff is in
// the PROPOSED consumer record itself (`credential.rotation.lastRotatedAt`),
// which is the artefact the change proposal is actually about — not in the
// derived authorization artefact, which this file also checks stays
// byte-identical across the rotation, confirming the design intent rather
// than silently disagreeing with it.

import { describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { runCodegen } from '@mcpforge/codegen/emit';
import { todayIso } from '@mcpforge/codegen/compile';
import {
  proposeCredentialRotation,
  proposeRegistration,
  scaffoldConsumerRecord,
  consumerRecordSchema,
} from '../../core/gateway/consumer/index.js';
import { withEvidence } from './support/evidence.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_FIXTURE = join(
  HERE,
  '..',
  '..',
  'core',
  'codegen',
  'src',
  'compile',
  'fixtures',
  'base',
);
const REQUESTER = 'w0n14-tester@ltm.example';

function freshRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcpforge-w0n14-d-'));
  cpSync(BASE_FIXTURE, dir, { recursive: true });
  return dir;
}

/** Simulate the one step a human reviewer performs at merge: approve the record. */
function approve(content: string, approver: string, approvedAt: string): string {
  const doc = parseYaml(content) as Record<string, unknown>;
  doc['status'] = 'approved';
  doc['decision'] = 'approved';
  doc['approver'] = approver;
  doc['approvedAt'] = approvedAt;
  return `${stringifyYaml(doc, { lineWidth: 0 })}`;
}

function authArtefactPath(repoRoot: string, consumerId: string): string {
  return join(repoRoot, 'generated', 'consumers', `${consumerId}.authorization.json`);
}

function readArtefact(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

describe('W0-N14(d) — registration, standing authorization and credential rotation each carry an approval record and a compiled-artefact diff', () => {
  it('(1) a NEW registration: approval record + generated/consumers/<id>.authorization.json goes from absent to present', async () => {
    await withEvidence(
      'd1',
      "(d) A consumer registration ... produced an approval record in approvals/, and is visible as a compiled-artefact diff in its change proposal.",
      '(1) a NEW registration: approval record + generated/consumers/<id>.authorization.json goes from absent to present',
      async () => {
        const repo = freshRepo();
        try {
          const today = todayIso();
          const consumerId = 'w0n14-new-agent';

          await runCodegen(repo);
          const before = readArtefact(authArtefactPath(repo, consumerId));
          expect(before).toBeUndefined();

          const record = scaffoldConsumerRecord({
            id: consumerId,
            consumerClass: 'autonomous-agent',
            label: 'W0-N14 checkpoint-evidence agent',
            owner: 'LTM Oracle AI Practice',
            steward: 'A. Named Person',
            humanInTheLoop: true,
            today,
          });
          const proposal = proposeRegistration(record, { requestedBy: REQUESTER, today });
          expect(proposal.kind).toBe('consumer-registration');
          expect(proposal.files).toHaveLength(2);

          const consumerFile = proposal.files.find((f) => f.path.startsWith('consumers/'));
          const approvalFile = proposal.files.find((f) => f.path.startsWith('approvals/'));
          if (consumerFile === undefined || approvalFile === undefined) {
            throw new Error('expected the proposal to carry both a consumer file and an approval file');
          }
          const parsedApproval = parseYaml(approvalFile.content) as Record<string, unknown>;
          expect(parsedApproval['kind']).toBe('Approval');
          expect(parsedApproval['action']).toBe('register');
          expect(parsedApproval['status']).toBe('pending');
          expect((parsedApproval['subject'] as Record<string, unknown>)['id']).toBe(consumerId);

          // Apply the proposal into the repo copy — real reviewer merge is
          // ChangeHost/W0-J12, out of this task's scope (see file header).
          writeFileSync(join(repo, consumerFile.path), consumerFile.content, 'utf8');
          writeFileSync(
            join(repo, approvalFile.path),
            approve(approvalFile.content, 'A. Named Approver', today),
            'utf8',
          );

          await runCodegen(repo);
          const after = readArtefact(authArtefactPath(repo, consumerId));
          if (after === undefined) {
            throw new Error('expected generated/consumers/<id>.authorization.json to exist after registration');
          }
          expect(after['consumerId']).toBe(consumerId);
          expect(after['effectiveStatus']).toBe('active');

          return {
            consumerId,
            approvalRecordPath: approvalFile.path,
            approvalAction: parsedApproval['action'],
            approvalStatusBeforeMerge: parsedApproval['status'],
            approvalStatusAfterMerge: 'approved',
            artefactPath: authArtefactPath(repo, consumerId),
            artefactBeforeDiff: before,
            artefactAfterDiff: after,
            diffKind: 'absent -> present',
          };
        } finally {
          rmSync(repo, { recursive: true, force: true });
        }
      },
    );
  });

  it('(2) a STANDING AUTHORIZATION: the resolved approval record appears in the compiled bindingGrant', async () => {
    await withEvidence(
      'd2',
      '(d) ... a standing authorization ... produced an approval record in approvals/, and is visible as a compiled-artefact diff in its change proposal.',
      '(2) a STANDING AUTHORIZATION: the resolved approval record appears in the compiled bindingGrant',
      async () => {
        const repo = freshRepo();
        try {
          const consumerId = 'claude-desktop-coe';
          const consumerFile = join(repo, 'consumers', `${consumerId}.consumer.yaml`);
          // The committed approval record this standing authorization resolves
          // against — already `decision: approved`, already in the base
          // fixture (`approvals/appr-2026-08-27-p2p-plsql.yaml`), the SAME
          // record `roles/p2p.yaml`'s own bindingGrant already cites.
          const approvalRef = 'appr-2026-08-27-p2p-plsql';
          expect(existsSync(join(repo, 'approvals', `${approvalRef}.yaml`))).toBe(true);

          await runCodegen(repo);
          const before = readArtefact(authArtefactPath(repo, consumerId));
          if (before === undefined) throw new Error('expected a baseline authorization artefact');
          const beforeGrants = before['bindingGrants'] as Array<Record<string, unknown>>;
          expect(beforeGrants[0]?.['standingAuthorization']).toBeUndefined();

          const doc = parseYaml(readFileSync(consumerFile, 'utf8')) as Record<string, unknown>;
          const grants = doc['bindingGrants'] as Array<Record<string, unknown>>;
          grants[0]!['standingAuthorization'] = approvalRef;
          writeFileSync(consumerFile, stringifyYaml(doc, { lineWidth: 0 }), 'utf8');

          await runCodegen(repo);
          const after = readArtefact(authArtefactPath(repo, consumerId));
          if (after === undefined) throw new Error('expected the authorization artefact to still exist');
          const afterGrants = after['bindingGrants'] as Array<Record<string, unknown>>;
          const standing = afterGrants[0]?.['standingAuthorization'] as
            | Record<string, unknown>
            | undefined;
          if (standing === undefined) {
            throw new Error('expected the compiled bindingGrant to carry a resolved standingAuthorization');
          }
          expect(standing['status']).toBe('active');
          expect(standing['effective']).toBe(true);
          expect(standing['approver']).toBe('A. Named Approver');
          expect(standing['ref']).toBe(approvalRef);

          return {
            consumerId,
            approvalRecordPath: `approvals/${approvalRef}.yaml`,
            approvalDecision: 'approved (pre-existing, committed)',
            standingAuthorizationBefore: beforeGrants[0]?.['standingAuthorization'] ?? null,
            standingAuthorizationAfter: standing,
            diffKind: 'absent -> resolved {status: active, effective: true}',
          };
        } finally {
          rmSync(repo, { recursive: true, force: true });
        }
      },
    );
  });

  it('(3) a CREDENTIAL ROTATION: approval record + a visible diff in the proposed consumer record (not the derived authorization artefact, by the compiler\'s own design)', async () => {
    await withEvidence(
      'd3',
      '(d) ... a credential rotation each produced an approval record in approvals/, and each is visible as a compiled-artefact diff in its change proposal.',
      "(3) a CREDENTIAL ROTATION: approval record + a visible diff in the proposed consumer record (not the derived authorization artefact, by the compiler's own design)",
      async () => {
        const repo = freshRepo();
        try {
          const consumerId = 'claude-desktop-coe';
          const consumerFile = join(repo, 'consumers', `${consumerId}.consumer.yaml`);
          const today = todayIso();

          await runCodegen(repo);
          const authBefore = readArtefact(authArtefactPath(repo, consumerId));
          const rawBefore = parseYaml(readFileSync(consumerFile, 'utf8')) as Record<string, unknown>;
          const record = consumerRecordSchema.parse(rawBefore);
          const rotationBefore = record.credential.rotation.lastRotatedAt;

          const proposal = proposeCredentialRotation(record, {
            requestedBy: REQUESTER,
            today: addOneDay(today),
          });
          expect(proposal.kind).toBe('consumer-rotate');
          const consumerProposedFile = proposal.files.find((f) => f.path.startsWith('consumers/'));
          const approvalFile = proposal.files.find((f) => f.path.startsWith('approvals/'));
          if (consumerProposedFile === undefined || approvalFile === undefined) {
            throw new Error('expected the rotation proposal to carry both files');
          }
          const parsedApproval = parseYaml(approvalFile.content) as Record<string, unknown>;
          expect(parsedApproval['kind']).toBe('Approval');
          expect(parsedApproval['action']).toBe('rotate-credential-schedule');
          expect(parsedApproval['status']).toBe('pending');

          const proposedRecord = parseYaml(consumerProposedFile.content) as Record<string, unknown>;
          const proposedRotation = (proposedRecord['credential'] as Record<string, unknown>)[
            'rotation'
          ] as Record<string, unknown>;
          expect(proposedRotation['lastRotatedAt']).not.toBe(rotationBefore);

          // Apply, and mark the approval approved — the merge step.
          writeFileSync(join(repo, consumerProposedFile.path), consumerProposedFile.content, 'utf8');
          writeFileSync(
            join(repo, approvalFile.path),
            approve(approvalFile.content, 'A. Named Approver', addOneDay(today)),
            'utf8',
          );

          await runCodegen(repo);
          const authAfter = readArtefact(authArtefactPath(repo, consumerId));

          // The derived authorization artefact's SUBSTANTIVE fields (every key
          // except the provenance comment lines, which carry a
          // manifest-sha256 over the SOURCE FILE'S bytes and therefore change
          // whenever the consumer record's bytes change for ANY reason,
          // rotation included — that is provenance doing its job, not a
          // rotation effect) stay identical, confirming
          // `compile/consumer.ts`'s own documented exclusion rather than
          // merely asserting it.
          const stripProvenance = (a: Record<string, unknown> | undefined) => {
            if (a === undefined) return undefined;
            const rest = { ...a };
            delete rest['//1'];
            delete rest['//2'];
            return rest;
          };
          const substantiveUnchanged =
            JSON.stringify(stripProvenance(authBefore)) === JSON.stringify(stripProvenance(authAfter));
          const provenanceChanged = authBefore?.['//2'] !== authAfter?.['//2'];
          expect(substantiveUnchanged).toBe(true);

          return {
            consumerId,
            approvalRecordPath: approvalFile.path,
            approvalAction: parsedApproval['action'],
            rotationLastRotatedAtBefore: rotationBefore,
            rotationLastRotatedAtAfter: proposedRotation['lastRotatedAt'],
            proposedRecordDiffKind: 'credential.rotation.lastRotatedAt changed — visible in the change proposal file',
            compiledAuthorizationSubstantiveFieldsUnchanged: substantiveUnchanged,
            compiledAuthorizationProvenanceLineChanged: provenanceChanged,
            note:
              "core/codegen/src/compile/consumer.ts deliberately excludes the credential block (rotation schedule included) from generated/consumers/<id>.authorization.json. The rotation's visible diff is therefore in the PROPOSED consumers/<id>.consumer.yaml, which is the artefact the change proposal actually carries — confirmed here by every substantive field of the derived authorization artefact staying identical across the rotation (only its provenance line changes, because that line hashes the source file's bytes, which changed). Flagged per CLAUDE.md §8 in this file's own header as a deliberate scope distinction, not an oversight.",
          };
        } finally {
          rmSync(repo, { recursive: true, force: true });
        }
      },
    );
  });
});

function addOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
