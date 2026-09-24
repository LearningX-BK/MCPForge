// @vitest-environment jsdom
//
// MCPForge — W0-N12: the Governance → Consumers components.
//
// The editor's compile seam is INJECTED here rather than run for real —
// `../_lib/compile-consumer.test.ts` is where the compile itself is proved
// real, against a direct call to `compileConsumerAuthorization`. What these
// tests prove is the other half: that the component renders only what the
// compiler returned, that a widened record changes the rendered authorization,
// that nothing saves directly, that the expiry chips sit on 03 §16.2's
// thresholds, and that Suspend and Retire carry the friction 03 §16.2 and
// §7.3 require.
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChangeHost, ChangeProposal } from '@/lib/change-host';

import { CompiledAuthorization } from './compiled-authorization';
import { ConsumerActions } from './consumer-actions';
import { ConsumerEditor } from './consumer-editor';
import { ConsumersTab } from './consumers-tab';
import { ElevatedGrantPanel } from './elevated-grant-panel';
import { RegistryTable } from './registry-table';
import { grantRow } from '../_lib/authorization-view';
import type { CompiledConsumerDraft, ConsumerRowView, ConsumerSource } from '../types';

afterEach(cleanup);

const TODAY = '2026-09-10';

const row: ConsumerRowView = {
  consumerId: 'claude-desktop-fin',
  label: 'Claude Desktop — finance',
  consumerClass: 'interactive-client',
  owner: 'oracle-ai-practice',
  steward: 'meera.rao',
  status: 'active',
  effectiveStatus: 'active',
  expiresAt: '2027-01-31',
  credentialAgeDays: 12,
  nextRotationDue: '2026-12-01',
  rotationDueInDays: 82,
};

const source: ConsumerSource = {
  consumerId: 'claude-desktop-fin',
  label: 'Claude Desktop — finance',
  path: 'consumers/claude-desktop-fin.consumer.yaml',
  yamlText: 'kind: Consumer\nid: claude-desktop-fin\n',
  artefactPath: 'generated/consumers/claude-desktop-fin.authorization.json',
  mergedArtefactJson: '{}',
  isNew: false,
  row,
};

function compiled(over: Partial<CompiledConsumerDraft> = {}): CompiledConsumerDraft {
  return {
    consumerId: 'claude-desktop-fin',
    artefactJson: '{"consumerId":"claude-desktop-fin"}\n',
    label: 'Claude Desktop — finance',
    consumerClass: 'interactive-client',
    status: 'active',
    effectiveStatus: 'active',
    expiresAt: '2027-01-31',
    expired: false,
    bindingTypes: ['rest'],
    maxSensitivity: 'internal',
    writeAllowed: false,
    roles: ['p2p'],
    packages: [],
    limits: [{ field: 'callsPerMinute', value: '60' }],
    humanInTheLoop: true,
    networkOrigins: [],
    grants: [],
    listDeltas: [
      { field: 'bindingTypes', values: ['rest'], added: [], removed: [] },
      { field: 'roles', values: ['p2p'], added: [], removed: [] },
      { field: 'packages', values: [], added: [], removed: [] },
      { field: 'networkOrigins', values: [], added: [], removed: [] },
    ],
    scalarDeltas: [],
    ...over,
  };
}

describe('ConsumerEditor — the compiled authorization is explicit, and live', () => {
  it('renders the authorization the compiler returned, not the authored YAML', async () => {
    const compile = vi.fn().mockResolvedValue(compiled());
    render(<ConsumerEditor source={source} compile={compile} />);
    await waitFor(() => expect(compile).toHaveBeenCalled(), { timeout: 3000 });
    await screen.findByTestId('compiled-authorization');
    expect(screen.getByTestId('auth-max-sensitivity').textContent).toBe('internal');
    expect(screen.getByTestId('auth-write-allowed').textContent).toBe('not allowed');
    expect(screen.getByTestId('compile-state').textContent).toBe(source.artefactPath);
  });

  it('editing the record recompiles and the rendered authorization CHANGES', async () => {
    const compile = vi
      .fn()
      .mockResolvedValueOnce(compiled())
      .mockResolvedValue(
        compiled({
          bindingTypes: ['plsql', 'rest'],
          writeAllowed: true,
          maxSensitivity: 'financial',
          listDeltas: [
            {
              field: 'bindingTypes',
              values: ['plsql', 'rest'],
              added: ['plsql'],
              removed: [],
            },
            { field: 'roles', values: [], added: [], removed: ['p2p'] },
            { field: 'packages', values: [], added: [], removed: [] },
            { field: 'networkOrigins', values: [], added: [], removed: [] },
          ],
          scalarDeltas: [
            { field: 'writeAllowed', before: 'false', after: 'true' },
            { field: 'maxSensitivity', before: 'internal', after: 'financial' },
          ],
        }),
      );
    render(<ConsumerEditor source={source} compile={compile} />);
    await screen.findByTestId('compiled-authorization');

    fireEvent.change(screen.getByTestId('consumer-yaml'), {
      target: { value: 'kind: Consumer\nid: claude-desktop-fin\nstatus: active\n' },
    });

    await waitFor(
      () => expect(screen.getByTestId('auth-write-allowed').textContent).toBe('allowed'),
      { timeout: 3000 },
    );
    // A widening is marked as an addition…
    const added = screen.getAllByTestId('auth-value-added');
    expect(added.map((el) => el.getAttribute('data-value'))).toEqual(['plsql']);
    // …and a narrowing is still SHOWN, struck through, never silently gone.
    const removed = screen.getAllByTestId('auth-value-removed');
    expect(removed.map((el) => el.getAttribute('data-value'))).toEqual(['p2p']);
    expect(screen.getByTestId('auth-scalar-writeAllowed').textContent).toContain('false → true');
    expect(screen.getByTestId('auth-scalar-maxSensitivity').textContent).toContain(
      'internal → financial',
    );
    // The compiler was asked about the EDITED text, not the original.
    expect(compile).toHaveBeenLastCalledWith(
      'claude-desktop-fin',
      'kind: Consumer\nid: claude-desktop-fin\nstatus: active\n',
      '{}',
    );
  });

  it('shows no authorization at all when the edit does not compile', async () => {
    const compile = vi
      .fn()
      .mockResolvedValueOnce(compiled())
      .mockResolvedValue(
        compiled({
          error: {
            message: 'did not compile',
            next: 'Fix consumers/claude-desktop-fin.consumer.yaml.',
          },
        }),
      );
    render(<ConsumerEditor source={source} compile={compile} />);
    await screen.findByTestId('compiled-authorization');

    fireEvent.change(screen.getByTestId('consumer-yaml'), { target: { value: 'broken' } });
    await screen.findByTestId('compile-error');
    expect(screen.queryByTestId('compiled-authorization')).toBeNull();
    expect(screen.queryByTestId('elevated-grant-panel')).toBeNull();
    expect(
      screen.getByText('Fix consumers/claude-desktop-fin.consumer.yaml.'),
    ).toBeTruthy();
  });
});

describe('ConsumerEditor — nothing saves directly', () => {
  it('has no Save/Submit/Publish/Apply button, only Save draft and Discard', async () => {
    const compile = vi.fn().mockResolvedValue(compiled());
    render(<ConsumerEditor source={source} compile={compile} />);
    await screen.findByTestId('compiled-authorization');
    for (const word of ['Save', 'Submit', 'Publish', 'Apply', 'Commit', 'Push', 'Suspend']) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${word}$`, 'i') })).toBeNull();
    }
    expect(screen.getByTestId('save-draft').textContent).toBe('Save draft');
    expect(screen.getByTestId('discard').textContent).toBe('Discard');
  });

  it('Save draft is disabled until the edit compiles AND differs', async () => {
    const compile = vi.fn().mockResolvedValue(compiled());
    render(<ConsumerEditor source={source} compile={compile} />);
    await screen.findByTestId('compiled-authorization');
    expect((screen.getByTestId('save-draft') as HTMLButtonElement).disabled).toBe(true);
  });

  it('hands the change host the edited record AND the compiled authorization artefact', async () => {
    const saveDraft = vi.fn().mockResolvedValue({
      id: 'c1',
      title: 't',
      branch: 'forge/consumer-claude-desktop-fin',
      baseBranch: 'main',
      state: 'draft',
      author: 'portal',
      createdAt: '2026-09-10',
    } satisfies ChangeProposal);
    const host = { saveDraft } as unknown as ChangeHost;
    const compile = vi
      .fn()
      .mockResolvedValue(compiled({ artefactJson: '{"authorizations":{"writeAllowed":true}}\n' }));

    render(<ConsumerEditor source={source} compile={compile} host={host} />);
    await screen.findByTestId('compiled-authorization');
    fireEvent.change(screen.getByTestId('consumer-yaml'), {
      target: { value: 'kind: Consumer\nid: claude-desktop-fin\nstatus: suspended\n' },
    });
    await waitFor(() =>
      expect((screen.getByTestId('save-draft') as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(screen.getByTestId('save-draft'));
    await waitFor(() => expect(saveDraft).toHaveBeenCalled());

    const call = saveDraft.mock.calls[0]![0] as { files: Record<string, string>; branch: string };
    expect(Object.keys(call.files).sort()).toEqual([
      'consumers/claude-desktop-fin.consumer.yaml',
      'generated/consumers/claude-desktop-fin.authorization.json',
    ]);
    // The proposal's diff IS the compiled artefact — these are the compiler's bytes.
    expect(call.files['generated/consumers/claude-desktop-fin.authorization.json']).toBe(
      '{"authorizations":{"writeAllowed":true}}\n',
    );
    expect(call.branch).toBe('forge/consumer-claude-desktop-fin');
  });

  it('names the change host failure with an actionable next instead of failing silently', async () => {
    const host = {
      saveDraft: vi.fn().mockRejectedValue({ message: 'branch exists' }),
    } as unknown as ChangeHost;
    const compile = vi.fn().mockResolvedValue(compiled());
    render(<ConsumerEditor source={source} compile={compile} host={host} />);
    await screen.findByTestId('compiled-authorization');
    fireEvent.change(screen.getByTestId('consumer-yaml'), { target: { value: 'kind: Consumer\n' } });
    await waitFor(() =>
      expect((screen.getByTestId('save-draft') as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId('save-draft'));
    const alert = await screen.findByTestId('save-error');
    expect(alert.textContent).toContain('branch exists');
    expect(alert.textContent?.toLowerCase()).not.toContain('try again');
  });
});

describe('ElevatedGrantPanel — standing authorization, approver, expiry, chipped', () => {
  it('shows each grant with its approver, approval record and expiry', () => {
    const grant = grantRow(
      {
        bindingType: 'plsql',
        names: ['MCPFORGE_WRAP.AP_VOUCHER'],
        approvalRef: 'APR-2026-009',
        approver: 'priya.n',
        expiresAt: '2027-01-01',
        expired: false,
      },
      TODAY,
    )!;
    render(<ElevatedGrantPanel grants={[grant]} />);
    expect(screen.getByTestId('grant-approver').textContent).toBe('priya.n');
    expect(screen.getByTestId('grant-approval-ref').textContent).toBe('APR-2026-009');
    expect(screen.getByTestId('grant-expires-at').textContent).toBe('2027-01-01');
    expect(screen.getByTestId('grant-standing').getAttribute('data-standing-status')).toBe('none');
  });

  it('chips --status-write inside 30 days of expiry and --status-danger past it', () => {
    const expiring = grantRow(
      { bindingType: 'plsql', approvalRef: 'a', expiresAt: '2026-09-30', expired: false },
      TODAY,
    )!;
    const dead = grantRow(
      { bindingType: 'function', approvalRef: 'b', expiresAt: '2026-01-01', expired: true },
      TODAY,
    )!;
    const live = grantRow(
      { bindingType: 'rest', approvalRef: 'c', expiresAt: '2027-06-01', expired: false },
      TODAY,
    )!;
    render(<ElevatedGrantPanel grants={[live, expiring, dead]} />);

    const rows = screen.getAllByTestId('grant-row');
    // Expired first, then expiring — the order an operator needs.
    expect(rows.map((r) => r.getAttribute('data-expiry-token'))).toEqual([
      'status-danger',
      'status-write',
      'status-ok',
    ]);
    expect(rows.map((r) => r.getAttribute('data-expiry-state'))).toEqual([
      'expired',
      'expiring',
      'live',
    ]);
  });

  it('renders the standing authorization with its approver, own expiry and state', () => {
    const grant = grantRow(
      {
        bindingType: 'plsql',
        approvalRef: 'APR-2026-009',
        approver: 'priya.n',
        expiresAt: '2027-01-01',
        expired: false,
        standingAuthorization: {
          ref: 'APR-2026-014',
          status: 'active',
          approver: 'meera.rao',
          expiresAt: '2027-03-01',
          effective: true,
        },
      },
      TODAY,
    )!;
    render(<ElevatedGrantPanel grants={[grant]} />);
    expect(screen.getByTestId('standing-approver').textContent).toBe('meera.rao');
    expect(screen.getByTestId('standing-expires-at').textContent).toBe('2027-03-01');
    expect(screen.getByTestId('standing-status').textContent).toBe('active');
    expect(screen.getByTestId('grant-standing').getAttribute('data-standing-token')).toBe(
      'status-ok',
    );
  });

  it('an INEFFECTIVE standing authorization is chipped danger and says what happens instead', () => {
    const grant = grantRow(
      {
        bindingType: 'plsql',
        approvalRef: 'APR-2026-009',
        approver: 'priya.n',
        expiresAt: '2027-01-01',
        expired: false,
        standingAuthorization: {
          ref: 'APR-missing',
          status: 'unresolved',
          approver: '',
          expiresAt: '',
          effective: false,
        },
      },
      TODAY,
    )!;
    render(<ElevatedGrantPanel grants={[grant]} />);
    expect(screen.getByTestId('grant-standing').getAttribute('data-standing-token')).toBe(
      'status-danger',
    );
    expect(screen.getByTestId('grant-standing').textContent).toContain(
      'reverts to a per-call human approval',
    );
  });

  it('says plainly that no grant means no elevated binding, rather than showing nothing', () => {
    render(<ElevatedGrantPanel grants={[]} />);
    expect(screen.getByTestId('elevated-grants-empty').textContent).toContain(
      'holds no elevated binding grant',
    );
  });
});

describe('RegistryTable — 03 §16.2\'s nine columns, and the effective status', () => {
  it('renders every declared column', () => {
    render(<RegistryTable rows={[row]} />);
    const table = screen.getByTestId('registry-table');
    for (const header of [
      'Id',
      'Label',
      'Class',
      'Owner',
      'Steward',
      'Status',
      'Registration expires',
      'Credential age',
      'Next rotation due',
    ]) {
      expect(table.textContent).toContain(header);
    }
    expect(table.textContent).toContain('meera.rao');
    expect(table.textContent).toContain('12 days');
  });

  it('shows the EFFECTIVE status, and names the authored one when they differ', () => {
    render(
      <RegistryTable
        rows={[{ ...row, status: 'active', effectiveStatus: 'expired', expiresAt: '2026-01-01' }]}
      />,
    );
    expect(screen.getByTestId('registry-table').textContent).toContain('Expired');
    expect(
      screen.getByTestId('registry-authored-status-claude-desktop-fin').textContent,
    ).toContain('active');
  });

  it('marks an overdue rotation with the danger token, and one inside 30 days with write', () => {
    render(
      <RegistryTable
        rows={[
          { ...row, consumerId: 'a', rotationDueInDays: -3, nextRotationDue: '2026-09-07' },
          { ...row, consumerId: 'b', rotationDueInDays: 5, nextRotationDue: '2026-09-15' },
          { ...row, consumerId: 'c', rotationDueInDays: 90, nextRotationDue: '2026-12-09' },
        ]}
      />,
    );
    expect(screen.getByTestId('registry-rotation-a').className).toContain('status-danger');
    expect(screen.getByTestId('registry-rotation-a').textContent).toContain('overdue by 3 days');
    expect(screen.getByTestId('registry-rotation-b').className).toContain('status-write');
    expect(screen.getByTestId('registry-rotation-c').className).not.toContain('status-');
  });

  it('an unreadable record is a visible row, never a silently missing one', () => {
    render(
      <RegistryTable
        rows={[]}
        failures={[
          {
            ...row,
            consumerId: 'consumers/broken.consumer.yaml',
            loadError: 'credential.ref must be a secretRef:// URI',
          },
        ]}
      />,
    );
    const failure = screen.getByTestId('registry-load-failure');
    expect(failure.textContent).toContain('consumers/broken.consumer.yaml');
    expect(failure.textContent).toContain('secretRef://');
  });

  it('an empty registry says what that MEANS, not just that it is empty', () => {
    render(<RegistryTable rows={[]} />);
    expect(screen.getByTestId('registry-empty').textContent).toContain('CONSUMER_UNREGISTERED');
  });
});

describe('ConsumerActions — Suspend is a kill-switch act; Retire is type-to-confirm', () => {
  it('refuses a consumer-scope suspend with no reason, and fires immediately once given', () => {
    const onKill = vi.fn();
    render(
      <ConsumerActions
        consumerId="claude-desktop-fin"
        deploymentId="local"
        envClass="local"
        onKill={onKill}
      />,
    );
    const button = screen.getByTestId('consumer-kill-confirm') as HTMLButtonElement;
    // Really disabled — the DOM attribute, not a class that looks disabled.
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onKill).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('consumer-kill-reason'), {
      target: { value: 'Suspected credential compromise' },
    });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onKill).toHaveBeenCalledWith({
      scope: 'consumer',
      target: 'claude-desktop-fin',
      reason: 'Suspected credential compromise',
    });
  });

  it('a consumer-scope suspend is NOT type-to-confirm — the speed is the point', () => {
    render(<ConsumerActions consumerId="claude-desktop-fin" deploymentId="local" envClass="local" />);
    expect(screen.queryByTestId('consumer-kill-deployment-confirm')).toBeNull();
    expect(screen.getByTestId('consumer-kill-confirm')).toBeTruthy();
  });

  it('a DEPLOYMENT-scope suspend requires typing the deployment id before it can fire', async () => {
    const onKill = vi.fn();
    render(
      <ConsumerActions
        consumerId="claude-desktop-fin"
        deploymentId="local"
        envClass="local"
        onKill={onKill}
      />,
    );
    fireEvent.click(screen.getByTestId('consumer-kill-deployment-scope'));
    fireEvent.change(screen.getByTestId('consumer-kill-reason'), {
      target: { value: 'Suspected platform-wide compromise' },
    });

    const confirm = screen.getByTestId('consumer-kill-deployment-confirm');
    expect(confirm.querySelector('[data-variant]')?.getAttribute('data-variant')).toBe(
      'type-to-confirm',
    );
    const button = confirm.querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onKill).not.toHaveBeenCalled();

    const field = confirm.querySelector('input') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'local' } });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    expect(onKill).toHaveBeenCalledWith({
      scope: 'deployment',
      target: 'local',
      reason: 'Suspected platform-wide compromise',
    });
  });

  it('Retire is type-to-confirm on the consumer id, and produces a proposal not a kill', async () => {
    const onProposeLifecycle = vi.fn();
    const onKill = vi.fn();
    render(
      <ConsumerActions
        consumerId="claude-desktop-fin"
        deploymentId="local"
        envClass="local"
        onKill={onKill}
        onProposeLifecycle={onProposeLifecycle}
      />,
    );
    const confirm = screen.getByTestId('consumer-retire-confirm');
    expect(confirm.querySelector('[data-variant]')?.getAttribute('data-variant')).toBe(
      'type-to-confirm',
    );
    const button = confirm.querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    const field = confirm.querySelector('input') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'wrong-id' } });
    expect(button.disabled).toBe(true);
    fireEvent.change(field, { target: { value: 'claude-desktop-fin' } });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    expect(onProposeLifecycle).toHaveBeenCalledWith('retire');
    expect(onKill).not.toHaveBeenCalled();
  });

  it('rotating a credential is a proposal, and the panel never shows a credential value', () => {
    const onProposeLifecycle = vi.fn();
    render(
      <ConsumerActions
        consumerId="claude-desktop-fin"
        deploymentId="local"
        envClass="local"
        onProposeLifecycle={onProposeLifecycle}
      />,
    );
    fireEvent.click(screen.getByTestId('consumer-rotate'));
    expect(onProposeLifecycle).toHaveBeenCalledWith('rotate-credential');
    expect(screen.getByTestId('consumer-actions').textContent).toContain('never appears');
  });
});

describe('ConsumersTab — the table selects, the editor edits, Register scaffolds', () => {
  it('opens on the first consumer and switches when another is selected', async () => {
    const second: ConsumerSource = {
      ...source,
      consumerId: 'batch-r2r',
      label: 'Batch — record to report',
      path: 'consumers/batch-r2r.consumer.yaml',
      artefactPath: 'generated/consumers/batch-r2r.authorization.json',
      row: { ...row, consumerId: 'batch-r2r', label: 'Batch — record to report' },
    };
    const compile = vi.fn().mockResolvedValue(compiled());
    render(
      <ConsumersTab
        sources={[source, second]}
        compile={compile}
        scaffold={vi.fn()}
        deploymentId="local"
        envClass="local"
      />,
    );
    await waitFor(() => expect(compile).toHaveBeenCalled());
    expect(compile.mock.calls[0]![0]).toBe('claude-desktop-fin');

    fireEvent.click(screen.getByTestId('registry-select-batch-r2r'));
    await waitFor(() =>
      expect(compile.mock.calls.some((c) => c[0] === 'batch-r2r')).toBe(true),
    );
  });

  it('Register opens a scaffolded record in the editor and writes nothing', async () => {
    const scaffolded: ConsumerSource = {
      ...source,
      consumerId: 'new-agent',
      label: 'new-agent',
      path: 'consumers/new-agent.consumer.yaml',
      artefactPath: 'generated/consumers/new-agent.authorization.json',
      mergedArtefactJson: '',
      isNew: true,
      row: { ...row, consumerId: 'new-agent', label: 'new-agent' },
    };
    const scaffold = vi.fn().mockResolvedValue({ source: scaffolded });
    const compile = vi.fn().mockResolvedValue(compiled());
    render(
      <ConsumersTab
        sources={[]}
        compile={compile}
        scaffold={scaffold}
        deploymentId="local"
        envClass="local"
      />,
    );
    expect(screen.getByTestId('registry-empty')).toBeTruthy();

    fireEvent.change(screen.getByTestId('consumer-new-id'), { target: { value: 'new-agent' } });
    fireEvent.click(screen.getByTestId('consumer-register'));
    await screen.findByTestId('consumer-is-new');
    expect(scaffold).toHaveBeenCalledWith('new-agent');
    // The registry now shows it, and the only outward action is still a draft.
    expect(screen.getByTestId('registry-row').getAttribute('data-consumer-id')).toBe('new-agent');
    expect(screen.getByTestId('save-draft').textContent).toBe('Save draft');
  });

  it('a refused id is explained with an actionable next, not swallowed', async () => {
    const scaffold = vi.fn().mockResolvedValue({
      error: { message: '"Bad Id" is not a usable consumer id.', next: 'Use a lower-case slug.' },
    });
    render(
      <ConsumersTab
        sources={[]}
        compile={vi.fn()}
        scaffold={scaffold}
        deploymentId="local"
        envClass="local"
      />,
    );
    fireEvent.change(screen.getByTestId('consumer-new-id'), { target: { value: 'Bad Id' } });
    fireEvent.click(screen.getByTestId('consumer-register'));
    const alert = await screen.findByTestId('register-error');
    expect(alert.textContent).toContain('not a usable consumer id');
    expect(alert.textContent).toContain('Use a lower-case slug.');
  });
});

describe('CompiledAuthorization — never a stale or synthesised pane', () => {
  it('says "not yet compiled" rather than showing an empty authorization', () => {
    render(
      <CompiledAuthorization draft={undefined} compiling={false} artefactPath="generated/x.json" />,
    );
    expect(screen.getByTestId('compile-state').textContent).toBe('not yet compiled');
    expect(screen.queryByTestId('compiled-authorization')).toBeNull();
  });

  it('carries the artefact bytes the proposal will contain', () => {
    render(
      <CompiledAuthorization
        draft={compiled({ artefactJson: '{"consumerId":"x"}\n' })}
        compiling={false}
        artefactPath="generated/x.json"
      />,
    );
    expect(screen.getByTestId('artefact-json').textContent).toBe('{"consumerId":"x"}\n');
  });
});
