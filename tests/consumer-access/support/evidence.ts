// MCPForge — W0-N14. Evidence capture for the checkpoint markdown.
//
// Identical convention to tests/write-path/support/evidence.ts (W0-F7): each
// criterion test writes ONE JSON file here, from inside the test itself, with
// real values pulled off the real decisions/records the test just produced —
// never templated placeholder text. `scripts/generate-evidence.ts` reads the
// four files and renders `EVIDENCE.md` afterwards, as a separate step, because
// vitest may run each test file in its own worker and this package makes no
// assumption about shared in-memory state across workers.
//
// `recordEvidence` is called from a `try`, so a PASS writes real detail and a
// thrown assertion inside the same block is caught, recorded as a FAIL with
// the assertion's own message, and rethrown — the run still fails the way a
// checkpoint evidence file must be honest about.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const EVIDENCE_DIR = join(HERE, '..', '.evidence');

// Criterion (d) names THREE independent demonstrations (registration,
// standing authorization, credential rotation), each proved by its own
// `it()` block. Rather than have the second and third overwrite the first at
// the same `d.json` path, each writes its own sub-letter (`d1`, `d2`, `d3`);
// `scripts/generate-evidence.ts` renders all three under one "Criterion (d)"
// heading.
export type CriterionLetter = 'a' | 'b' | 'c' | 'd1' | 'd2' | 'd3';

export interface CriterionEvidence {
  readonly letter: CriterionLetter;
  readonly criterion: string;
  readonly testName: string;
  readonly pass: boolean;
  /** Concrete, run-captured facts: consumer ids, error codes, stages, file paths, artefact diffs. */
  readonly detail: Readonly<Record<string, unknown>>;
  readonly capturedAt: string;
}

export function writeEvidence(evidence: CriterionEvidence): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    join(EVIDENCE_DIR, `${evidence.letter}.json`),
    JSON.stringify(evidence, null, 2),
    'utf8',
  );
}

/**
 * Runs `work`, records a PASS with `work`'s returned detail on success or a
 * FAIL with the thrown error's message on failure, and always rethrows so
 * vitest's own pass/fail accounting is untouched by evidence capture.
 */
export async function withEvidence(
  letter: CriterionLetter,
  criterion: string,
  testName: string,
  work: () => Promise<Readonly<Record<string, unknown>>>,
): Promise<void> {
  try {
    const detail = await work();
    writeEvidence({
      letter,
      criterion,
      testName,
      pass: true,
      detail,
      capturedAt: new Date().toISOString(),
    });
  } catch (error) {
    writeEvidence({
      letter,
      criterion,
      testName,
      pass: false,
      detail: { error: error instanceof Error ? error.message : String(error) },
      capturedAt: new Date().toISOString(),
    });
    throw error;
  }
}
