// @vitest-environment jsdom
//
// MCPForge — W0-J17: the deployment fingerprint panel.
//  - reuses the real EnvChip (03 §11.1's 3px rule lives in app-shell.tsx,
//    not duplicated here — this test asserts the SAME chip component is
//    rendered, not a bespoke one);
//  - prod is the only filled env-chip treatment;
//  - the data-class chip's tooltip is driven by the single `store` field.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { describeStore } from '@mcpforge/gateway/store';

import { TooltipProvider } from '../../../components/ui/tooltip';
import { DeploymentFingerprintPanel } from './deployment-fingerprint-panel';
import type { DeploymentFingerprint } from '../types';

afterEach(cleanup);

const BASE: DeploymentFingerprint = {
  envClass: 'local',
  gatewayVersion: '0.1.0-wave0',
  bundleVersion: 'mcpforge-core@0.1.0-wave0',
  deployedPackage: 'jde-fin',
  catalogueDigest: 'sha256:abc123',
  store: describeStore({ kind: 'sqlite' }),
  gitRemote: { configured: false },
  identityProviderKind: 'local',
  identityProviderLabel: 'Local user store',
  lastProbeRun: { deploymentId: 'local-dev', environmentClass: 'local', finishedAt: new Date().toISOString(), toolCount: 11 },
  killFlags: [],
};

function renderPanel(fp: DeploymentFingerprint) {
  return render(
    <TooltipProvider>
      <DeploymentFingerprintPanel fingerprint={fp} />
    </TooltipProvider>,
  );
}

describe('DeploymentFingerprintPanel', () => {
  it('answers "what am I looking at" with every named field on one screen', () => {
    renderPanel(BASE);
    expect(screen.getByText('jde-fin')).not.toBeNull();
    expect(screen.getByText('sha256:abc123')).not.toBeNull();
    expect(screen.getByText('Local user store')).not.toBeNull();
    expect(screen.getByText('local only — no remote configured')).not.toBeNull();
    expect(screen.getByText('None')).not.toBeNull(); // kill flags
  });

  it('the env chip carries a real EnvClass and is `outline` for local, not duplicated logic', () => {
    renderPanel(BASE);
    const chip = screen.getByLabelText(/Environment: local dev\./);
    expect(chip.className).toContain('border-status-platform-border');
    expect(chip.className).not.toContain('bg-status-platform-strong'); // not filled
  });

  it('prod is the ONLY filled env-chip variant — the deliberate severity asymmetry', () => {
    renderPanel({ ...BASE, envClass: 'prod' });
    const chip = screen.getByLabelText(/Environment: production\./);
    expect(chip.className).toContain('bg-status-danger-strong'); // filled
  });

  it('the data-class chip reads "SQLite · local file" driven by the single store field', () => {
    renderPanel(BASE);
    expect(screen.getByTestId('data-class-chip').textContent).toContain('SQLite · local file');
  });

  it('data-class chip tooltip text separates ephemeral runtime data from safe definitional data', () => {
    renderPanel(BASE);
    const chip = screen.getByTestId('data-class-chip');
    expect(chip.getAttribute('aria-label')).toMatch(/not backed up and does not survive a clean checkout/);
    expect(chip.getAttribute('aria-label')).toMatch(/Definitional data is in git and is safe/);
  });

  it('drops ephemerality language for a non-ephemeral (Postgres) store — single-field driven', () => {
    renderPanel({ ...BASE, store: describeStore({ kind: 'postgres', connectionString: 'postgres://x' }) });
    const chip = screen.getByTestId('data-class-chip');
    expect(chip.getAttribute('aria-label')).not.toMatch(/does not survive a clean checkout/);
    expect(chip.textContent).toContain('PostgreSQL · server');
  });

  it('shows a staleness marker, not a bare boolean, for the last probe run', () => {
    const staleFp: DeploymentFingerprint = {
      ...BASE,
      lastProbeRun: { deploymentId: 'local-dev', environmentClass: 'local', finishedAt: '2020-01-01T00:00:00.000Z', toolCount: 11 },
    };
    renderPanel(staleFp);
    expect(screen.getByTestId('last-probe-staleness').textContent).toMatch(/stale/);
  });

  it('[P5] renders the secret-store kind and overdue count beside the datastore kind', () => {
    renderPanel({
      ...BASE,
      secretPosture: { storeKind: 'EncryptedFileStore', overdueCount: 1, criticalCount: 0, totalCount: 3 },
    });
    expect(document.body.textContent).toContain('EncryptedFileStore');
    expect(document.body.textContent).toContain('1 of');
  });
});
