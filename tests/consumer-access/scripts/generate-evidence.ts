// MCPForge — W0-N14. Renders `tests/consumer-access/EVIDENCE.md` from the
// per-criterion JSON evidence files each test wrote to `.evidence/`
// (support/evidence.ts) during the vitest run that must precede this script
// (see package.json's `test` script). Every field below is read out of those
// files — nothing here is templated placeholder text; a run that never wrote
// a file is reported as MISSING, not silently glossed over.
//
// Mirrors tests/write-path/scripts/generate-evidence.ts's exact convention
// (W0-F7) — one script, one shape, so the two Wave 0 checkpoint evidence
// files read the same way. Criterion (d) names THREE independent
// demonstrations (registration, standing authorization, credential
// rotation), each proved by its own `it()` block; each writes its own
// sub-letter (`d1.json`, `d2.json`, `d3.json` — see support/evidence.ts) so
// the second and third do not overwrite the first at one shared path. This
// script renders all three under one "Criterion (d)" heading.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const EVIDENCE_DIR = join(ROOT, '.evidence');
const OUT = join(ROOT, 'EVIDENCE.md');

type CriterionLetter = 'a' | 'b' | 'c' | 'd1' | 'd2' | 'd3';

interface CriterionEvidence {
  readonly letter: CriterionLetter;
  readonly criterion: string;
  readonly testName: string;
  readonly pass: boolean;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly capturedAt: string;
}

const LETTERS: readonly CriterionLetter[] = ['a', 'b', 'c', 'd1', 'd2', 'd3'];

function loadOne(letter: CriterionLetter): CriterionEvidence | null {
  const file = join(EVIDENCE_DIR, `${letter}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as CriterionEvidence;
}

function detailLines(detail: Readonly<Record<string, unknown>>): string {
  return Object.entries(detail)
    .map(([key, value]) => `| \`${key}\` | \`${JSON.stringify(value)}\` |`)
    .join('\n');
}

function renderSection(letter: CriterionLetter, r: CriterionEvidence | null): string {
  const heading = letter.startsWith('d') ? `d, part ${letter.slice(1)}` : letter;
  if (r === null) {
    return `## Criterion (${heading}) — MISSING\n\nNo evidence file was written for this criterion. The suite either did not run or the test for this criterion crashed before its \`withEvidence\` block ran.\n`;
  }
  return [
    `## Criterion (${heading}) — ${r.pass ? 'PASS' : 'FAIL'}`,
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
}

function main(): void {
  const results = LETTERS.map(loadOne);
  const generatedAt = new Date().toISOString();
  const allPass = results.every((r) => r !== null && r.pass);
  const demoPassCount = results.filter((r) => r?.pass === true).length;
  // Four criteria (a, b, c, d); (d) contributes three demonstrations, all of
  // which must pass for criterion (d) itself to count as passed.
  const dPass = results
    .slice(3)
    .every((r) => r !== null && r.pass);
  const criteriaPassCount = (results[0]?.pass ? 1 : 0) + (results[1]?.pass ? 1 : 0) + (results[2]?.pass ? 1 : 0) + (dPass ? 1 : 0);

  const sections: string[] = LETTERS.map((letter, i) => renderSection(letter, results[i] ?? null));

  const md = [
    '# W0-N14 — Wave 0 exit criterion 14 evidence',
    '',
    `Generated ${generatedAt} by \`tests/consumer-access/scripts/generate-evidence.ts\`, from the` +
      ' JSON evidence files each criterion test wrote during its own run' +
      ' (`tests/consumer-access/.evidence/*.json`). Every value below came out of a real' +
      ' consumer-registry decision, a real policy-chain refusal, a real kill-switch flag, or a' +
      ' real codegen-compiled artefact captured at the moment the test produced it — none of it' +
      ' is templated.',
    '',
    `**Result: ${criteriaPassCount}/4 criteria passed (${demoPassCount}/6 demonstrations — (d) counts as three).**`,
    allPass
      ? ''
      : '\n> **This run did NOT pass all four criteria.** Do not treat this file as checkpoint evidence until it does.\n',
    '01 §11.5 (Wave 0 exit criterion 14):',
    '',
    '> The front door is closed and elevated bindings are not open. All four demonstrated in a live run:',
    '> - **(a)** A call presenting a valid user identity from an unregistered consumer is refused at session establishment with CONSUMER_UNREGISTERED, and no tools/list is served.',
    '> - **(b)** A registered consumer suspended mid-session is refused on its next call within the kill-switch poll interval, with CONSUMER_SUSPENDED.',
    '> - **(c)** An elevated-binding tool held in the caller\'s role scope but with no elevated grant is refused with ELEVATED_GRANT_REQUIRED through both a direct tools/call and forge.invoke, and is absent from tools/list while remaining findable through forge.find with its agentMessage.',
    '> - **(d)** A consumer registration, a standing authorization and a credential rotation each produced an approval record in approvals/, and each is visible as a compiled-artefact diff in its change proposal.',
    '',
    '---',
    '',
    ...sections,
    '---',
    '',
    '**Target system:** (a) runs the real `createGatewayHttpTransport` over a real `node:http` server. (b), (c) and (d) run the real policy chain, kill-switch poller, meta-tools and codegen pipeline directly (no mock target is needed — none of these four criteria dispatches to a business-system binding). Every layer exercised — consumer authentication, the policy chain, scope resolution, the kill switch, `authorizeBinding`, discovery, and the codegen compiler — is the real production code built by W0-N1 through W0-N4, W0-N11, W0-N12 and W0-HG8, unmodified.',
    '',
    '**Re-running against a live instance:** (a) already runs a real gateway HTTP endpoint — swapping the in-test `ConsumerAuthenticator` registry for the real `consumers/**` directory on a running deployment is the only change needed. (b), (c) and (d) exercise gateway-internal and codegen-internal mechanisms that are identical whether the deployment is local or live; (b) additionally proves the real SQLite-backed `runtime_flags` poll used in production. **No live run has ever been performed** — this suite has only ever executed against the fixtures and throwaway repo copies described above.',
    '',
  ].join('\n');

  writeFileSync(OUT, md, 'utf8');
  console.log(`Wrote ${OUT} (${criteriaPassCount}/4 criteria passed, ${demoPassCount}/6 demonstrations)`);
  if (!allPass) process.exitCode = 1;
}

main();
