// MCPForge — the compiled-artefact readers. W0-E2.
//
// The JSON below is shaped exactly as W0-B8's compilers emit it
// (core/codegen/src/compile/role.ts, package.ts, consumer.ts). It is duplicated
// here rather than imported because the gateway does not depend on the codegen
// package — the artefact FILE is the contract between them, and a test that
// imported the producer would stop noticing if that file's shape drifted.

import { describe, expect, it } from 'vitest';
import {
  consumerAuthorizationFromArtefact,
  deploymentView,
  packageSelectionsFromArtefacts,
  roleScopesFromArtefacts,
} from './artefacts.js';
import { sensitivityRank, sensitivityWithinCeiling } from './sensitivity.js';

const ROLE_SCOPE_JSON = {
  roleId: 'p2p',
  label: 'Procure-to-Pay',
  sensitivityCeiling: 'financial',
  writeAllowed: true,
  budgetTokens: 1300,
  includes: ['jde.ap.voucher.*'],
  excludes: [],
  toolIds: ['jde.ap.voucher.create', 'jde.ap.voucher.search'],
  coreTools: ['jde.ap.voucher.create'],
  coreToolsOutsideScope: [],
  mutuallyExclusiveWith: [],
  segregationOfDuties: [],
  bindingGrants: [],
};

const PACKAGE_SELECTION_JSON = {
  packageId: 'jde-fin',
  label: 'JDE Finance',
  portal: 'ltm',
  servers: ['jde-ap'],
  roles: ['p2p'],
  unresolvedRoles: [],
  toolIds: ['jde.ap.voucher.create', 'jde.ap.voucher.search'],
};

const CONSUMER_AUTHORIZATION_JSON = {
  consumerId: 'claude-desktop-coe',
  label: 'Claude Desktop (LTM CoE)',
  class: 'interactive-client',
  status: 'active',
  expiresAt: '2027-08-27',
  expired: false,
  effectiveStatus: 'active',
  authorizations: {
    bindingTypes: ['rest', 'wrapped-vendor'],
    maxSensitivity: 'internal',
    writeAllowed: false,
    roles: ['p2p'],
    packages: ['jde-fin'],
  },
  limits: { callsPerMinute: 60, writesPerDay: 20, concurrentSessions: 4 },
  attestation: { humanInTheLoop: true, networkOrigins: [] },
  bindingGrants: [],
};

describe('compiled artefact readers', () => {
  it('reads a role scope into its explicit tool-id set', () => {
    const scopes = roleScopesFromArtefacts([ROLE_SCOPE_JSON]);
    expect([...(scopes.get('p2p') ?? [])].sort()).toEqual([
      'jde.ap.voucher.create',
      'jde.ap.voucher.search',
    ]);
  });

  it('reads package selections and a deployment view', () => {
    const selections = packageSelectionsFromArtefacts([PACKAGE_SELECTION_JSON]);
    expect(selections.get('jde-fin')?.has('jde.ap.voucher.create')).toBe(true);
    expect(deploymentView('ltm-dev', ['jde-fin']).packageIds).toEqual(['jde-fin']);
  });

  it('reads a consumer authorization, effectiveStatus included', () => {
    const view = consumerAuthorizationFromArtefact(CONSUMER_AUTHORIZATION_JSON);
    expect(view.consumerId).toBe('claude-desktop-coe');
    expect(view.effectiveStatus).toBe('active');
    expect(view.authorizations.writeAllowed).toBe(false);
    expect(view.authorizations.roles).toEqual(['p2p']);
  });

  it('refuses a malformed artefact rather than defaulting its fields', () => {
    expect(() => roleScopesFromArtefacts([{ roleId: 'p2p' }])).toThrow();
    expect(() =>
      consumerAuthorizationFromArtefact({
        ...CONSUMER_AUTHORIZATION_JSON,
        authorizations: { ...CONSUMER_AUTHORIZATION_JSON.authorizations, writeAllowed: 'yes' },
      }),
    ).toThrow();
  });
});

describe('the sensitivity ordering (FLAGGED — see sensitivity.ts)', () => {
  it("ranks by the documents' own declaration order", () => {
    expect(sensitivityRank('public')).toBe(0);
    expect(sensitivityRank('personal')).toBe(4);
    expect(sensitivityWithinCeiling('internal', 'financial')).toBe(true);
    expect(sensitivityWithinCeiling('financial', 'internal')).toBe(false);
    expect(sensitivityWithinCeiling('internal', 'internal')).toBe(true);
  });

  it('is fail-closed on an unrecognised class or ceiling', () => {
    expect(sensitivityRank('secret')).toBeNull();
    expect(sensitivityWithinCeiling('internal', 'secret')).toBe(false);
    expect(sensitivityWithinCeiling('secret', 'personal')).toBe(false);
  });
});
