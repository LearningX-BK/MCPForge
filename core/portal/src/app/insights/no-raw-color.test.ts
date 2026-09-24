// W0-J20 (reduced scope): CLAUDE.md §2 "no raw colour" — no hex or CSS colour
// function literal anywhere under `insights/`, only `tokens.primitives.css`.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname);
// Built from parts so this file itself does not contain a raw-colour-looking
// literal (the `mcpforge/no-raw-color` lint rule scans for exactly that).
const FN = ['rgb', 'rgba', 'hsl', 'hsla'].map((f) => `${f}\\(`).join('|');
const RAW_COLOR = new RegExp(`#[0-9a-fA-F]{3,8}\\b|${FN}`);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(abs);
  }
  return out;
}

describe('insights/ carries no raw colour literal', () => {
  it('has zero raw-colour-literal occurrences outside tokens.primitives.css', () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const text = readFileSync(file, 'utf8');
      if (RAW_COLOR.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
