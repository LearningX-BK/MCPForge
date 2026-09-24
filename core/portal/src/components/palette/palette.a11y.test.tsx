// @vitest-environment jsdom
//
// W0-J11 — accessibility. cmdk's own `Command` primitive should already
// carry most ARIA combobox semantics per the task brief ("verify, don't
// assume") — this asserts a real axe pass at the same
// serious/critical threshold the rest of the portal uses
// (`../chips/chips.a11y.test.tsx`).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

import { CommandPalette } from './command-palette';
import type { FindResponse } from './find-client';

const TOOLS_RESPONSE: FindResponse = {
  result: 'tools',
  tools: [
    {
      card: {
        id: 'jde.ap.voucher.create',
        purpose: 'Create an AP voucher against a supplier.',
        verb: 'create',
        write: true,
        binding: 'function',
      },
      score: 0.9,
      access: 'available',
    },
  ],
};

const NO_TOOL_RESPONSE: FindResponse = {
  result: 'no_tool',
  reason: 'No tool covers that.',
  nearest: [{ id: 'jde.scm.purchase_order.cancel', score: 0.4 }],
  next: 'Do not attempt to approximate it with another tool.',
};

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe('CommandPalette — zero serious/critical axe violations', () => {
  it('the empty (just-opened) palette', async () => {
    const { container } = render(
      <CommandPalette
        open
        onClose={vi.fn()}
        findClient={vi.fn().mockResolvedValue({ result: 'tools', tools: [] } satisfies FindResponse)}
        onOpenTool={vi.fn()}
        onPlanTool={vi.fn()}
        onRequestCapability={vi.fn()}
        storage={memoryStorage()}
      />,
    );
    const results = await axe(container);
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });

  it('a populated tools result list', async () => {
    const { container } = render(
      <CommandPalette
        open
        onClose={vi.fn()}
        findClient={vi.fn().mockResolvedValue(TOOLS_RESPONSE)}
        onOpenTool={vi.fn()}
        onPlanTool={vi.fn()}
        onRequestCapability={vi.fn()}
        storage={memoryStorage()}
        debounceMs={0}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('Search tools, drafts, pages…'), {
      target: { value: 'voucher' },
    });
    await waitFor(() => expect(screen.getByText('jde.ap.voucher.create')).toBeTruthy());

    const results = await axe(container);
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });

  it('a no_tool designed result, with the Request this capability action', async () => {
    const { container } = render(
      <CommandPalette
        open
        onClose={vi.fn()}
        findClient={vi.fn().mockResolvedValue(NO_TOOL_RESPONSE)}
        onOpenTool={vi.fn()}
        onPlanTool={vi.fn()}
        onRequestCapability={vi.fn()}
        storage={memoryStorage()}
        debounceMs={0}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('Search tools, drafts, pages…'), {
      target: { value: 'something odd' },
    });
    await waitFor(() => expect(screen.getByText('No tool covers that.')).toBeTruthy());

    const results = await axe(container);
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });
});
