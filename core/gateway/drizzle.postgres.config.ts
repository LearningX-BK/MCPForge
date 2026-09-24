import { defineConfig } from 'drizzle-kit';

// MCPForge — the PostgreSQL half. Same schema definition, second dialect.
// This set is what makes the OCI-era move "a driver, connection-string and
// migration-set change, not a rewrite" (02 §10.2), and it is generated and
// contract-tested from day one rather than attempted later under time
// pressure (02 §10.4 item 8).
export default defineConfig({
  dialect: 'postgresql',
  schema: './store/schema/pg.ts',
  out: './store/migrations/postgres',
});
