import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locate the MCPForge repo root by walking up from the caller (or this
 * file) until a `pnpm-workspace.yaml` is found. Deliberately filesystem-only
 * — no assumption about which CI host, if any, is running this.
 */
export function findRepoRoot(startDir?: string): string {
  let dir = startDir ?? path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 20; i += 1) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error(
    `Could not locate the MCPForge repo root (no pnpm-workspace.yaml found above ${startDir ?? dir}).`,
  );
}
