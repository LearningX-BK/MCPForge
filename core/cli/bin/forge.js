#!/usr/bin/env node
// The forge executable. No build step for Wave 0 — TypeScript runs directly
// via tsx's loader, the same "load from source" choice W0-A3 made for
// tools/eslint-rules. Revisit once forge needs to ship outside the repo.
import { register } from 'tsx/esm/api';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const unregister = register();

try {
  const { run } = await import(pathToFileURL(path.join(here, '..', 'src', 'index.ts')).href);
  const exitCode = await run(process.argv);
  process.exit(exitCode);
} finally {
  unregister();
}
