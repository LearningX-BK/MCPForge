// MCPForge — W0-H6: reading/writing fixture-set JSON files from `fixtures/**`.
//
// Deliberately plain `node:fs` — this package must run with no network and no
// live target, and the only I/O it needs is the local filesystem.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FixtureSet } from './fixture-store.js';

export function loadFixtureSet(filePath: string): FixtureSet {
  const raw = readFileSync(filePath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  assertIsFixtureSet(parsed, filePath);
  return parsed;
}

export function saveFixtureSet(filePath: string, set: FixtureSet): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // Stable, prettier-compatible formatting so diffs on refresh are reviewable.
  writeFileSync(filePath, JSON.stringify(set, null, 2) + '\n', 'utf-8');
}

function assertIsFixtureSet(value: unknown, filePath: string): asserts value is FixtureSet {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${filePath} does not contain a JSON object.`);
  }
  const v = value as Record<string, unknown>;
  if (typeof v['name'] !== 'string') throw new Error(`${filePath}: missing "name".`);
  if (v['source'] !== 'synthetic' && v['source'] !== 'recorded') {
    throw new Error(`${filePath}: "source" must be "synthetic" or "recorded".`);
  }
  if (typeof v['targetDescription'] !== 'string') {
    throw new Error(`${filePath}: missing "targetDescription".`);
  }
  if (!Array.isArray(v['cases'])) throw new Error(`${filePath}: missing "cases" array.`);
}
