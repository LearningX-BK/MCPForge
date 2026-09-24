// MCPForge — Testcontainers wiring for the Postgres leg of the store contract
// suite (W0-C5, 02 §10.4 item 8). This file is a TEST-INFRASTRUCTURE file, not
// store logic: it never runs as part of the default `pnpm test` invocation, it
// only provisions a Postgres container and exports its connection string as
// `MCPFORGE_TEST_POSTGRES_URL`, which `store.contract.test.ts` already reads
// (that file is unmodified in its wiring — this is what sets the env var it
// was written to expect).
//
// This is a Vitest `globalSetup` module, selected only by
// `vitest.postgres.config.ts` — the DEFAULT `vitest.config.ts` does not
// reference it, so a normal `pnpm test`/`pnpm -C core/gateway test` run never
// starts Docker and never even imports `testcontainers` (02 §10.1 item 2: no
// managed database, and by extension no Docker, may become a prerequisite for
// the default path). Only `pnpm test:postgres` opts in.
//
// Vitest calls `setup()` once before any test file runs in this config, and
// the function it returns as `teardown()` once after they all finish.

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

let container: StartedPostgreSqlContainer | undefined;

export async function setup(): Promise<void> {
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env['MCPFORGE_TEST_POSTGRES_URL'] = container.getConnectionUri();
}

export async function teardown(): Promise<void> {
  await container?.stop();
  container = undefined;
}
