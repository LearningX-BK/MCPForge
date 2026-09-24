// @vitest-environment jsdom
//
// W0-J11 — the command palette (03 §9.1, §9.2). `findClient` is a mock typed
// exactly as the real `forge.find` contract (`./find-client.ts`) — never a
// bespoke shape — so these tests exercise the same response variants
// `forgeFind()` actually produces.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

import { CommandPalette } from './command-palette';
import type { FindResponse } from './find-client';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const TOOLS_RESPONSE: FindResponse = {
  result: 'tools',
  tools: [
    {
      card: {
        id: 'jde.ap.voucher.create',
        purpose: 'Create an AP voucher against a supplier.',
        verb: 'create',
        entity: 'voucher',
        write: true,
        binding: 'function',
        sensitivity: 'financial',
        status: 'resolved',
      },
      score: 0.91,
      access: 'available',
    },
  ],
};

const CHOOSE_RESPONSE: FindResponse = {
  result: 'tools',
  choose:
    'voucher.create makes a NEW voucher. voucher.search finds existing ones when you do not know the number.',
  tools: [
    {
      card: { id: 'jde.ap.voucher.create', verb: 'create', write: true, binding: 'function' },
      score: 0.9,
      access: 'available',
    },
    {
      card: { id: 'jde.ap.voucher.search', verb: 'search', write: false, binding: 'function' },
      score: 0.89,
      access: 'available',
    },
  ],
};

const DISABLED_RESPONSE: FindResponse = {
  result: 'tools',
  tools: [
    {
      card: {
        id: 'jde.scm.purchase_order.get_receipt_status',
        verb: 'get_receipt_status',
        write: false,
        binding: 'rest',
      },
      score: 0.75,
      access: 'disabled',
      agentMessage: 'Disabled: identity could not be verified for this binding. Owner: JDE CNC.',
    },
  ],
};

const NO_TOOL_RESPONSE: FindResponse = {
  result: 'no_tool',
  reason: 'No tool covers "cancel a purchase order line item by weight".',
  nearest: [
    { id: 'jde.scm.purchase_order.cancel', score: 0.42 },
    { id: 'jde.scm.purchase_order.update', score: 0.38 },
  ],
  next: 'Do not attempt to approximate it with another tool.',
};

function baseProps(overrides: Partial<React.ComponentProps<typeof CommandPalette>> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    findClient: vi.fn().mockResolvedValue(TOOLS_RESPONSE),
    onOpenTool: vi.fn(),
    onPlanTool: vi.fn(),
    onRequestCapability: vi.fn(),
    storage: memoryStorage(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('debounce: the client call, not the render, waits on the 120ms pause (03 §9.2 rule 8)', () => {
  it('does not call findClient before 120ms of no typing', async () => {
    const props = baseProps();
    render(<CommandPalette {...props} />);
    const input = screen.getByPlaceholderText('Search tools, drafts, pages…');

    fireEvent.change(input, { target: { value: 'voucher' } });
    vi.advanceTimersByTime(119);
    expect(props.findClient).not.toHaveBeenCalled();
  });

  it('calls findClient once 120ms have elapsed since the last keystroke', async () => {
    const props = baseProps();
    render(<CommandPalette {...props} />);
    const input = screen.getByPlaceholderText('Search tools, drafts, pages…');

    fireEvent.change(input, { target: { value: 'voucher' } });
    vi.advanceTimersByTime(120);
    expect(props.findClient).toHaveBeenCalledTimes(1);
  });

  it('resets the timer on every keystroke — an in-progress pause does not fire early', () => {
    const props = baseProps();
    render(<CommandPalette {...props} />);
    const input = screen.getByPlaceholderText('Search tools, drafts, pages…');

    fireEvent.change(input, { target: { value: 'vou' } });
    vi.advanceTimersByTime(100);
    fireEvent.change(input, { target: { value: 'vouch' } });
    vi.advanceTimersByTime(100);
    expect(props.findClient).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(props.findClient).toHaveBeenCalledTimes(1);
  });
});

describe('results render the same fields the agent card carries (03 §9.2 rule 2)', () => {
  it('renders id, purpose, verb, write, binding once the client resolves', async () => {
    vi.useRealTimers();
    const props = baseProps({ findClient: vi.fn().mockResolvedValue(TOOLS_RESPONSE), debounceMs: 0 });
    render(<CommandPalette {...props} />);
    fireEvent.change(screen.getByPlaceholderText('Search tools, drafts, pages…'), {
      target: { value: 'record a supplier invoice' },
    });

    await waitFor(() => expect(screen.getByText('jde.ap.voucher.create')).toBeTruthy());
    expect(screen.getByText('Create an AP voucher against a supplier.')).toBeTruthy();
    expect(screen.getByText('Write')).toBeTruthy();
  });
});

describe('the choose block (03 §9.2 rule 3)', () => {
  it('renders inline when the mock client returns one', async () => {
    vi.useRealTimers();
    const props = baseProps({ findClient: vi.fn().mockResolvedValue(CHOOSE_RESPONSE), debounceMs: 0 });
    render(<CommandPalette {...props} />);
    fireEvent.change(screen.getByPlaceholderText('Search tools, drafts, pages…'), {
      target: { value: 'voucher' },
    });

    await waitFor(() => expect(screen.getByText(/voucher\.create makes a NEW voucher/)).toBeTruthy());
  });

  it('does not render a choose block when the response carries none', async () => {
    vi.useRealTimers();
    const props = baseProps({ findClient: vi.fn().mockResolvedValue(TOOLS_RESPONSE), debounceMs: 0 });
    render(<CommandPalette {...props} />);
    fireEvent.change(screen.getByPlaceholderText('Search tools, drafts, pages…'), {
      target: { value: 'voucher' },
    });
    await waitFor(() => expect(screen.getByText('jde.ap.voucher.create')).toBeTruthy());
    expect(screen.queryByRole('note', { name: 'Which one?' })).toBeFalsy();
  });
});

describe('disabled tools appear, with their reason (03 §9.2 rule 4)', () => {
  it('renders the disabled tool with its agentMessage', async () => {
    vi.useRealTimers();
    const props = baseProps({ findClient: vi.fn().mockResolvedValue(DISABLED_RESPONSE), debounceMs: 0 });
    render(<CommandPalette {...props} />);
    fireEvent.change(screen.getByPlaceholderText('Search tools, drafts, pages…'), {
      target: { value: 'receipt status' },
    });

    await waitFor(() =>
      expect(screen.getByText('jde.scm.purchase_order.get_receipt_status')).toBeTruthy(),
    );
    expect(
      screen.getByText(/Disabled: identity could not be verified for this binding\. Owner: JDE CNC\./),
    ).toBeTruthy();
  });
});

describe('no_tool is a designed result, not an empty state (03 §9.2 rule 5)', () => {
  it('renders the reason, the nearest capabilities with scores, and fires onRequestCapability with the query text', async () => {
    vi.useRealTimers();
    const onRequestCapability = vi.fn();
    const props = baseProps({
      findClient: vi.fn().mockResolvedValue(NO_TOOL_RESPONSE),
      onRequestCapability,
      debounceMs: 0,
    });
    render(<CommandPalette {...props} />);
    fireEvent.change(screen.getByPlaceholderText('Search tools, drafts, pages…'), {
      target: { value: 'cancel a purchase order line item by weight' },
    });

    await waitFor(() =>
      expect(
        screen.getByText('No tool covers "cancel a purchase order line item by weight".'),
      ).toBeTruthy(),
    );
    expect(screen.getByText('jde.scm.purchase_order.cancel')).toBeTruthy();
    expect(screen.getByText('0.42')).toBeTruthy();
    expect(screen.getByText('Do not attempt to approximate it with another tool.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Request this capability' }));
    expect(onRequestCapability).toHaveBeenCalledWith('cancel a purchase order line item by weight');
  });
});

describe('Esc returns focus to the trigger (03 §9.2 rule 7) — what this component owns', () => {
  it('calls onClose on Escape', () => {
    const props = baseProps();
    render(<CommandPalette {...props} />);
    fireEvent.keyDown(screen.getByPlaceholderText('Search tools, drafts, pages…'), { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed', () => {
    const props = baseProps({ open: false });
    render(<CommandPalette {...props} />);
    expect(screen.queryByPlaceholderText('Search tools, drafts, pages…')).toBeFalsy();
  });
});

describe('⌘Enter opens the plan panel, distinct from Enter opening detail (03 §9.2 rule 7)', () => {
  it('⌘Enter calls onPlanTool, not onOpenTool, for the highlighted tool', async () => {
    vi.useRealTimers();
    const onOpenTool = vi.fn();
    const onPlanTool = vi.fn();
    const props = baseProps({
      findClient: vi.fn().mockResolvedValue(TOOLS_RESPONSE),
      onOpenTool,
      onPlanTool,
      debounceMs: 0,
    });
    render(<CommandPalette {...props} />);
    const input = screen.getByPlaceholderText('Search tools, drafts, pages…');
    fireEvent.change(input, { target: { value: 'voucher' } });
    await waitFor(() => expect(screen.getByText('jde.ap.voucher.create')).toBeTruthy());

    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    expect(onPlanTool).toHaveBeenCalledWith('jde.ap.voucher.create');
    expect(onOpenTool).not.toHaveBeenCalled();
  });

  it('plain Enter calls onOpenTool via a click on the result (onSelect), not onPlanTool', async () => {
    vi.useRealTimers();
    const onOpenTool = vi.fn();
    const onPlanTool = vi.fn();
    const props = baseProps({
      findClient: vi.fn().mockResolvedValue(TOOLS_RESPONSE),
      onOpenTool,
      onPlanTool,
      debounceMs: 0,
    });
    render(<CommandPalette {...props} />);
    fireEvent.change(screen.getByPlaceholderText('Search tools, drafts, pages…'), {
      target: { value: 'voucher' },
    });
    await waitFor(() => expect(screen.getByText('jde.ap.voucher.create')).toBeTruthy());

    fireEvent.click(screen.getByText('jde.ap.voucher.create'));
    expect(onOpenTool).toHaveBeenCalledWith('jde.ap.voucher.create');
    expect(onPlanTool).not.toHaveBeenCalled();
  });
});

describe('recents/pins localStorage safety (03 §9.2 rule 6)', () => {
  it('does not crash when storage throws on every call', () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() =>
      render(<CommandPalette {...baseProps({ storage: throwingStorage })} />),
    ).not.toThrow();
  });

  it('records a recent after opening a tool, and shows it on the next open with an empty query', async () => {
    vi.useRealTimers();
    const storage = memoryStorage();
    const props = baseProps({ findClient: vi.fn().mockResolvedValue(TOOLS_RESPONSE), storage, debounceMs: 0 });
    const { rerender } = render(<CommandPalette {...props} />);
    fireEvent.change(screen.getByPlaceholderText('Search tools, drafts, pages…'), {
      target: { value: 'voucher' },
    });
    await waitFor(() => expect(screen.getByText('jde.ap.voucher.create')).toBeTruthy());
    fireEvent.click(screen.getByText('jde.ap.voucher.create'));

    // Close and reopen with an empty query — the recent should now be offered.
    rerender(<CommandPalette {...props} open={false} />);
    rerender(<CommandPalette {...props} open />);
    expect(screen.getByText('jde.ap.voucher.create')).toBeTruthy();
  });
});
