import { defineConfig } from 'drizzle-kit';

// MCPForge — the SQLite half of the dual-dialect migration generation.
// 02 §10.2: "`drizzle-kit` generates a migration set per dialect from the same
// TypeScript schema file." Both configs below point at projections of the one
// schema definition in `store/schema/spec.ts`. Regenerate both together:
//   pnpm -C core/gateway run db:generate
export default defineConfig({
  dialect: 'sqlite',
  schema: './store/schema/sqlite.ts',
  out: './store/migrations/sqlite',
});
