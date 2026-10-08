// MCPForge — W0-J21 gate 4: a REAL gateway for the keyboard specs that need a
// signed-in human (approve, role-edit). Started by playwright.config.ts's
// `webServer` entry; nothing about the gateway, the sign-in or the consumer
// check is stubbed. It runs against a throwaway COPY of the committed
// definitions (launchRepo), so the working tree and `.mcpforge/` are untouched.
//
// Two humans in the mapped group (so both hold the p2p role): the signed-in
// viewer the specs use, and a requester who raised the pending approvals, so
// the viewer is never the requester of the approval they decide.
//
// The portal authenticates to this gateway as `portal-local`, with the private
// key already on this machine (`.mcpforge/portal/`). That key never leaves the
// machine, which is why config only turns this on when the file exists.
import { join } from 'node:path';
import { launchGateway } from '../../../../gateway/launch.js';
import { launchRepo, TEST_CONSUMER, TEST_GROUP } from '../../../../gateway/launch.test-support.js';
import { EncryptedFileStore } from '../../../../gateway/secrets/server.js';
import { localUserStore } from '../../../../gateway/identity/index.js';
import { buildPlanBody } from '../../../../gateway/policy/confirm/plan.js';
import { planCanonicalHash } from '../../../../gateway/policy/confirm/hash.js';
import { generateTestConsumerKeypair } from '../../../../gateway/transport/consumer-auth/testkit.js';
import {
  E2E_GATEWAY_PORT,
  E2E_PASSWORD,
  E2E_REQUESTER,
  E2E_VIEWER,
  E2E_SECRETS_PASSPHRASE,
} from './e2e-gateway-config.js';

const keypair = await generateTestConsumerKeypair();
const repo = launchRepo({
  keypair,
  aisBaseUrl: 'http://127.0.0.1:9/unused',
  aisTokenUrl: 'http://127.0.0.1:9/unused',
  grantRefs: [],
});

const launched = await launchGateway({
  repoRoot: repo,
  mode: 'headless',
  gatewayPort: E2E_GATEWAY_PORT,
  secretStore: new EncryptedFileStore({
    repoRoot: repo,
    env: { MCPFORGE_SECRETS_KEY: E2E_SECRETS_PASSPHRASE },
  }),
  flagPollMs: 500,
});

const users = localUserStore({ store: launched.store });
for (const u of [E2E_VIEWER, E2E_REQUESTER]) {
  await users.createUser({
    username: u.username,
    subject: u.subject,
    displayName: u.username,
    password: E2E_PASSWORD,
    groups: [TEST_GROUP],
  });
}

// Real stored plan bodies that re-hash to their planHash, so the approver gets
// the full review panel (what a gateway-raised approval looks like), not the
// bare fallback form for a request raised before bodies were stored.
for (const amount of [18400, 920]) {
  const body = buildPlanBody({
    template:
      'Create an AP voucher for supplier {supplier} for {amount} GBP. This creates an OPEN PAYABLE in JD Edwards.',
    args: { supplier: '4242', amount },
    dryRun: { warnings: [] },
    defaultEffect: { system: 'jde-fin-ap', object: 'voucher', action: 'create', reversible: true },
    reversal: { class: 'compensating-tool', tool: 'jde.ap.voucher.cancel', windowHours: 720 },
  });
  await launched.store.approvals.create({
    planHash: planCanonicalHash(body),
    argsCanonicalHash: `e2e-args-${amount}`,
    planSummary: body.plan,
    planBody: body,
    callerSubject: E2E_REQUESTER.subject,
    consumerId: TEST_CONSUMER,
    toolId: 'jde.ap.voucher.create',
    toolVersion: '1.0.0',
    expiresAt: '2099-01-01T00:00:00.000Z',
  });
}

console.log(`e2e gateway ready on ${launched.gatewayPort} (definitions copy: ${join(repo)})`);
const stop = async (): Promise<void> => {
  await launched.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
