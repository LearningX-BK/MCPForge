// @vitest-environment jsdom
//
// W0-Q3: "New module server" drafts a `*.server.yaml` through Save draft ·
// Propose · Discard (never a direct write), shows the split rule, warns on a
// duplicated module boundary, passes the REAL `forge validate`, and appears in
// W0-P6's inventory once merged.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fixtureProposal, stubHost } from '@/components/change/test-fixtures';
import type { ChangeHost } from '@/lib/change-host';

import { loadServerDefinitions } from '../environments/servers/load-servers';
import { ServerDraftEditor } from './_components/server-draft-editor';
import { loadExistingServers } from './_lib/existing-servers';
import { runFullDraftValidation as realValidate } from './_lib/repo-validate';
import {
  EMPTY_SERVER_FORM,
  boundaryWarnings,
  formFromYaml,
  formProblems,
  serverBranchFor,
  serverManifestPath,
  serverYaml,
  type ServerForm,
} from './_lib/server-draft';

vi.mock('./_lib/repo-validate', () => ({ runFullDraftValidation: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/build', useRouter: () => ({ refresh() {} }) }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const GOOD: ServerForm = {
  id: 'jde-hr-pay',
  label: 'JD Edwards — Payroll',
  app: 'jde',
  module: 'hr',
  version: '1.0.0',
  mode: 'A',
  promotionReason: '',
  owner: 'HR Engineering',
  steward: 'A. Person',
};

describe('server draft lib', () => {
  it('derives the manifest path and branch from the id', () => {
    expect(serverManifestPath('jde-hr-pay')).toBe('manifests/_servers/jde-hr-pay.server.yaml');
    expect(serverBranchFor('jde-hr-pay')).toBe('forge/build-server-jde-hr-pay');
  });
  it('round-trips form -> yaml -> form', () => {
    expect(formFromYaml(serverYaml(GOOD))).toEqual(GOOD);
  });
  it('requires a promotion reason only for Mode B, and never invents a steward', () => {
    expect(formProblems({ ...GOOD, mode: 'B' }).map((p) => p.field)).toEqual(['promotionReason']);
    expect(formProblems({ ...GOOD, steward: '' }).map((p) => p.field)).toEqual(['steward']);
    expect(formProblems(GOOD)).toEqual([]);
  });
  it('warns on a duplicated module boundary and an id collision', () => {
    const existing = loadExistingServers();
    expect(existing.map((s) => s.id)).toContain('jde-fin-ap');
    const dup = boundaryWarnings({ ...GOOD, app: 'jde', module: 'fin' }, existing);
    expect(dup.map((w) => w.kind)).toContain('same-module');
    expect(boundaryWarnings({ ...GOOD, id: 'jde-fin-ap' }, existing)[0]?.kind).toBe('same-id');
    expect(boundaryWarnings(GOOD, existing)).toEqual([]);
  });
});

describe('ServerDraftEditor', () => {
  const existing = loadExistingServers();

  it('puts the split rule on screen', () => {
    render(<ServerDraftEditor initial={EMPTY_SERVER_FORM} existing={existing} host={stubHost()} />);
    expect(screen.getByTestId('split-rule').textContent).toContain('15–20 tools');
  });

  it('Save draft hands the manifest to the ChangeHost on a server branch, and nothing else is written', async () => {
    const saveDraft = vi.fn(() => Promise.resolve(fixtureProposal({ branch: 'forge/build-server-jde-hr-pay' })));
    const host: ChangeHost = { ...stubHost(), saveDraft };
    render(<ServerDraftEditor initial={GOOD} existing={existing} host={host} />);
    fireEvent.click(screen.getByTestId('save-draft'));
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    expect(saveDraft).toHaveBeenCalledWith({
      title: 'jde-hr-pay: module server draft',
      branch: 'forge/build-server-jde-hr-pay',
      files: { 'manifests/_servers/jde-hr-pay.server.yaml': serverYaml(GOOD) },
    });
    await waitFor(() => expect(screen.getByTestId('draft-editor-status').textContent).toContain('Draft saved'));
    // Propose and Discard appear only after a draft exists.
    expect(screen.getByRole('button', { name: /^propose$/i })).not.toBeNull();
    expect(screen.getByTestId('discard-draft')).not.toBeNull();
  });

  it('refuses to save an incomplete draft, with a next', async () => {
    const saveDraft = vi.fn();
    render(<ServerDraftEditor initial={EMPTY_SERVER_FORM} existing={existing} host={{ ...stubHost(), saveDraft } as ChangeHost} />);
    fireEvent.click(screen.getByTestId('save-draft'));
    await waitFor(() => expect(screen.getByTestId('save-error').textContent).toContain('Next:'));
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('shows the duplicate-boundary warning but still allows a justified split; an id collision blocks', async () => {
    const saveDraft = vi.fn(() => Promise.resolve(fixtureProposal()));
    const host: ChangeHost = { ...stubHost(), saveDraft };
    const { unmount } = render(
      <ServerDraftEditor initial={{ ...GOOD, app: 'jde', module: 'fin' }} existing={existing} host={host} />,
    );
    expect(screen.getAllByTestId('boundary-same-module').length).toBe(2);
    fireEvent.click(screen.getByTestId('save-draft'));
    await waitFor(() => expect(saveDraft).toHaveBeenCalled());
    unmount();
    saveDraft.mockClear();
    render(<ServerDraftEditor initial={{ ...GOOD, id: 'jde-fin-ap' }} existing={existing} host={host} />);
    expect(screen.getByTestId('boundary-same-id')).not.toBeNull();
    fireEvent.click(screen.getByTestId('save-draft'));
    await waitFor(() => expect(screen.getByTestId('save-error')).not.toBeNull());
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('Discard confirms in the UI, then deletes the branch through the host', async () => {
    const discard = vi.fn(() => Promise.resolve());
    const host: ChangeHost = { ...stubHost(), discard };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ServerDraftEditor initial={GOOD} existing={existing} host={host} />);
    fireEvent.click(screen.getByTestId('save-draft'));
    const btn = await screen.findByTestId('discard-draft');
    fireEvent.click(btn);
    await waitFor(() => expect(discard).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('server-draft-discarded')).not.toBeNull();
  });

  it('shows the real validate result for this draft', async () => {
    const mod = await import('./_lib/repo-validate');
    vi.mocked(mod.runFullDraftValidation).mockResolvedValue({ ok: true, filesChecked: 9, failures: [], warnings: [] });
    render(<ServerDraftEditor initial={GOOD} existing={existing} host={stubHost()} />);
    fireEvent.click(screen.getByTestId('run-checks-button'));
    await waitFor(() => expect(screen.getByTestId('checks-verdict').textContent).toContain('no failures'));
    expect(mod.runFullDraftValidation).toHaveBeenCalledWith(
      'manifests/_servers/jde-hr-pay.server.yaml',
      serverYaml(GOOD),
    );
  });

  it('has no serious or critical axe violations', async () => {
    const { container } = render(<ServerDraftEditor initial={{ ...GOOD, app: 'jde', module: 'fin' }} existing={existing} host={stubHost()} />);
    const r = await axe(container);
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });
});

describe('the drafted manifest, against the real repo', () => {
  it('passes the real forge validate (no failures concern the draft)', async () => {
    const actual = await vi.importActual<typeof import('./_lib/repo-validate')>('./_lib/repo-validate');
    const r = await (realValidate === actual.runFullDraftValidation
      ? realValidate
      : actual.runFullDraftValidation)(serverManifestPath(GOOD.id), serverYaml(GOOD));
    expect(r.failures.filter((f) => f.concernsDraft)).toEqual([]);
  });

  it('a Mode B draft without a reason fails the real schema, so validate is a real gate', async () => {
    const actual = await vi.importActual<typeof import('./_lib/repo-validate')>('./_lib/repo-validate');
    const bad = serverYaml({ ...GOOD, mode: 'B', promotionReason: '' }).replace(/promotionReason:.*\n/, '');
    const r = await actual.runFullDraftValidation(serverManifestPath(GOOD.id), bad);
    expect(r.failures.some((f) => f.concernsDraft)).toBe(true);
  });

  it('once merged, the server is in W0-P6\'s inventory', () => {
    const root = mkdtempSync(join(tmpdir(), 'q3-inv-'));
    try {
      mkdirSync(join(root, 'manifests', '_servers'), { recursive: true });
      writeFileSync(join(root, serverManifestPath(GOOD.id)), serverYaml(GOOD));
      const inv = loadServerDefinitions(root);
      expect(inv.map((s) => s.id)).toEqual(['jde-hr-pay']);
      expect(inv[0]).toMatchObject({ mode: 'A', version: '1.0.0', owner: 'HR Engineering', toolIds: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
