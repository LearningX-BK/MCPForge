// MCPForge — W0-P14. The AisTargets overlay is strict, and 02 §11.5 rule 4 is
// structural in it: one credential per binding × module × environment.

import { describe, expect, it } from 'vitest';
import {
  AisTargetsOverlayInvalid,
  aisTargetForServer,
  parseAisTargetsOverlay,
} from './targets-overlay.js';

function doc(servers: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    apiVersion: 'mcpforge/v1',
    kind: 'AisTargets',
    deployment: 'local',
    targets: {
      mock: { baseUrl: 'http://127.0.0.1:4545/jderest', tokenUrl: 'http://127.0.0.1:4545/t' },
    },
    servers,
    ...extra,
  };
}

const AP = {
  target: 'mock',
  clientId: 'gw-ap',
  clientCredentialRef: 'secretRef://binding/jde-fin-ap/token-provider-client',
};

function problems(d: unknown): readonly string[] {
  try {
    parseAisTargetsOverlay(d);
  } catch (error) {
    if (error instanceof AisTargetsOverlayInvalid) return error.problems;
    throw error;
  }
  return [];
}

describe('AisTargets overlay', () => {
  it('parses a well-formed overlay and resolves a listed server', () => {
    const overlay = parseAisTargetsOverlay(doc({ 'jde-fin-ap': AP }));
    expect(aisTargetForServer(overlay, 'jde-fin-ap')).toMatchObject({
      serverId: 'jde-fin-ap',
      baseUrl: 'http://127.0.0.1:4545/jderest',
      clientCredentialRef: AP.clientCredentialRef,
    });
  });

  it('refuses an unlisted server: there is no default target', () => {
    const overlay = parseAisTargetsOverlay(doc({ 'jde-fin-ap': AP }));
    expect(() => aisTargetForServer(overlay, 'jde-fin-gl')).toThrow(AisTargetsOverlayInvalid);
  });

  it('rule 4: a credential scoped to another server is refused', () => {
    expect(problems(doc({ 'jde-fin-gl': AP }))).toEqual([
      expect.stringContaining('scoped to "jde-fin-ap", not "jde-fin-gl"'),
    ]);
  });

  it('rule 4: two servers cannot share one credential, because each ref names its own server', () => {
    const shared = { ...AP, clientCredentialRef: 'secretRef://binding/jde-fin-ap/x' };
    expect(problems(doc({ 'jde-fin-ap': shared, 'jde-fin-gl': { ...shared } })).join('\n')).toMatch(
      /scoped to "jde-fin-ap", not "jde-fin-gl"/,
    );
  });

  it('a credential VALUE instead of a reference is refused', () => {
    expect(problems(doc({ 'jde-fin-ap': { ...AP, clientCredentialRef: 's3cr3t' } }))).toEqual([
      expect.stringContaining('must be a secretRef://binding/<serverId>/<purpose>'),
    ]);
  });

  it('credentials embedded in a URL are refused', () => {
    const d = doc({ 'jde-fin-ap': AP });
    (d.targets as Record<string, unknown>)['mock'] = {
      baseUrl: 'http://svc:pw@127.0.0.1:4545/jderest',
      tokenUrl: 'http://127.0.0.1:4545/t',
    };
    expect(problems(d).join('\n')).toMatch(/baseUrl must be an http\(s\) URL with no credentials/);
  });

  it('undeclared keys are refused, at every level', () => {
    const p = problems(
      doc({ 'jde-fin-ap': { ...AP, serviceUser: 'JDE_SVC' } }, { defaultTarget: 'mock' }),
    );
    expect(p).toEqual(
      expect.arrayContaining([
        expect.stringContaining('.defaultTarget is not declared'),
        expect.stringContaining('servers.jde-fin-ap.serviceUser is not declared'),
      ]),
    );
  });
});
