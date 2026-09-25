// MCPForge — start the LOCAL MOCK JD EDWARDS as a standalone process. W0-P14.
//
//   pnpm --filter @mcpforge/mocks mock-jde            # 127.0.0.1:4545
//   pnpm --filter @mcpforge/mocks mock-jde -- --port 4600 --config <file>
//
// Serves the AIS REST root at http://127.0.0.1:<port>/jderest, which is what
// overlays/local/ais-targets.yaml points at. Provisioning (users, client ids)
// comes from tests/mocks/fixtures/mock-jde/local.yaml by default.
//
// Client secrets are NEVER in git. They live in a JSON file of
// { "<clientId>": "<secret>" } at MCPFORGE_MOCK_JDE_CLIENTS_FILE, default
// <repo>/.mcpforge/mock-jde/clients.json (git-ignored). Missing entries are
// generated at random on start and written there with mode 0600. Only the path
// is printed, never a value.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { startMockJde } from '../src/mock-jde/server.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const configPath = resolve(arg('config') ?? join(HERE, '..', 'fixtures', 'mock-jde', 'local.yaml'));
const port = Number(arg('port') ?? process.env['MCPFORGE_MOCK_JDE_PORT'] ?? 4545);
const clientsFile = resolve(
  process.env['MCPFORGE_MOCK_JDE_CLIENTS_FILE'] ??
    join(REPO_ROOT, '.mcpforge', 'mock-jde', 'clients.json'),
);

const provisioning = parseYaml(readFileSync(configPath, 'utf8')) as {
  users?: unknown;
  clients?: unknown;
};
const users = Array.isArray(provisioning.users) ? provisioning.users.map(String) : [];
const clientIds = Array.isArray(provisioning.clients) ? provisioning.clients.map(String) : [];
if (users.length === 0 || clientIds.length === 0) {
  console.error(`mock-jde: ${configPath} must list at least one user and one client.`);
  process.exit(64);
}

const secrets: Record<string, string> = existsSync(clientsFile)
  ? (JSON.parse(readFileSync(clientsFile, 'utf8')) as Record<string, string>)
  : {};
let generated = 0;
for (const id of clientIds) {
  if (typeof secrets[id] !== 'string' || secrets[id]!.length === 0) {
    secrets[id] = randomBytes(32).toString('base64url');
    generated += 1;
  }
}
if (generated > 0) {
  mkdirSync(dirname(clientsFile), { recursive: true });
  writeFileSync(clientsFile, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
}
const clients = Object.fromEntries(clientIds.map((id) => [id, secrets[id]!]));

const jde = await startMockJde({ users, clients }, { port, host: '127.0.0.1' });
console.log(
  JSON.stringify({
    ok: true,
    service: 'mock-jde',
    baseUrl: jde.baseUrl,
    tokenUrl: jde.tokenUrl,
    users: users.length,
    clients: clientIds,
    clientSecretsFile: clientsFile,
    generatedSecrets: generated,
  }),
);

const stop = (): void => {
  void jde.close().finally(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
