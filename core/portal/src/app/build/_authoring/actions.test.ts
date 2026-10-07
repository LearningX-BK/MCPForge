// W0-Q9b: the Suggest panel's relay to the gateway's authoring endpoints. The
// gateway is a fetch fake answering in the shared /api/v1 contract; nothing
// here opens a secret store or imports a model adapter (the portal-http-boundary
// gate). The acceptor is never sent, and a spoofed one is dropped before the
// request is built.
import { describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { AUTHORING_ACCEPT_PATH, AUTHORING_STATUS_PATH, AUTHORING_SUGGEST_PATH } from '@mcpforge/shared/api/v1';

vi.mock('@/lib/viewer/session', () => ({ sessionIdFromCookies: () => Promise.resolve(undefined) }));

import { START_GATEWAY_COMMAND, type ReadDeps } from '@/lib/gateway-client/read-client';

import { mergeAcceptedField, relayAccept, relayPreview, relayStatus, relaySuggest } from './relay';

const DRAFT = 'id: jde.ap.supplier.create\npurpose: Old.\n';
const ASOF = '2026-10-07T10:00:00Z';
const ACCEPTED = {
  field: 'purpose',
  provider: 'bv',
  model: 'flow:f',
  requestId: 'r1',
  acceptedBy: 'local:alice',
  acceptedAt: ASOF,
};

type Call = { url: string; init: RequestInit };

function gateway(status: number, json: unknown): { deps: ReadDeps; calls: Call[] } {
  const calls: Call[] = [];
  const deps: ReadDeps = {
    baseUrl: 'http://gw.test',
    accessToken: () => Promise.resolve('human-token'),
    consumerHeaders: () => Promise.resolve({ 'mcpforge-consumer-assertion': 'signed' }),
    fetch: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify(json), { status }));
    },
  };
  return { deps, calls };
}

const sent = (c: Call | undefined): Record<string, unknown> => JSON.parse(String(c?.init.body)) as Record<string, unknown>;

describe('relayStatus: absent, not broken', () => {
  it('passes an enabled status through, from the gateway', async () => {
    const status = {
      asOf: ASOF,
      enabled: true,
      defaultProvider: 'bv',
      providers: [{ id: 'bv', kind: 'blueverse', available: true }],
    };
    const g = gateway(200, status);
    expect(await relayStatus(g.deps)).toEqual({
      enabled: true,
      defaultProvider: 'bv',
      providers: status.providers,
    });
    expect(g.calls[0]?.url).toBe(`http://gw.test${AUTHORING_STATUS_PATH}`);
    expect(g.calls[0]?.init.method).toBe('GET');
  });

  it('is absent when the gateway refuses (an agent consumer), is down, or nobody is signed in', async () => {
    const off = { enabled: false, providers: [], defaultProvider: null };
    const refused = gateway(403, {
      error: { code: 'CONSUMER_NOT_AUTHORIZED', message: 'm', next: 'n', correlationId: 'c' },
    });
    expect(await relayStatus(refused.deps)).toEqual(off);
    const down: ReadDeps = { ...refused.deps, fetch: () => Promise.reject(new TypeError('ECONNREFUSED')) };
    expect(await relayStatus(down)).toEqual(off);
    expect(await relayStatus({ ...refused.deps, accessToken: () => Promise.resolve(null) })).toEqual(off);
  });
});

describe('relaySuggest / relayPreview', () => {
  it('preview asks the gateway for a dry run and shows its payload', async () => {
    const g = gateway(200, { asOf: ASOF, dryRun: true, sent: false, provider: 'bv', system: 'SYS', user: 'Field: purpose', next: 'Nothing was sent.' });
    const r = await relayPreview({ yaml: DRAFT, field: 'purpose' }, g.deps);
    expect(r).toEqual({ ok: true, provider: 'bv', system: 'SYS', user: 'Field: purpose' });
    expect(g.calls[0]?.url).toBe(`http://gw.test${AUTHORING_SUGGEST_PATH}`);
    expect(sent(g.calls[0])).toEqual({ yaml: DRAFT, field: 'purpose', dryRun: true });
  });

  it('a suggestion carries its suggestionId, with both halves of the caller and a bounded wait', async () => {
    const g = gateway(200, {
      asOf: ASOF,
      dryRun: false,
      suggestionId: 'call-1',
      field: 'purpose',
      inputName: null,
      text: 'Create a supplier.',
      provenance: { provider: 'bv', model: 'flow:f', requestId: 'r1' },
      next: 'A suggestion only.',
    });
    const r = await relaySuggest(
      { yaml: DRAFT, field: 'purpose', providerId: 'bv', request: { does: 'adds suppliers', goodAnswer: '', inputs: [] } },
      g.deps,
    );
    expect(r).toEqual({
      ok: true,
      text: 'Create a supplier.',
      suggestionId: 'call-1',
      provenance: { provider: 'bv', model: 'flow:f', requestId: 'r1' },
    });
    const headers = g.calls[0]?.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer human-token');
    expect(headers['mcpforge-consumer-assertion']).toBe('signed');
    expect(g.calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    // Empty request answers are omitted, not sent as empty strings.
    expect(sent(g.calls[0])).toEqual({ yaml: DRAFT, field: 'purpose', providerId: 'bv', request: { does: 'adds suppliers' } });
  });

  it('maps every non-answer onto a refusal with a next', async () => {
    const signedOut = gateway(200, {});
    const out = await relaySuggest({ yaml: DRAFT, field: 'purpose' }, { ...signedOut.deps, accessToken: () => Promise.resolve(null) });
    expect(out).toMatchObject({ ok: false, code: 'CHANGE_SIGN_IN_REQUIRED' });
    expect(signedOut.calls).toHaveLength(0);

    const down = await relaySuggest({ yaml: DRAFT, field: 'purpose' }, { ...signedOut.deps, fetch: () => Promise.reject(new TypeError('x')) });
    expect(down).toMatchObject({ ok: false, code: 'GATEWAY_UNREACHABLE' });
    if (!down.ok) expect(down.next).toContain(START_GATEWAY_COMMAND);

    const refusal = { code: 'AUTHORING_SENSITIVITY_BLOCKED', message: 'Too sensitive.', next: 'Write this copy by hand.', correlationId: 'c' };
    const refused = await relaySuggest({ yaml: DRAFT, field: 'purpose' }, gateway(403, { error: refusal }).deps);
    expect(refused).toEqual({ ok: false, code: refusal.code, message: refusal.message, next: refusal.next });

    const notServed = await relaySuggest(
      { yaml: DRAFT, field: 'purpose' },
      gateway(404, { error: { code: 'NOT_FOUND', message: 'Not served.', next: 'Restart.', correlationId: 'c' } }).deps,
    );
    expect(notServed).toMatchObject({ ok: false, code: 'AUTHORING_NOT_SERVED' });
    if (!notServed.ok) expect(notServed.next).toContain('overlays/<deployment>/authoring.yaml');
  });
});

describe('relayAccept: the acceptor is the gateway\'s', () => {
  const answer = {
    asOf: ASOF,
    yaml: 'id: jde.ap.supplier.create\npurpose: Create a supplier.\n',
    provenancePath: 'provenance/jde.ap.supplier.create.authoring.yaml',
    accepted: ACCEPTED,
    auditCallId: 'call-2',
    next: 'Applied.',
  };

  it('sends only the field, the text and the suggestionId: never an acceptor, provenance or the sidecar', async () => {
    const g = gateway(200, answer);
    const r = await relayAccept(
      {
        yaml: DRAFT,
        field: 'purpose',
        text: 'Create a supplier.',
        suggestionId: 'call-1',
        provenanceYaml: 'kind: AuthoringProvenance\n',
        acceptedBy: 'local:mallory',
        provenance: { provider: 'evil', model: 'x', requestId: 'y' },
      } as never,
      g.deps,
    );
    expect(g.calls[0]?.url).toBe(`http://gw.test${AUTHORING_ACCEPT_PATH}`);
    expect(sent(g.calls[0])).toEqual({ yaml: DRAFT, field: 'purpose', text: 'Create a supplier.', suggestionId: 'call-1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.yaml).toBe(answer.yaml);
    expect(r.provenancePath).toBe(answer.provenancePath);
    expect(r.provenanceYaml).toContain('acceptedBy: local:alice');
    expect(r.provenanceYaml).not.toContain('mallory');
    expect(r.provenanceYaml).not.toContain('evil');
  });

  it('a refused accept is passed through with its next', async () => {
    const error = { code: 'AUTHORING_SUGGESTION_UNKNOWN', message: 'Cannot accept.', next: 'Ask for a new suggestion.', correlationId: 'c' };
    const r = await relayAccept({ yaml: DRAFT, field: 'purpose', text: 't', suggestionId: 's' }, gateway(409, { error }).deps);
    expect(r).toEqual({ ok: false, code: error.code, message: error.message, next: error.next });
  });
});

describe('mergeAcceptedField', () => {
  it('keeps other fields, replaces a re-accepted one, and ignores a sidecar for another tool', () => {
    const first = mergeAcceptedField(undefined, 'a.b.c.get', ACCEPTED);
    const second = mergeAcceptedField(first, 'a.b.c.get', { ...ACCEPTED, field: 'input.desc', inputName: 'amount' });
    const third = mergeAcceptedField(second, 'a.b.c.get', { ...ACCEPTED, requestId: 'r2', acceptedBy: 'local:bob' });
    const doc = parseYaml(third) as { kind: string; toolId: string; fields: { field: string; requestId: string; acceptedBy: string }[] };
    expect(doc).toMatchObject({ kind: 'AuthoringProvenance', toolId: 'a.b.c.get' });
    expect(doc.fields.map((f) => `${f.field}:${f.requestId}:${f.acceptedBy}`)).toEqual([
      'input.desc:r1:local:alice',
      'purpose:r2:local:bob',
    ]);
    const other = parseYaml(mergeAcceptedField(third, 'x.y.z.get', ACCEPTED)) as { fields: unknown[] };
    expect(other.fields).toHaveLength(1);
  });
});
