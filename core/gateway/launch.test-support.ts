// MCPForge — W0-P11 test support: a repository the REAL `launchGateway` can
// start from, with nothing about the gateway stubbed.
//
// The temp repo is a copy of this repository's committed sources and
// artefacts (manifests, generated/, roles, packages, approvals, overlays, …),
// plus exactly what a test must control and cannot find committed:
//
//   * its own registered consumer, `test-agent`, whose private key the test
//     holds (a real `consumers/*.consumer.yaml` and its compiled
//     authorization);
//   * its own group->role mapping (the committed local mapping names roles
//     that do not exist — W0-P15's owner flag);
//   * the p2p `function` grant naming the binding refs the tools actually
//     declare (the committed grant matches none — W0-P16's owner flag);
//   * `overlays/<d>/ais-targets.yaml` pointing at the mock JDE's real port.
//
// Not a production file: excluded from the build and the trust-boundary walk.

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as toYaml } from 'yaml';
import { testConsumerRecord, type TestKeypair } from './transport/consumer-auth/testkit.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..', '..');

const COPIED = [
  'manifests',
  'generated',
  'roles',
  'packages',
  'enums',
  'evals',
  'approvals',
  'consumers',
  'overlays',
];

export const TEST_CONSUMER = 'test-agent';
export const TEST_GROUP = 'finance-ap-clerks';

export interface LaunchRepoOptions {
  readonly keypair: TestKeypair;
  readonly aisBaseUrl: string;
  readonly aisTokenUrl: string;
  /** The binding refs the p2p grant should name. */
  readonly grantRefs: readonly string[];
}

export function launchRepo(options: LaunchRepoOptions): string {
  const root = mkdtempSync(join(tmpdir(), 'mcpforge-p11-'));
  for (const rel of COPIED) {
    if (existsSync(join(REPO_ROOT, rel))) {
      cpSync(join(REPO_ROOT, rel), join(root, rel), { recursive: true });
    }
  }

  // --- the test's consumer, registered and compiled ------------------------
  const record = testConsumerRecord({
    id: TEST_CONSUMER,
    writeAllowed: true,
    maxSensitivity: 'financial',
    publicKeys: [
      {
        kid: options.keypair.kid,
        kty: 'OKP',
        crv: 'Ed25519',
        x: options.keypair.publicJwk.x,
        addedAt: '2026-08-27',
      },
    ],
  });
  const consumer = {
    ...record,
    authorizations: { ...record.authorizations, bindingTypes: ['function'] },
  };
  writeFileSync(join(root, 'consumers', `${TEST_CONSUMER}.consumer.yaml`), toYaml(consumer));
  writeFileSync(
    join(root, 'generated', 'consumers', `${TEST_CONSUMER}.authorization.json`),
    JSON.stringify({
      consumerId: TEST_CONSUMER,
      effectiveStatus: 'active',
      authorizations: consumer.authorizations,
      attestation: { humanInTheLoop: true },
      bindingGrants: [],
    }),
  );

  // --- the mapping and the grant ---------------------------------------------
  const mappings = join(root, 'overlays', 'local', 'mappings');
  rmSync(mappings, { recursive: true, force: true });
  mkdirSync(mappings, { recursive: true });
  writeFileSync(
    join(mappings, 'groups-to-roles.yaml'),
    `apiVersion: mcpforge/v1\nkind: GroupRoleMapping\ndeployment: local\ngroups:\n  ${TEST_GROUP}:\n    roles: [p2p]\n`,
  );
  const roleFile = join(root, 'generated', 'roles', 'p2p.scope.json');
  const role = JSON.parse(readFileSync(roleFile, 'utf8')) as {
    bindingGrants: { names: string[] }[];
  };
  role.bindingGrants[0]!.names = [...options.grantRefs];
  writeFileSync(roleFile, JSON.stringify(role));

  // --- the AIS target: the mock JDE on its real port ------------------------
  const targets = join(root, 'overlays', 'local', 'ais-targets.yaml');
  const text = readFileSync(targets, 'utf8')
    .replace(/baseUrl: .*/, `baseUrl: ${options.aisBaseUrl}`)
    .replace(/tokenUrl: .*/, `tokenUrl: ${options.aisTokenUrl}`);
  writeFileSync(targets, text);

  return root;
}

export function removeLaunchRepo(root: string): void {
  rmSync(root, { recursive: true, force: true });
}
