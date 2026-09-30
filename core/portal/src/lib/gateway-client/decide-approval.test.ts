// W0-P25: the portal's one write to the gateway. It POSTs the verdict with
// BOTH halves of the caller, never sends an approver, and returns the same
// five states as a read, so a refusal is shown rather than thrown.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../viewer/session', () => ({ sessionIdFromCookies: () => Promise.resolve(undefined) }));

import { decideApproval, type ReadDeps } from './read-client';

const DECIDED = {
  asOf: '2026-09-30T00:00:00Z',
  approval: {
    id: 'apr_1',
    planHash: 'p',
    argsCanonicalHash: 'a',
    planSummary: 'This creates an OPEN PAYABLE in JD Edwards.',
    callerSubject: 'local:requester',
    consumerId: 'test-agent',
    toolId: 'jde.ap.voucher.create',
    toolVersion: '1.0.0',
    status: 'approved',
    approverSubject: 'local:approver',
    decisionReason: null,
    decidedAt: '2026-09-30T00:00:00Z',
    createdAt: '2026-09-29T00:00:00Z',
    expiresAt: '2026-10-01T00:00:00Z',
    selfApproved: false,
  },
  auditCallId: 'call_1',
  next: 'Approved. The requester executes it.',
};

function deps(overrides: Partial<ReadDeps> = {}): ReadDeps {
  return {
    baseUrl: 'http://gw.test',
    accessToken: () => Promise.resolve('human-token'),
    consumerHeaders: () => Promise.resolve({ 'mcpforge-consumer-assertion': 'signed' }),
    fetch: () => Promise.resolve(new Response(JSON.stringify(DECIDED), { status: 200 })),
    ...overrides,
  };
}

describe('decideApproval', () => {
  it('POSTs only the verdict, with the consumer assertion AND the viewer bearer', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(DECIDED), { status: 200 })),
    );
    const r = await decideApproval('apr_1', { decision: 'approved' }, deps({ fetch }));
    expect(r).toEqual({ kind: 'ok', data: DECIDED });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://gw.test/api/v1/approvals/apr_1/decision');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer human-token');
    expect(headers['mcpforge-consumer-assertion']).toBe('signed');
    expect(JSON.parse(init.body as string)).toEqual({ decision: 'approved' });
  });

  it('is signed-out, and sends nothing, without a session', async () => {
    const fetch = vi.fn();
    const r = await decideApproval(
      'apr_1',
      { decision: 'approved' },
      deps({ fetch, accessToken: () => Promise.resolve(null) }),
    );
    expect(r.kind).toBe('signed-out');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes the gateway refusal through verbatim, next included', async () => {
    const refusal = {
      error: {
        code: 'POLICY_GUARDRAIL_BREACH',
        message: 'local:requester raised this request and may not also approve it.',
        next: 'Ask a different named approver to decide it.',
        correlationId: 'c-1',
      },
    };
    const r = await decideApproval(
      'apr_1',
      { decision: 'approved' },
      deps({
        fetch: () => Promise.resolve(new Response(JSON.stringify(refusal), { status: 403 })),
      }),
    );
    expect(r).toEqual({
      kind: 'refused',
      code: 'POLICY_GUARDRAIL_BREACH',
      message: refusal.error.message,
      next: refusal.error.next,
      correlationId: 'c-1',
    });
  });
});
