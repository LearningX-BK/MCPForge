// @vitest-environment jsdom
//
// MCPForge — W0-J12: the two structural guarantees that cannot be checked by
// looking at one component.
//
//  1. THE VOCABULARY IS FIXED: **Save draft · Propose · Discard** (03 §6.2).
//     "Any button in the product labelled 'Save' that opens a [change
//     proposal] is a defect." Checked twice, deliberately: statically over
//     every `.tsx` in the portal (so a form added tomorrow in a directory
//     this task never touched is still caught), and dynamically over the
//     rendered change flow (so a label assembled at runtime is caught too).
//     The static half looks only at JSX text and label-ish attributes, never
//     at comments — the source files discuss the forbidden words at length
//     and must be allowed to.
//  2. NOTHING ABOVE THE INTERFACE KNOWS WHICH `ChangeHost` IS IN USE
//     (02 §10.1 item 1). No file outside `src/lib/change-host/**` may name
//     `LocalGit`, `HostedGit`, or their modules.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProposeButton } from './propose-button';
import { ProposeDialog } from './propose-dialog';
import { ChangeTray } from '../shell/change-tray';
import { ChangeHostProvider } from '@/lib/change-host';
import { emptyDiff, fixtureProposal, stubHost } from './test-fixtures';

// No global auto-cleanup configured for this package's Vitest runner.
afterEach(cleanup);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../..');
const CHANGE_HOST_DIR = path.join(SRC, 'lib', 'change-host');

function walk(dir: string, extensions: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, extensions));
    else if (extensions.some((extension) => full.endsWith(extension))) out.push(full);
  }
  return out;
}

const FORBIDDEN = ['Save', 'Submit', 'Publish', 'Commit', 'Push'];

/**
 * Both scans are about *code*, not prose. The source files quote 03 §6.2 and
 * 02 §10.1 at length — that is required documentation and must not trip the
 * guard — so comments are stripped before either scan runs.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('03 §6.2 — Save draft · Propose · Discard, and no `Save` button anywhere', () => {
  it('no .tsx file renders a button or label with a forbidden word', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC, ['.tsx'])) {
      if (file.includes('.test.')) continue;
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const word of FORBIDDEN) {
        // JSX text: `>Save<` / `> Save </`. "Save draft" is the permitted form.
        const asText = new RegExp(`>\\s*${word}(?!\\s+draft)\\s*<`, 'g');
        // Attribute forms: label="Save", aria-label='Submit', title={"Push"}.
        const asAttribute = new RegExp(
          `(?:aria-label|label|title|value|placeholder)\\s*=\\s*\\{?["']${word}(?!\\s+draft)["']`,
          'gi',
        );
        if (asText.test(source) || asAttribute.test(source)) {
          offenders.push(`${path.relative(SRC, file)}: "${word}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the rendered change flow exposes no button named Save / Submit / Publish', () => {
    render(
      <ChangeHostProvider
        host={stubHost()}
        repo={{ branch: 'main', remote: { configured: false } }}
      >
        <ProposeButton proposal={fixtureProposal()} host={stubHost()} />
        <ProposeDialog
          open
          onOpenChange={() => {}}
          proposal={fixtureProposal()}
          diff={emptyDiff()}
          remote={{ configured: false }}
          onPropose={() => {}}
        />
        <ChangeTray items={[{ id: 'a', label: 'Add voucher.create', state: 'draft' }]} />
      </ChangeHostProvider>,
    );

    for (const word of FORBIDDEN) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${word}$`, 'i') })).toBeNull();
    }
    expect(screen.getAllByRole('button', { name: 'Propose' }).length).toBeGreaterThan(0);
  });
});

describe('02 §10.1 item 1 — nothing above the interface knows which host is in use', () => {
  it('no file outside src/lib/change-host names LocalGit or HostedGit', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC, ['.ts', '.tsx'])) {
      // Test files are exempt: the contract suite legitimately constructs
      // both implementations (it lives inside change-host/), and this file
      // has to name them to search for them.
      if (file.startsWith(CHANGE_HOST_DIR) || file.includes('.test.')) continue;
      const source = stripComments(readFileSync(file, 'utf8'));
      if (/\b(LocalGit|HostedGit)\b|change-host\/(local-git|hosted-git)/.test(source)) {
        offenders.push(path.relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the change-host barrel exports no implementation', async () => {
    const barrel: Record<string, unknown> = await import('@/lib/change-host');
    expect(Object.keys(barrel)).not.toContain('LocalGit');
    expect(Object.keys(barrel)).not.toContain('HostedGit');
  });

  it('the ChangeHost surface carries no implementation discriminant', () => {
    const host = stubHost() as unknown as Record<string, unknown>;
    for (const key of ['kind', 'isLocal', 'flavour', 'implementation', 'provider']) {
      expect(host[key]).toBeUndefined();
    }
  });
});
