import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildRequestFile, submitRequestInputSchema } from './build-request';
import { deriveRequestState, type RequestFacts } from './derive-state';
import { loadRequest, loadRequests, type RequestPorts } from './load-requests';
import {
  draftBranchForTool,
  newRequestId,
  parseRequestYaml,
  requestBranch,
  requestPath,
  requestYaml,
  type RequestFile,
} from './request-file';

const NOW = new Date('2026-10-06T10:00:00.000Z');

function base(over: Partial<RequestFile> = {}): RequestFile {
  const built = buildRequestFile(
    submitRequestInputSchema.parse({
      ask: 'search AP vouchers by amount',
      business: { does: 'find vouchers by amount', app: 'jde', module: 'ap', access: 'read' },
      verdict: { tier: 'near_miss', matches: [{ toolId: 'jde.ap.voucher.search', score: 11.3 }] },
      indexDigest: 'sha256:abc',
    }),
    'alice@example.test',
    NOW,
  );
  return { ...built, ...over };
}

const triaged = {
  owner: 'JDE Finance CoE',
  steward: 'bob',
  sensitivity: 'financial',
  processTag: 'P2P',
  expectedVolume: '',
  intendedToolId: 'jde.ap.voucher.search_by_amount',
  server: 'jde-fin-ap',
};

const NO_FACTS: RequestFacts = {
  submissionOpen: false,
  draftProposalState: undefined,
  manifestMerged: false,
  approvalRecorded: false,
  inIndex: false,
  probeStatus: undefined,
};

describe('request file', () => {
  it('round-trips through YAML and carries the requester the SERVER stamps, not the form', () => {
    const r = base();
    expect(r.requestedBy).toBe('alice@example.test');
    expect(r.id).toBe('req-20261006-search-ap-vouchers-by-amount');
    const parsed = parseRequestYaml(requestYaml(r), requestPath(r.id));
    expect(parsed.ok && parsed.request).toEqual(r);
    // The submit schema has no requestedBy: a smuggled one is dropped.
    const input = submitRequestInputSchema.parse({
      ask: 'x',
      business: { does: 'y', app: 'a', module: 'm', access: 'read' },
      verdict: { tier: 'new' },
      indexDigest: 'd',
      requestedBy: 'mallory',
    });
    expect(JSON.stringify(input)).not.toContain('mallory');
  });

  it('rejects a malformed file with a next', () => {
    const bad = parseRequestYaml('kind: Request\nid: nope\n', 'requests/x.request.yaml');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.next.length).toBeGreaterThan(0);
  });

  it('ids are deterministic and branches follow the note', () => {
    expect(newRequestId('Hello, World!', NOW)).toBe('req-20261006-hello-world');
    expect(requestBranch('req-1')).toBe('forge/req-1');
    expect(draftBranchForTool('jde.ap.voucher.search')).toBe('forge/build-jde-ap-voucher-search');
  });

  it('a justification becomes the merge-or-justify decision', () => {
    const r = buildRequestFile(
      submitRequestInputSchema.parse({
        ask: 'x',
        business: { does: 'y', app: 'a', module: 'm', access: 'write' },
        verdict: { tier: 'exists', matches: [{ toolId: 't', score: 1 }] },
        indexDigest: 'd',
        justification: 'different company code',
      }),
      's',
      NOW,
    );
    expect(r.verdictAtSubmit.decision).toEqual({ kind: 'justify', text: 'different company code' });
  });
});

describe('deriveRequestState (note §3)', () => {
  const r = base();
  const t = base({ governance: triaged });

  it('submitted while the file is only on an open proposal, or before triage', () => {
    expect(deriveRequestState(r, { ...NO_FACTS, submissionOpen: true }).state).toBe('submitted');
    expect(deriveRequestState(t, { ...NO_FACTS, submissionOpen: true }).state).toBe('submitted');
    expect(deriveRequestState(r, NO_FACTS).state).toBe('submitted');
  });

  it('triaged, drafted, in_review follow the linked proposal', () => {
    expect(deriveRequestState(t, NO_FACTS).state).toBe('triaged');
    expect(deriveRequestState(t, { ...NO_FACTS, draftProposalState: 'draft' }).state).toBe(
      'drafted',
    );
    expect(deriveRequestState(t, { ...NO_FACTS, draftProposalState: 'proposed' }).state).toBe(
      'in_review',
    );
  });

  it('merged needs the manifest AND an approval record, and is not enabled until the probe agrees', () => {
    const merged = { ...NO_FACTS, manifestMerged: true, approvalRecorded: true, inIndex: true };
    expect(deriveRequestState(t, { ...NO_FACTS, manifestMerged: true }).state).toBe('triaged');
    const noProbe = deriveRequestState(t, merged);
    expect(noProbe.state).toBe('merged');
    expect(noProbe.blocker).toContain('JDE Finance CoE');
    const disabled = deriveRequestState(t, { ...merged, probeStatus: 'disabled_missing_binding' });
    expect(disabled.state).toBe('merged');
    expect(disabled.blocker).toContain('disabled_missing_binding');
    expect(deriveRequestState(t, { ...merged, probeStatus: 'resolved' }).state).toBe('enabled');
  });

  it('declined and withdrawn are the only stored states and win over everything', () => {
    const closed = base({
      governance: triaged,
      closed: { state: 'declined', by: 'bob', at: 'x', reason: 'duplicate' },
    });
    expect(
      deriveRequestState(closed, { ...NO_FACTS, manifestMerged: true, approvalRecorded: true })
        .state,
    ).toBe('declined');
  });
});

describe('loadRequests', () => {
  function repo(): string {
    const root = mkdtempSync(join(tmpdir(), 'forge-requests-'));
    const put = (rel: string, text: string): void => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    };
    put(
      'requests/req-20261001-merged.request.yaml',
      requestYaml(base({ id: 'req-20261001-merged', governance: triaged })),
    );
    put('requests/broken.request.yaml', 'kind: Request\n');
    put(
      'manifests/jde/ap/voucher.search_by_amount.tool.yaml',
      'apiVersion: mcpforge/v1\nkind: Tool\nid: jde.ap.voucher.search_by_amount\n',
    );
    put(
      'approvals/a.yaml',
      'kind: Approval\ndecision: approved\nsubject:\n  kind: Tool\n  id: jde.ap.voucher.search_by_amount\n',
    );
    return root;
  }

  it('reads files from git, derives state, and reports a broken file instead of dropping it', async () => {
    const ports: RequestPorts = { listProposals: async () => [], readFile: async () => undefined };
    const snap = await loadRequests(repo(), ports);
    expect(snap.requests.map((x) => [x.request.id, x.derivation.state])).toEqual([
      ['req-20261001-merged', 'merged'],
    ]);
    expect(snap.problems.map((p) => p.path)).toEqual(['requests/broken.request.yaml']);
    expect(snap.problems[0]?.next.length).toBeGreaterThan(0);
  });

  it('shows a request that is only on an open proposal as Submitted, with its proposal id', async () => {
    const r = base({ id: 'req-20261006-pending' });
    const ports: RequestPorts = {
      listProposals: async () => [
        { id: 'p1', branch: 'forge/req-20261006-pending', state: 'proposed' },
      ],
      readFile: async (id, path) =>
        id === 'p1' && path === requestPath(r.id) ? requestYaml(r) : undefined,
    };
    const found = await loadRequest('req-20261006-pending', repo(), ports);
    expect(found?.derivation.state).toBe('submitted');
    expect(found?.submissionProposalId).toBe('p1');
  });

  it('a Build proposal for the intended tool moves an unmerged request to In review', async () => {
    const root = repo();
    writeFileSync(
      join(root, 'requests', 'req-20261002-other.request.yaml'),
      requestYaml(
        base({
          id: 'req-20261002-other',
          governance: { ...triaged, intendedToolId: 'jde.ap.voucher.other' },
        }),
      ),
    );
    const ports: RequestPorts = {
      listProposals: async () => [
        { id: 'd1', branch: draftBranchForTool('jde.ap.voucher.other'), state: 'proposed' },
      ],
      readFile: async () => undefined,
    };
    const found = await loadRequest('req-20261002-other', root, ports);
    expect(found?.derivation.state).toBe('in_review');
    expect(found?.draftProposalId).toBe('d1');
  });
});
