// `forge probe --json` — W0-H4. In-process (no subprocess): the orchestrator's
// own coverage lives in core/probe; this asserts the CLI seam — argument
// handling, the JSON envelope on stdout, and that the artefact it writes
// validates against probe-report.schema.json.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadProbeReport, validateProbeReport } from '@mcpforge/probe';
import { runProbeCommand } from './probe.js';

const dirs: string[] = [];
function repoWithCatalogue(): string {
  const root = mkdtempSync(join(tmpdir(), 'mcpforge-probe-cli-'));
  dirs.push(root);
  mkdirSync(join(root, 'generated', 'index'), { recursive: true });
  writeFileSync(
    join(root, 'generated', 'index', 'catalogue-index.json'),
    JSON.stringify({
      tools: [
        {
          id: 'jde.ap.voucher.create',
          filters: {
            app: 'jde',
            module: 'ap',
            entity: 'voucher',
            verb: 'create',
            bindingType: 'function',
            archetype: 'transactional',
            sensitivity: 'financial',
            write: true,
            processTags: [],
            packageTags: [],
            roles: [],
            status: 'unresolved',
          },
          lexicalDocument: 'create a voucher',
          disambiguation: null,
        },
      ],
    }),
    'utf8',
  );
  return root;
}

function captureStdout(): { text: () => string; restore: () => void } {
  let buf = '';
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    buf += String(chunk);
    return true;
  });
  return { text: () => buf, restore: () => spy.mockRestore() };
}

afterEach(() => {
  vi.restoreAllMocks();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('forge probe', () => {
  it('--json emits the schema-valid report on stdout and writes the artefact', async () => {
    const root = repoWithCatalogue();
    const out = captureStdout();
    const code = await runProbeCommand({ json: true, root });
    out.restore();
    expect(code).toBe(0);

    const parsed: unknown = JSON.parse(out.text());
    expect(validateProbeReport(parsed).violations).toEqual([]);

    const onDisk = loadProbeReport(root);
    expect(onDisk.tools).toHaveLength(1);
    // No executor is registered at Wave 0 — the honest answer, not a pass.
    expect(onDisk.tools[0]!.status).toBe('disabled_missing_binding');
    expect(onDisk.tools[0]!.agentMessage).toContain('Do not retry');
    expect(onDisk.target.mutatingChecksRefused).toBe(true);
  });

  it('accepts every environment class 02 §7.1 names and refuses anything else', async () => {
    const root = repoWithCatalogue();
    for (const env of ['local', 'probe', 'staging', 'prod']) {
      const out = captureStdout();
      const code = await runProbeCommand({ json: true, root, env });
      out.restore();
      expect(code).toBe(0);
      expect(JSON.parse(out.text())).toMatchObject({ target: { environmentClass: env } });
    }

    const out = captureStdout();
    const code = await runProbeCommand({ json: true, root, env: 'production-ish' });
    out.restore();
    expect(code).toBe(64);
    const envelope = JSON.parse(out.text()) as { code: string; next: string };
    expect(envelope.code).toBe('INPUT_INVALID');
    expect(envelope.next.length).toBeGreaterThan(0);
  });

  it('fails with a named next when the catalogue index has not been generated', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcpforge-probe-empty-'));
    dirs.push(root);
    const out = captureStdout();
    const code = await runProbeCommand({ json: true, root });
    out.restore();
    expect(code).toBe(64);
    const envelope = JSON.parse(out.text()) as { code: string; next: string };
    expect(envelope.code).toBe('CATALOGUE_UNAVAILABLE');
    expect(envelope.next).toContain('forge codegen');
  });
});
