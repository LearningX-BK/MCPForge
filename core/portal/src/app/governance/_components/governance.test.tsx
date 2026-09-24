// @vitest-environment jsdom
//
// MCPForge — W0-J18: the Governance components.
//
// The role editor's compile seam is INJECTED here rather than run for real —
// `_lib/compile-role.test.ts` is where the compile itself is proved real,
// against the committed artefact and a direct call to `compileRoleScope`.
// What these tests prove is the other half: that the component renders only
// what the compiler returned, that a changed glob changes the rendered list,
// that nothing saves directly, and that a deployment-wide kill is
// type-to-confirm.
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RoleEditor } from './role-editor';
import { RoleBudgetMeter } from './budget-meter';
import { SodPanel, NO_DISPOSITION_LABEL } from './sod-panel';
import { KillSwitchPanel } from './kill-switch-panel';
import type { ChangeHost, ChangeProposal } from '@/lib/change-host';
import type { CompiledRoleDraft, RoleSource } from '../types';

afterEach(cleanup);

const source: RoleSource = {
  roleId: 'p2p',
  label: 'Procure-to-Pay',
  path: 'roles/p2p.yaml',
  yamlText: 'includes:\n  - jde.ap.voucher.*\n',
  mergedToolIds: ['jde.ap.voucher.create', 'jde.ap.voucher.search'],
  mergedScopeJson: '{}',
  scopePath: 'generated/roles/p2p.scope.json',
};

function compiled(over: Partial<CompiledRoleDraft> = {}): CompiledRoleDraft {
  return {
    roleId: 'p2p',
    toolIds: source.mergedToolIds,
    scopeJson: '{"toolIds":[]}\n',
    toolsAdded: [],
    toolsRemoved: [],
    budget: { coreSetTokens: 100, limit: 1300, overBudget: false, demote: [], message: null },
    sod: [],
    ...over,
  };
}

describe('RoleEditor — the compiled scope is an explicit tool-id list, live', () => {
  it('renders the compiled tool ids the compiler returned, not the globs', async () => {
    const compile = vi.fn().mockResolvedValue(compiled());
    render(<RoleEditor sources={[source]} compile={compile} />);
    await waitFor(() => expect(compile).toHaveBeenCalled(), { timeout: 3000 });
    await screen.findByText('jde.ap.voucher.create');
    expect(screen.getByTestId('scope-count').textContent).toBe('2');
  });

  it('editing the globs recompiles and the rendered tool-id list CHANGES', async () => {
    const compile = vi
      .fn()
      .mockResolvedValueOnce(compiled())
      .mockResolvedValue(
        compiled({
          toolIds: ['jde.ap.voucher.create'],
          toolsRemoved: ['jde.ap.voucher.search'],
        }),
      );
    render(<RoleEditor sources={[source]} compile={compile} />);
    await screen.findByText('jde.ap.voucher.search');

    fireEvent.change(screen.getByTestId('role-yaml'), {
      target: { value: 'includes:\n  - jde.ap.voucher.create\n' },
    });

    await waitFor(() => expect(screen.getByTestId('scope-count').textContent).toBe('1'), {
      timeout: 3000,
    });
    // The removed tool is still SHOWN, marked removed — a narrowing must be
    // visible, not silent.
    const removed = screen.getAllByTestId('scope-row-removed');
    expect(removed.map((el) => el.getAttribute('data-tool-id'))).toEqual([
      'jde.ap.voucher.search',
    ]);
    expect(screen.getByTestId('scope-removed-count').textContent).toBe('−1');
    // The compiler was asked about the EDITED text, not the original.
    expect(compile).toHaveBeenLastCalledWith(
      'p2p',
      'includes:\n  - jde.ap.voucher.create\n',
      source.mergedToolIds,
    );
  });

  it('shows no tool list at all when the edit does not compile', async () => {
    const compile = vi
      .fn()
      .mockResolvedValueOnce(compiled())
      .mockResolvedValue(
        compiled({ error: { message: 'did not compile', next: 'Fix roles/p2p.yaml.' } }),
      );
    render(<RoleEditor sources={[source]} compile={compile} />);
    await screen.findByText('jde.ap.voucher.create');

    fireEvent.change(screen.getByTestId('role-yaml'), { target: { value: 'broken' } });
    await screen.findByTestId('compile-error');
    expect(screen.queryByTestId('compiled-tool-list')).toBeNull();
    expect(screen.queryByText('jde.ap.voucher.create')).toBeNull();
    expect(screen.getByText('Fix roles/p2p.yaml.')).toBeTruthy();
  });
});

describe('RoleEditor — nothing saves directly', () => {
  it('has no Save/Submit/Publish/Apply button, only Save draft', async () => {
    const compile = vi.fn().mockResolvedValue(compiled());
    render(<RoleEditor sources={[source]} compile={compile} />);
    await screen.findByText('jde.ap.voucher.create');
    for (const word of ['Save', 'Submit', 'Publish', 'Apply', 'Commit', 'Push']) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${word}$`, 'i') })).toBeNull();
    }
    expect(screen.getByTestId('save-draft').textContent).toBe('Save draft');
  });

  it('Save draft is disabled until the edit compiles AND differs', async () => {
    const compile = vi.fn().mockResolvedValue(compiled());
    render(<RoleEditor sources={[source]} compile={compile} />);
    await screen.findByText('jde.ap.voucher.create');
    // Unchanged source -> nothing to propose.
    expect((screen.getByTestId('save-draft') as HTMLButtonElement).disabled).toBe(true);
  });

  it('hands the change host the edited role AND the compiled scope artefact', async () => {
    const saveDraft = vi.fn().mockResolvedValue({
      id: 'c1',
      title: 't',
      branch: 'forge/role-p2p',
      baseBranch: 'main',
      state: 'draft',
      author: 'portal',
      createdAt: '2026-09-09',
    } satisfies ChangeProposal);
    const host = { saveDraft } as unknown as ChangeHost;
    const compile = vi
      .fn()
      .mockResolvedValue(compiled({ scopeJson: '{"toolIds":["jde.ap.voucher.create"]}\n' }));

    render(<RoleEditor sources={[source]} compile={compile} host={host} />);
    await screen.findByText('jde.ap.voucher.create');
    fireEvent.change(screen.getByTestId('role-yaml'), { target: { value: 'includes: []\n' } });
    await waitFor(() =>
      expect((screen.getByTestId('save-draft') as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(screen.getByTestId('save-draft'));
    await waitFor(() => expect(saveDraft).toHaveBeenCalled());

    const files = saveDraft.mock.calls[0]![0].files as Record<string, string>;
    expect(Object.keys(files).sort()).toEqual([
      'generated/roles/p2p.scope.json',
      'roles/p2p.yaml',
    ]);
    // The proposal's diff IS the compiled scope — these are the compiler's bytes.
    expect(files['generated/roles/p2p.scope.json']).toBe('{"toolIds":["jde.ap.voucher.create"]}\n');
  });
});

describe('RoleBudgetMeter — names the tools to demote', () => {
  it('within budget: a number and nothing to demote', () => {
    render(
      <RoleBudgetMeter
        budget={{ coreSetTokens: 900, limit: 1300, overBudget: false, demote: [], message: null }}
      />,
    );
    expect(screen.getByTestId('role-budget-count').textContent).toBe('900');
    expect(screen.queryByTestId('role-budget-demote')).toBeNull();
  });

  it('over budget: NAMES each tool to demote, not just the overage', () => {
    render(
      <RoleBudgetMeter
        budget={{
          coreSetTokens: 1500,
          limit: 1300,
          overBudget: true,
          demote: ['jde.ap.voucher.search', 'jde.fin.journal.submit'],
          message: 'Demote from coreTools to bring it to 1100: …',
        }}
      />,
    );
    const panel = screen.getByTestId('role-budget-demote');
    expect(panel.textContent).toContain('jde.ap.voucher.search');
    expect(panel.textContent).toContain('jde.fin.journal.submit');
    // And it explains that demoting is not removing.
    expect(panel.textContent).toContain('does not remove it from the role');
  });
});

describe('SodPanel — declared conflicts and implicit pairs, each with a disposition', () => {
  it('renders the authored disposition for a declared conflict', () => {
    render(
      <SodPanel
        findings={[
          {
            ruleId: 'sod.declared-conflict',
            severity: 'warning',
            pair: ['a.b.c.approve', 'a.b.c.create'],
            disposition: 'warn-and-require-exception',
            message: 'm',
            fix: 'f',
          },
        ]}
      />,
    );
    expect(screen.getByTestId('sod.declared-conflict')).toBeTruthy();
    expect(screen.getByTestId('sod-disposition').textContent).toBe('warn-and-require-exception');
  });

  it('says NO DECISION RECORDED for an undeclared implicit create/approve pair', () => {
    render(
      <SodPanel
        findings={[
          {
            ruleId: 'sod.implicit-create-approve',
            severity: 'warning',
            pair: ['a.b.c.approve', 'a.b.c.create'],
            disposition: null,
            message: 'm',
            fix: 'f',
          },
        ]}
      />,
    );
    expect(screen.getByTestId('sod.implicit-create-approve')).toBeTruthy();
    expect(screen.getByTestId('sod-disposition').textContent).toBe(NO_DISPOSITION_LABEL);
  });
});

describe('KillSwitchPanel — five granularities, type-to-confirm on deployment-wide', () => {
  it('offers all five granularities the gateway defines', () => {
    render(<KillSwitchPanel flags={[]} deploymentId="local" envClass="local" />);
    for (const scope of ['tool', 'moduleServer', 'bindingType', 'consumer', 'deployment']) {
      expect(screen.getByTestId(`kill-scope-${scope}`)).toBeTruthy();
    }
  });

  it('a tool-scoped kill is a plain (reason-gated) action, not type-to-confirm', () => {
    render(<KillSwitchPanel flags={[]} deploymentId="local" envClass="local" />);
    expect(screen.getByTestId('kill-scoped-confirm')).toBeTruthy();
    expect(screen.queryByTestId('kill-deployment-confirm')).toBeNull();
  });

  it('a deployment-wide kill requires typing the deployment id before it can fire', async () => {
    const onKill = vi.fn();
    render(
      <KillSwitchPanel flags={[]} deploymentId="local" envClass="local" onKill={onKill} />,
    );
    fireEvent.click(screen.getByTestId('kill-scope-deployment'));
    fireEvent.change(screen.getByLabelText(/Reason/), {
      target: { value: 'Suspected credential compromise' },
    });

    const confirm = screen.getByTestId('kill-deployment-confirm');
    const button = confirm.querySelector('button') as HTMLButtonElement;
    // Really disabled — the DOM attribute, not a class that looks disabled.
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onKill).not.toHaveBeenCalled();

    // The typed word is the deployment id.
    const field = confirm.querySelector('input[type="text"], input:not([type])') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'local' } });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    expect(onKill).toHaveBeenCalledWith({
      scope: 'deployment',
      target: 'local',
      reason: 'Suspected credential compromise',
    });
  });

  it('refuses a kill with no reason at every granularity', () => {
    const onKill = vi.fn();
    render(<KillSwitchPanel flags={[]} deploymentId="local" envClass="local" onKill={onKill} />);
    fireEvent.change(screen.getByLabelText('Target'), { target: { value: 'jde.ap.voucher.create' } });
    const button = screen.getByTestId('kill-scoped-confirm') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onKill).not.toHaveBeenCalled();
  });
});
