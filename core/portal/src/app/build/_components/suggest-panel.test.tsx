// @vitest-environment jsdom
//
// W0-Q9: the Suggest panel. Absent (not disabled, not an error) when authoring is
// off; a suggestion changes nothing until a person accepts that one field; Save
// draft carries the provenance of what they accepted.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const status = vi.fn();
const preview = vi.fn();
const suggest = vi.fn();
const accept = vi.fn();
vi.mock('../_authoring/actions', () => ({
  authoringStatus: () => status(),
  authoringPreview: (p: unknown) => preview(p),
  authoringSuggest: (p: unknown) => suggest(p),
  authoringAccept: (p: unknown) => accept(p),
}));
// The heavy panes are not under test here.
vi.mock('./yaml-editor', () => ({ YamlEditor: () => <div data-testid="yaml-editor" /> }));
vi.mock('./guided-form', () => ({ GuidedForm: () => null }));
vi.mock('./preview-pane', () => ({ PreviewPane: () => null }));
vi.mock('./checks-pane', () => ({ ChecksPane: () => null }));
vi.mock('./sandbox-run', () => ({ SandboxRun: () => null }));

import type { ChangeHost } from '@/lib/change-host';

import { NEW_DRAFT_TEMPLATE_YAML, newBuildDraft } from '../new-draft';
import { DraftEditor } from './draft-editor';
import { SuggestPanel } from './suggest-panel';

afterEach(cleanup);
beforeEach(() => {
  for (const f of [status, preview, suggest, accept]) f.mockReset();
});

const ON = {
  enabled: true,
  defaultProvider: 'blueverse',
  providers: [
    { id: 'blueverse', kind: 'blueverse', available: true },
    { id: 'claude', kind: 'anthropic', available: false },
  ],
};
const YAML = 'id: a.b.c.get\ninput:\n  - { name: amount, type: number, desc: Amount. }\n';
const PROV = { provider: 'blueverse', model: 'flow:f', requestId: 'r1' };

function panel(over: Partial<React.ComponentProps<typeof SuggestPanel>> = {}) {
  const onYamlChange = vi.fn();
  const onProvenance = vi.fn();
  render(
    <SuggestPanel yamlText={YAML} onYamlChange={onYamlChange} provenanceYaml={undefined} onProvenance={onProvenance} {...over} />,
  );
  return { onYamlChange, onProvenance };
}

describe('SuggestPanel', () => {
  it('is ABSENT when authoring is not configured: no panel, no button, no error', async () => {
    status.mockResolvedValue({ enabled: false, providers: [], defaultProvider: null });
    panel();
    await waitFor(() => expect(status).toHaveBeenCalled());
    expect(screen.queryByTestId('suggest-panel')).toBeNull();
    expect(screen.queryByRole('button', { name: /suggest/i })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('is also absent when the status call itself fails', async () => {
    status.mockRejectedValue(new Error('boom'));
    panel();
    await waitFor(() => expect(status).toHaveBeenCalled());
    expect(screen.queryByTestId('suggest-panel')).toBeNull();
  });

  it('lists providers, disabling one with no key stored', async () => {
    status.mockResolvedValue(ON);
    panel();
    const provider = (await screen.findByLabelText('Provider')) as HTMLSelectElement;
    expect(provider.value).toBe('blueverse');
    const claude = [...provider.options].find((o) => o.value === 'claude');
    expect(claude?.disabled).toBe(true);
    expect(claude?.textContent).toContain('no key stored');
  });

  it('only offers the allow-listed fields', async () => {
    status.mockResolvedValue(ON);
    panel();
    const field = (await screen.findByLabelText('Field')) as HTMLSelectElement;
    expect([...field.options].map((o) => o.value)).toEqual([
      'purpose',
      'disambiguation',
      'aliases',
      'input.desc',
      'input.example',
      'output.summaryTemplate',
      'writeSafety.confirm.planTemplate',
    ]);
  });

  it('shows exactly what would be sent and sends nothing', async () => {
    status.mockResolvedValue(ON);
    preview.mockResolvedValue({ ok: true, provider: 'blueverse', system: 'SYS', user: 'Field: purpose' });
    panel();
    fireEvent.click(await screen.findByRole('button', { name: 'Show what will be sent' }));
    expect((await screen.findByTestId('suggest-preview')).textContent).toContain('Nothing was sent');
    expect(screen.getByTestId('suggest-preview').textContent).toContain('Field: purpose');
    expect(suggest).not.toHaveBeenCalled();
  });

  it('a suggestion changes nothing until that one field is accepted, and acceptance reports provenance', async () => {
    status.mockResolvedValue(ON);
    suggest.mockResolvedValue({ ok: true, text: 'Find vouchers by supplier.', provenance: PROV });
    accept.mockResolvedValue({ ok: true, yaml: 'NEW', provenanceYaml: 'PROV', provenancePath: 'provenance/a.b.c.get.authoring.yaml' });
    const { onYamlChange, onProvenance } = panel();
    fireEvent.click(await screen.findByRole('button', { name: 'Suggest' }));
    expect((await screen.findByTestId('suggest-text')).textContent).toBe('Find vouchers by supplier.');
    expect(onYamlChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Accept this field' }));
    await waitFor(() => expect(onYamlChange).toHaveBeenCalledWith('NEW'));
    expect(onProvenance).toHaveBeenCalledWith('provenance/a.b.c.get.authoring.yaml', 'PROV');
    const sent = accept.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent['field']).toBe('purpose');
    expect(sent['text']).toBe('Find vouchers by supplier.');
    // the acceptor is never sent: the server stamps it from the session
    expect(sent).not.toHaveProperty('acceptedBy');
    expect((await screen.findByTestId('suggest-accepted')).textContent).toContain('purpose');
  });

  it('there is no accept-all', async () => {
    status.mockResolvedValue(ON);
    suggest.mockResolvedValue({ ok: true, text: 'x', provenance: PROV });
    panel();
    fireEvent.click(await screen.findByRole('button', { name: 'Suggest' }));
    await screen.findByTestId('suggest-text');
    expect(screen.queryByRole('button', { name: /accept all/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByTestId('suggest-text')).toBeNull();
  });

  it('a per-input field needs an input chosen before it can be asked', async () => {
    status.mockResolvedValue(ON);
    panel();
    fireEvent.change(await screen.findByLabelText('Field'), { target: { value: 'input.desc' } });
    expect((screen.getByRole('button', { name: 'Suggest' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Input'), { target: { value: 'amount' } });
    expect((screen.getByRole('button', { name: 'Suggest' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a refusal with its next and applies nothing', async () => {
    status.mockResolvedValue(ON);
    suggest.mockResolvedValue({ ok: false, code: 'AUTHORING_SENSITIVITY_BLOCKED', message: 'Provider "blueverse" is not allowed to see financial tools.', next: 'Write this copy by hand.' });
    const { onYamlChange } = panel();
    fireEvent.click(await screen.findByRole('button', { name: 'Suggest' }));
    expect((await screen.findByTestId('suggest-problem')).textContent).toContain('Write this copy by hand.');
    expect(onYamlChange).not.toHaveBeenCalled();
  });

  it('passes the linked request as context', async () => {
    status.mockResolvedValue(ON);
    suggest.mockResolvedValue({ ok: false, code: 'x', message: 'm', next: 'n' });
    panel({ request: { does: 'find vouchers by amount' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Suggest' }));
    await waitFor(() => expect(suggest).toHaveBeenCalled());
    expect((suggest.mock.calls[0]?.[0] as { request: { does: string } }).request.does).toBe('find vouchers by amount');
  });
});

describe('DraftEditor + Suggest: Save draft carries the provenance', () => {
  it('writes the accepted-field provenance beside the manifest, and nothing when nothing was accepted', async () => {
    status.mockResolvedValue(ON);
    suggest.mockResolvedValue({ ok: true, text: 'Find vouchers by supplier.', provenance: PROV });
    accept.mockResolvedValue({
      ok: true,
      yaml: NEW_DRAFT_TEMPLATE_YAML,
      provenanceYaml: 'kind: AuthoringProvenance\n',
      provenancePath: 'provenance/app.module.entity.verb.authoring.yaml',
    });
    const saveDraft = vi.fn().mockResolvedValue({ id: 'p', title: 't', branch: 'forge/build-x', baseBranch: 'main', state: 'draft', author: 'a', createdAt: 'x' });
    const host = { saveDraft } as unknown as ChangeHost;
    render(<DraftEditor draft={newBuildDraft()} host={host} />);

    fireEvent.click(screen.getByTestId('save-draft'));
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    expect(Object.keys((saveDraft.mock.calls[0]?.[0] as { files: object }).files)).toHaveLength(1);

    fireEvent.click(await screen.findByRole('button', { name: 'Suggest' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Accept this field' }));
    await screen.findByTestId('suggest-accepted');
    fireEvent.click(screen.getByTestId('save-draft'));
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(2));
    const files = (saveDraft.mock.calls[1]?.[0] as { files: Record<string, string> }).files;
    expect(Object.keys(files)).toContain('provenance/app.module.entity.verb.authoring.yaml');
    expect(Object.keys(files).filter((k) => k.startsWith('manifests/'))).toHaveLength(1);
  });
});
