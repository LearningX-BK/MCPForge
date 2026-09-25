// MCPForge — W0-P16/P17 test support: a session repo the served surface can read.
//
// Not a production file: `.test-support.ts` is excluded from the build and from
// the trust-boundary production walk.

import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRuntimeCatalogue } from './catalogue.js';
import { REPO_ROOT, sessionRepo } from './session.test-support.js';

/**
 * The session repo, plus the discovery artefacts the surface reads. With
 * `grantRealRefs`, the p2p role's `function` grant names the binding refs the
 * p2p tools actually declare. TEST WORLD ONLY: the committed grant names
 * AP_VOUCHER, GL_JOURNAL and PO_ORCHESTRATION, which match no manifest's
 * `binding.ref` (grants match by exact ref), so against the committed
 * artefacts no p2p tool is callable. That is an owner decision, flagged in
 * W0-P16's report and exercised as-is by surface.e2e.test.ts's second suite.
 */
export function surfaceRepo(grantRealRefs: boolean, refs: readonly string[]): string {
  const root = sessionRepo([{ consumerId: 'test-agent', writeAllowed: true }]);
  for (const rel of ['generated/index', 'generated/cards']) {
    cpSync(join(REPO_ROOT, rel), join(root, rel), { recursive: true });
  }
  if (grantRealRefs) {
    const file = join(root, 'generated', 'roles', 'p2p.scope.json');
    const role = JSON.parse(readFileSync(file, 'utf8')) as {
      bindingGrants: Array<{ names: string[] }>;
    };
    role.bindingGrants[0]!.names = [...refs];
    writeFileSync(file, JSON.stringify(role));
  }
  return root;
}

/** The `binding.ref` of every `function` tool the committed p2p role grants. */
export async function p2pFunctionRefs(): Promise<readonly string[]> {
  const catalogue = await loadRuntimeCatalogue({ repoRoot: REPO_ROOT });
  const p2p = JSON.parse(
    readFileSync(join(REPO_ROOT, 'generated', 'roles', 'p2p.scope.json'), 'utf8'),
  ) as { toolIds: string[] };
  return p2p.toolIds
    .map((id) => catalogue.entryFor(id))
    .filter((e) => e !== undefined && e.bindingType === 'function')
    .map((e) => e!.bindingRef);
}
