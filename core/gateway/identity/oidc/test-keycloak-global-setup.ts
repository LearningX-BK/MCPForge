// MCPForge — Testcontainers wiring for the OIDC (Keycloak) leg of the identity
// contract suite. W0-D3, 02 §4.4 item 2.
//
// TEST INFRASTRUCTURE, and the direct analogue of
// `../../store/test-postgres-global-setup.ts` (W0-C5). It is referenced ONLY by
// `../../vitest.keycloak.config.ts`, never by the default `vitest.config.ts`, so
// a normal `pnpm test` never starts Docker and never even imports
// `testcontainers` — 02 §10.1 item 2 is explicit that Docker may not become a
// prerequisite for the default Wave 0 path.
//
// It provisions one disposable Keycloak, configures both realms through the
// Admin API, and exports `MCPFORGE_TEST_KEYCLOAK_URL`, which
// `../identity.contract.test.ts` already reads to decide whether its OIDC leg
// runs or reports itself skipped.
//
// HOW A CI PROVIDER RUNS THIS AS A SECOND LEG (same shape as W0-C5; this repo
// has no provider-specific YAML by design — CLAUDE.md §3.1):
//   leg 1 (always, no Docker):   `pnpm test`
//     -> the identity contract suite runs its LocalUserStore leg for real; its
//        Keycloak leg reports skipped.
//   leg 2 (Docker available):    `pnpm test:keycloak`
//     -> the SAME contract suite file runs BOTH legs, the OIDC one against a
//        real Keycloak. Not a second suite: the same assertions, a second
//        provider. That is the whole discipline 02 §4.4 item 2 asks for.

import type { StartedTestContainer } from 'testcontainers';
import {
  KEYCLOAK_ADMIN_PASSWORD,
  KEYCLOAK_ADMIN_USER,
  KEYCLOAK_IMAGE,
  KEYCLOAK_PORT,
  configureKeycloak,
} from './keycloak.testkit.js';

let container: StartedTestContainer | undefined;

export async function setup(): Promise<void> {
  const { GenericContainer, Wait } = await import('testcontainers');
  container = await new GenericContainer(KEYCLOAK_IMAGE)
    .withExposedPorts(KEYCLOAK_PORT)
    .withEnvironment({
      // Keycloak 24+ names; the pre-24 names are set too so bumping the image
      // tag down for a local reproduction does not silently produce a container
      // with no admin account.
      KC_BOOTSTRAP_ADMIN_USERNAME: KEYCLOAK_ADMIN_USER,
      KC_BOOTSTRAP_ADMIN_PASSWORD: KEYCLOAK_ADMIN_PASSWORD,
      KEYCLOAK_ADMIN: KEYCLOAK_ADMIN_USER,
      KEYCLOAK_ADMIN_PASSWORD,
      // The issuer Keycloak advertises is then derived from the request's Host
      // header, which is how a container on an ephemeral port can serve a
      // discovery document whose `iss` matches the URL we actually call. With
      // strict hostname on, `iss` would name a hostname the test cannot reach
      // and every token would fail issuer validation for the wrong reason.
      KC_HOSTNAME_STRICT: 'false',
      KC_HTTP_ENABLED: 'true',
    })
    .withCommand(['start-dev'])
    .withWaitStrategy(Wait.forHttp('/realms/master', KEYCLOAK_PORT).forStatusCode(200))
    .withStartupTimeout(180_000)
    .start();

  const baseUrl = `http://${container.getHost()}:${String(container.getMappedPort(KEYCLOAK_PORT))}`;
  // The resource identifier the gateway is. A URL, because RFC 8707 says a
  // resource identifier is one, and equal to the audience the provider will
  // verify — the invariant ./protected-resource.ts refuses to publish without.
  const resource = 'https://mcpforge.local/mcp';
  await configureKeycloak(baseUrl, resource);

  process.env['MCPFORGE_TEST_KEYCLOAK_URL'] = baseUrl;
  process.env['MCPFORGE_TEST_KEYCLOAK_RESOURCE'] = resource;
}

export async function teardown(): Promise<void> {
  await container?.stop();
  container = undefined;
}
