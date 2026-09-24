// @vitest-environment jsdom
//
// MCPForge — W0-J13: the Agent view renders all three representations with
// measured (not fabricated) token counts.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AgentView } from './agent-view';
import { fixtureCatalogSource } from '../fixtures';
import { buildCard } from '../agent-representations';

afterEach(cleanup);

const manifest = fixtureCatalogSource().tools.find((t) => t.manifest.id === 'jde.ap.voucher.create')!.manifest;

describe('AgentView', () => {
  it('renders three representation panels, each with a token-count badge', () => {
    render(<AgentView manifest={manifest} />);
    const counts = screen.getAllByTestId('agent-rep-token-count');
    expect(counts).toHaveLength(3);
  });

  it("the card panel's displayed count matches the real measured count", () => {
    render(<AgentView manifest={manifest} />);
    const card = buildCard(manifest);
    expect(screen.getByText(`${card.tokens} / 60 tokens`)).not.toBeNull();
  });
});
