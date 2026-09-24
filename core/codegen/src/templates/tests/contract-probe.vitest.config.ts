import { defineConfig } from 'vitest/config';

// MCPForge — W0-B7. A minimal, permissive vitest config used ONLY to
// actually execute a generated `contract.test.ts` written into a throwaway
// `core/codegen/.contract-probe-*` directory (see `contract-test.test.ts`).
// The repo's own root `vitest.config.ts` excludes `generated/**` by design
// (CLAUDE.md/02 — that tree is proven clean by the codegen-diff CI gate, not
// by being executed as part of the normal suite); this file exists
// specifically to run one throwaway generated file outside that exclusion,
// without altering the real root config.
export default defineConfig({
  test: {
    include: ['core/codegen/.contract-probe-*/**/*.test.ts'],
  },
});
