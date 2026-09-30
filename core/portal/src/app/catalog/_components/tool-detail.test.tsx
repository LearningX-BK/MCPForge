// @vitest-environment jsdom
//
// W0-P3e: the tool page states consumption only as far as it was read, and a
// status the portal could not read never looks like one the probe reported.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { fixtureCatalogSource } from '../fixtures';
import type { CatalogTool } from '../types';
import { ToolDetail } from './tool-detail';

afterEach(cleanup);

const data = fixtureCatalogSource();
const base = data.tools.find((t) => t.manifest.id === 'jde.ap.voucher.create')!;

function show(tool: CatalogTool) {
  return render(<ToolDetail tool={tool} data={data} />);
}

describe('ToolDetail — W0-P3e runtime facets', () => {
  it('labels a counted volume as the calls the viewer may read, and a capped one as "at least"', () => {
    show({
      ...base,
      consumption: { kind: 'counted', last30dCalls: 1000, consumers: [], atLeast: true },
    });
    const volume = screen.getByTestId('consumption-volume').textContent ?? '';
    expect(volume).toContain('at least 1000');
    expect(volume).toContain('calls you may read');
  });

  it('says why consumption is unavailable, with its next, rather than showing zero', () => {
    show({
      ...base,
      consumption: {
        kind: 'unavailable',
        message: 'Sign in to see who has called this tool.',
        next: 'Sign in.',
      },
    });
    expect(screen.getByTestId('consumption-unavailable').textContent).toContain('Sign in.');
    expect(screen.queryByTestId('consumption-volume')).toBeNull();
  });

  it('shows no count at all when consumption was not loaded (list context)', () => {
    show({ ...base, consumption: undefined });
    expect(screen.getByTestId('consumption-not-loaded')).not.toBeNull();
  });

  it('renders "Status unknown" and "Not probed" as their own states', () => {
    show({ ...base, probeStatus: 'unknown' });
    expect(document.body.textContent).toContain('Status unknown');
    cleanup();
    show({ ...base, probeStatus: 'not_probed' });
    expect(document.body.textContent).toContain('Not probed');
  });
});
