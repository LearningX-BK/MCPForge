import { defineConfig } from 'vitest/config';

// MCPForge — the opt-in second leg of the IDENTITY contract suite (W0-D3,
// 02 §4.4 item 2), exactly parallel to `vitest.postgres.config.ts` (W0-C5).
//
// It runs the SAME `identity/identity.contract.test.ts` the default
// `vitest.config.ts` runs — nothing here is a second suite. The only difference
// is that `globalSetup` has started a disposable Keycloak and exported
// `MCPFORGE_TEST_KEYCLOAK_URL`, so the file's OIDC leg executes for real instead
// of reporting itself skipped.
//
// Invoked ONLY by `pnpm test:keycloak`, never by the default `pnpm test`,
// because starting a container requires Docker and 02 §10.1 item 2 forbids
// Docker becoming a prerequisite for the default Wave 0 path.
export default defineConfig({
  test: {
    include: ['identity/identity.contract.test.ts'],
    globalSetup: ['./identity/oidc/test-keycloak-global-setup.ts'],
    // Keycloak pulls a ~450 MB image and takes tens of seconds to boot.
    testTimeout: 60_000,
    hookTimeout: 240_000,
  },
});
