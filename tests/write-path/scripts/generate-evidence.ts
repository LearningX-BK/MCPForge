// MCPForge — W0-F7. Renders `tests/write-path/EVIDENCE.md` from the four
// per-criterion JSON files each test wrote to `.evidence/` (support/evidence.ts)
// during the vitest run that must precede this script (see package.json's
// `test` script). Every field below is read out of those files — nothing here
// is templated placeholder text; a run that never wrote a file is reported as
// MISSING, not silently glossed over.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const EVIDENCE_DIR = join(ROOT, '.evidence');
const OUT = join(ROOT, 'EVIDENCE.md');

interface CriterionEvidence {
  readonly letter: 'a' | 'b' | 'c' | 'd';
  readonly criterion: string;
  readonly testName: string;
  readonly pass: boolean;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly capturedAt: string;
}

const LETTERS = ['a', 'b', 'c', 'd'] as const;

function loadOne(letter: (typeof LETTERS)[number]): CriterionEvidence | null {
  const file = join(EVIDENCE_DIR, `${letter}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as CriterionEvidence;
}

function detailLines(detail: Readonly<Record<string, unknown>>): string {
  return Object.entries(detail)
    .map(([key, value]) => `| \`${key}\` | \`${JSON.stringify(value)}\` |`)
    .join('\n');
}

function main(): void {
  const results = LETTERS.map(loadOne);
  const generatedAt = new Date().toISOString();
  const allPass = results.every((r) => r !== null && r.pass);
  const passCount = results.filter((r) => r?.pass === true).length;

  const sections = LETTERS.map((letter, i) => {
    const r = results[i] ?? null;
    if (r === null) {
      return `## Criterion (${letter}) — MISSING\n\nNo evidence file was written for this criterion. The suite either did not run or the test for this criterion crashed before its \`withEvidence\` block ran.\n`;
    }
    return [
      `## Criterion (${letter}) — ${r.pass ? 'PASS' : 'FAIL'}`,
      '',
      `**Criterion text:** ${r.criterion}`,
      '',
      `**Test:** \`${r.testName}\``,
      '',
      `**Captured:** ${r.capturedAt}`,
      '',
      '| Field | Value |',
      '| --- | --- |',
      detailLines(r.detail),
      '',
    ].join('\n');
  });

  const md = [
    '# W0-F7 — Wave 0 exit criterion 7 evidence',
    '',
    `Generated ${generatedAt} by \`tests/write-path/scripts/generate-evidence.ts\`, from the` +
      ' JSON evidence files each criterion test wrote during its own run' +
      ' (`tests/write-path/.evidence/*.json`). Every value below came out of a real' +
      ' policy-chain decision, a real audit row, or a real dispatcher outcome captured' +
      ' at the moment the test made it — none of it is templated.',
    '',
    `**Result: ${passCount}/4 criteria passed.**`,
    allPass
      ? ''
      : '\n> **This run did NOT pass all four criteria.** Do not treat this file as checkpoint evidence until it does.\n',
    '01 §10.4 (Wave 0 exit criterion 7, superseding the original §7):',
    '',
    '> In addition, all four of the following are demonstrated at least once:',
    '> - **(a)** A live reversal — a completed write was reversed using its declared reversal, and the reversal appears in the audit trail linked to the original call.',
    '> - **(b)** A correct refusal at confirm — a write was refused because the arguments changed between the plan and the confirmation.',
    '> - **(c)** A correct refusal at policy — a write was refused for breaching a declared business guardrail (amount ceiling, or an SoD conflict between `create` and `approve` on the same entity).',
    '> - **(d)** Idempotent replay — replaying a confirmed write returned the original result instead of executing a second time.',
    '',
    '---',
    '',
    ...sections,
    '---',
    '',
    '**Target system:** every test here runs against the mock target (`support/store-world.ts` / `support/light-world.ts`) — the one thing a local build cannot have live. Every other layer — the policy chain, the confirm gate, the guardrail evaluator, the idempotency gate, the write dispatcher, the reversal registry, and (for (a) and (d)) a real SQLite store — is the real production code, unmodified.',
    '',
    '**Re-running against a live instance:** (a) and (d) take their target through the `WriteTargetInvoker` seam (`mockTarget().invoker` in `support/store-world.ts`); swapping that for an invoker backed by a real AIS/Orchestrator endpoint is the only change needed. (b) and (c) never reach a target at all — the refusal happens inside the policy chain before dispatch. **No live run has ever been performed** — this suite has only ever executed against the mock target described above.',
    '',
  ].join('\n');

  writeFileSync(OUT, md, 'utf8');
  console.log(`Wrote ${OUT} (${passCount}/4 criteria passed)`);
  if (!allPass) process.exitCode = 1;
}

main();
