// MCPForge — the poll-to-notification bridge, unit level. W0-E5.
// (The real-wire proof is `./pipeline.e2e.test.ts`.)

import { describe, expect, it, vi } from 'vitest';
import { inMemoryRuntimeFlags } from '../scope/sources.js';
import { watchForKillSwitchChanges } from './notify.js';

describe('watchForKillSwitchChanges', () => {
  it('does not notify when nothing changed', async () => {
    const source = inMemoryRuntimeFlags([]);
    const notifier = { sendToolListChanged: vi.fn() };
    const watch = watchForKillSwitchChanges(source, notifier);

    expect(await watch.checkAndNotify()).toBe(false);
    expect(notifier.sendToolListChanged).not.toHaveBeenCalled();
  });

  it('notifies exactly once when the active set changes', async () => {
    const source = inMemoryRuntimeFlags([]);
    const notifier = { sendToolListChanged: vi.fn() };
    const watch = watchForKillSwitchChanges(source, notifier);

    source.set([{ scope: 'tool', target: 't1', reason: 'r', until: null }]);
    expect(await watch.checkAndNotify()).toBe(true);
    expect(notifier.sendToolListChanged).toHaveBeenCalledTimes(1);

    // No further change -> no further notification.
    expect(await watch.checkAndNotify()).toBe(false);
    expect(notifier.sendToolListChanged).toHaveBeenCalledTimes(1);
  });

  it('notifies again when the set changes back', async () => {
    const source = inMemoryRuntimeFlags([
      { scope: 'tool', target: 't1', reason: 'r', until: null },
    ]);
    const notifier = { sendToolListChanged: vi.fn() };
    const watch = watchForKillSwitchChanges(source, notifier);
    watch.primeBaseline();

    source.set([]);
    expect(await watch.checkAndNotify()).toBe(true);
    expect(notifier.sendToolListChanged).toHaveBeenCalledTimes(1);
  });

  it('reports a notifier failure via onError rather than throwing', async () => {
    const source = inMemoryRuntimeFlags([]);
    const notifier = {
      sendToolListChanged: vi.fn().mockRejectedValue(new Error('wire down')),
    };
    const errors: unknown[] = [];
    const watch = watchForKillSwitchChanges(source, notifier, {
      onError: (e) => errors.push(e),
    });

    source.set([{ scope: 'deployment', target: 'dep-1', reason: 'freeze', until: null }]);
    await expect(watch.checkAndNotify()).resolves.toBe(true);
    expect(errors).toHaveLength(1);
  });
});
