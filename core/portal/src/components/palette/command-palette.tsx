'use client';

// MCPForge — W0-J11: the command palette (03 §9.1, §9.2, §9.4).
//
// "It is backed by `forge.find` over the gateway API — the same index, the
// same ranking, the same score floor as the agents use... A separate
// portal-only search index would let the two surfaces drift, and the drift
// would hide the exact problem the benchmark exists to catch."
//
// SEAM, read `./find-client.ts` first. `/api/find` (03 §9.4) does not exist
// yet — only the MCP transport is built. This component takes a `findClient:
// FindClient` prop typed against the REAL `forge.find` contract
// (`@mcpforge/gateway/meta`, type-only), never a bespoke result shape. A
// later task wires `findClient` to a real `fetch('/api/find', ...)` and
// nothing in this file changes.
//
// TRIGGER SEAM: this component does not own ⌘K or the topbar's search
// button — `shell/topbar.tsx`'s `onOpenCommandPalette` prop (W0-J6) is that
// trigger. A parent composes `<Topbar onOpenCommandPalette={() =>
// setOpen(true)} />` alongside `<CommandPalette open={open} onClose={() => {
// setOpen(false); triggerRef.current?.focus(); }} .../>` — this component
// only calls `onClose`, per 03 §9.2 rule 7 ("`Esc` closes and returns focus
// to the trigger"), and never assumes it owns the trigger element.
import * as React from 'react';
import { cn } from 'cn';

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../ui/command';
import { BindingChip, ProbeStatusChip, VerbChip, WriteChip } from '../chips';
import { readCardFields } from './card-fields';
import type { FindClient, FindInput, FindResponse, FindResultEntry } from './find-client';
import { parseQuery } from './filter-grammar';
import { addRecent, getPins, getRecents } from './local-list';

export type PaletteView = 'all' | 'tools' | 'actions' | 'pages';

export interface PaletteNavItem {
  id: string;
  label: string;
}

const DEFAULT_NAV_ITEMS: readonly PaletteNavItem[] = [
  { id: 'approvals', label: 'Approvals' },
  { id: 'enablement-backlog', label: 'Enablement backlog' },
  { id: 'my-drafts', label: 'My drafts' },
];

const DEFAULT_ACTION_ITEMS: readonly PaletteNavItem[] = [
  { id: 'plan-write', label: 'Plan a write…' },
  { id: 'propose-change', label: 'Propose a change…' },
  { id: 'run-probe', label: 'Run probe' },
];

export interface CommandPaletteProps {
  /** Controlled by the parent — this component never owns its own open state or the trigger. */
  open: boolean;
  /** Fired on Esc and on backdrop click. The parent refocuses its own trigger button. */
  onClose: () => void;
  /** The typed seam onto `forge.find`. See file header. */
  findClient: FindClient;
  /** `Enter` on a tool result — opens the tool's detail. */
  onOpenTool: (toolId: string) => void;
  /** `⌘Enter`/`Ctrl+Enter` on a tool result — opens the run/plan panel directly. Distinct from `onOpenTool`. */
  onPlanTool: (toolId: string) => void;
  /** `no_tool`'s primary action — hands off to Requests, pre-filled with the query text. */
  onRequestCapability: (queryText: string) => void;
  /** "GO TO" destinations (03 §9.2's mockup: Approvals · Enablement backlog · My drafts). */
  onNavigate?: (destinationId: string) => void;
  /** "ACTIONS" (03 §9.2's mockup: Plan a write… · Propose a change… · Run probe). */
  onAction?: (actionId: string) => void;
  navItems?: readonly PaletteNavItem[];
  actionItems?: readonly PaletteNavItem[];
  /** 03 §9.2 rule 8: debounce at 120ms. Overridable so tests don't need to wait 120ms of real time. */
  debounceMs?: number;
  /** Forwarded as `FindInput.limit`. Default 5 (`forge.find`'s own default) when omitted. */
  limit?: number;
  /** Injectable for tests; defaults to `window.localStorage`, guarded for SSR (`./local-list.ts`). */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  className?: string;
}

function toolIdOf(entry: FindResultEntry): string {
  return readCardFields(entry.card).id;
}

function buildFindInput(rawQuery: string, limit: number | undefined): FindInput {
  const parsed = parseQuery(rawQuery);
  return {
    ...(parsed.text ? { query: parsed.text } : {}),
    ...parsed.findInput,
    ...(limit === undefined ? {} : { limit }),
  };
}

export function CommandPalette({
  open,
  onClose,
  findClient,
  onOpenTool,
  onPlanTool,
  onRequestCapability,
  onNavigate,
  onAction,
  navItems = DEFAULT_NAV_ITEMS,
  actionItems = DEFAULT_ACTION_ITEMS,
  debounceMs = 120,
  limit,
  storage,
  className,
}: CommandPaletteProps) {
  const [raw, setRaw] = React.useState('');
  const [response, setResponse] = React.useState<FindResponse | null>(null);
  const [view, setView] = React.useState<PaletteView>('all');
  const [highlighted, setHighlighted] = React.useState('');
  const requestSeq = React.useRef(0);

  React.useEffect(() => {
    if (open) return;
    setRaw('');
    setResponse(null);
    setView('all');
    setHighlighted('');
  }, [open]);

  // 03 §9.2 rule 8: debounce the CLIENT CALL at 120ms — the component itself
  // renders instantly once a result is available, no artificial loading UI.
  React.useEffect(() => {
    if (!open) return;
    const mySeq = ++requestSeq.current;
    const timer = setTimeout(() => {
      findClient(buildFindInput(raw, limit))
        .then((res) => {
          if (requestSeq.current === mySeq) setResponse(res);
        })
        .catch(() => {
          if (requestSeq.current === mySeq) setResponse(null);
        });
    }, debounceMs);
    return () => clearTimeout(timer);
    // findClient is intentionally omitted from the dependency list: its identity
    // churning on every parent render must not restart the debounce window (03
    // §9.2 rule 8's 120ms is a pause on typing, not on re-render).
  }, [raw, open, debounceMs, limit]);

  const recents = React.useMemo(() => getRecents(storage), [storage, open]);
  const pins = React.useMemo(() => getPins(storage), [storage, open]);

  const handleOpenTool = React.useCallback(
    (toolId: string) => {
      addRecent(toolId, storage);
      onOpenTool(toolId);
    },
    [onOpenTool, storage],
  );

  const handlePlanTool = React.useCallback(
    (toolId: string) => {
      addRecent(toolId, storage);
      onPlanTool(toolId);
    },
    [onPlanTool, storage],
  );

  const toolIds = React.useMemo(
    () => new Set(response?.result === 'tools' ? response.tools.map(toolIdOf) : []),
    [response],
  );

  // cmdk auto-highlights the first item internally but does not always emit
  // `onValueChange` for that DEFAULT selection (only for a later change) —
  // observed directly against this task's own tests. Without this, `⌘Enter`
  // pressed immediately after results arrive (a completely normal sequence:
  // type, pause, hit ⌘Enter on the top hit) would see an empty `highlighted`
  // and silently do nothing. This keeps `highlighted` authoritative: default
  // to the top result whenever the current value is no longer one of the
  // results, while still tracking real arrow-key moves via `onValueChange`.
  React.useEffect(() => {
    if (response?.result !== 'tools' || response.tools.length === 0) return;
    setHighlighted((current) => (toolIds.has(current) ? current : toolIdOf(response.tools[0]!)));
  }, [response, toolIds]);

  // CAPTURE phase, deliberately: cmdk's own `Command` root attaches its Enter
  // handling as a bubble-phase `onKeyDown` on a DESCENDANT of this wrapper. A
  // bubble-phase handler here would run AFTER cmdk's, so `⌘Enter` would also
  // fire cmdk's own Enter-selects behaviour (`onOpenTool` via the item's
  // `onSelect`) before this handler got a chance to intercept it. Capturing
  // here and calling `stopPropagation()` for the keys this component owns
  // (Escape, `⌘Enter`, `⌘.`) is what keeps `Enter` and `⌘Enter` distinct, per
  // 03 §9.2 rule 7. Plain `Enter` (no modifier) is left alone in every branch
  // below so it still reaches cmdk normally.
  const handleKeyDownCapture = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (toolIds.has(highlighted)) handlePlanTool(highlighted);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        e.stopPropagation();
        setView((v) => (v === 'all' ? 'tools' : v === 'tools' ? 'actions' : v === 'actions' ? 'pages' : 'all'));
      }
    },
    [onClose, highlighted, toolIds, handlePlanTool],
  );

  if (!open) return null;

  const showTools = view === 'all' || view === 'tools';
  const showPages = view === 'all' || view === 'pages';
  const showActions = view === 'all' || view === 'actions';
  const queryTextForRequest = parseQuery(raw).text || raw;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className={cn('fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-24', className)}
      onKeyDownCapture={handleKeyDownCapture}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Command
        shouldFilter={false}
        value={highlighted}
        onValueChange={setHighlighted}
        className="w-full max-w-xl overflow-hidden rounded-md border border-line bg-surface shadow-lg"
      >
        <CommandInput
          value={raw}
          onValueChange={setRaw}
          placeholder="Search tools, drafts, pages…"
          aria-label="Search tools, drafts and pages"
          autoFocus
        />
        {/*
          `NoToolResult` renders OUTSIDE `CommandList` deliberately: `CommandList`
          is `role="listbox"` (cmdk), and ARIA's `aria-required-children` rule
          rejects a `<ul>`/`<button>` as a direct listbox child — caught by this
          task's own axe pass. `no_tool` has no `option`s to offer, so it is not
          listbox content at all.
        */}
        {response?.result === 'no_tool' ? (
          <NoToolResult response={response} queryText={queryTextForRequest} onRequestCapability={onRequestCapability} />
        ) : null}
        <CommandList>
          {response?.result === 'tools' && showTools ? (
            <CommandGroup heading="Tools">
              {response.choose ? (
                <div
                  role="note"
                  aria-label="Which one?"
                  className="mx-2 my-1 rounded border border-line-strong bg-surface-2 px-2 py-1.5 text-xs text-text-2"
                >
                  {response.choose}
                </div>
              ) : null}
              {response.tools.length === 0 ? (
                <CommandEmpty>No tools matched.</CommandEmpty>
              ) : (
                response.tools.map((entry) => (
                  <ToolResultItem key={toolIdOf(entry)} entry={entry} onSelect={() => handleOpenTool(toolIdOf(entry))} />
                ))
              )}
            </CommandGroup>
          ) : null}

          {!response && raw.trim().length === 0 && showTools && (recents.length > 0 || pins.length > 0) ? (
            <CommandGroup heading="Recent">
              {pins.map((id) => (
                <CommandItem key={`pin:${id}`} value={id} onSelect={() => handleOpenTool(id)}>
                  {id}
                </CommandItem>
              ))}
              {recents
                .filter((id) => !pins.includes(id))
                .map((id) => (
                  <CommandItem key={`recent:${id}`} value={id} onSelect={() => handleOpenTool(id)}>
                    {id}
                  </CommandItem>
                ))}
            </CommandGroup>
          ) : null}

          {showPages ? (
            <CommandGroup heading="Go to">
              {navItems.map((item) => (
                <CommandItem key={item.id} value={`nav:${item.id}`} onSelect={() => onNavigate?.(item.id)}>
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {showActions ? (
            <CommandGroup heading="Actions">
              {actionItems.map((item) => (
                <CommandItem key={item.id} value={`action:${item.id}`} onSelect={() => onAction?.(item.id)}>
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </div>
  );
}

/** 03 §9.2 rule 2: the SAME fields the agent card carries — id, purpose, verb, write, binding, sensitivity, status. */
function ToolResultItem({ entry, onSelect }: { entry: FindResultEntry; onSelect: () => void }) {
  const fields = readCardFields(entry.card);
  const disabled = entry.access === 'disabled';
  const requiresGrant = entry.access === 'requires_grant';

  return (
    <CommandItem value={fields.id} onSelect={onSelect} className="flex flex-col items-start gap-1 py-2">
      <div className="flex w-full flex-wrap items-center gap-1.5">
        <span className="font-mono text-xs font-semibold text-text-1">{fields.id}</span>
        {fields.verb ? <VerbChip verb={fields.verb} /> : null}
        {fields.write ? <WriteChip /> : null}
        {fields.binding ? <BindingChip type={fields.binding} /> : null}
        {fields.status ? <ProbeStatusChip status={fields.status} /> : null}
      </div>
      {fields.purpose ? <p className="text-xs text-text-3">{fields.purpose}</p> : null}
      {/* 03 §9.2 rule 4: disabled tools appear, with their reason (probe `agentMessage`). */}
      {(disabled || requiresGrant) && entry.agentMessage ? (
        <p className="text-xs font-semibold text-status-danger-strong">
          {disabled ? 'Disabled: ' : 'Requires grant: '}
          {entry.agentMessage}
        </p>
      ) : null}
    </CommandItem>
  );
}

/** 03 §9.2 rule 5: `no_tool` is a designed result, not an empty state. */
function NoToolResult({
  response,
  queryText,
  onRequestCapability,
}: {
  response: Extract<FindResponse, { result: 'no_tool' }>;
  queryText: string;
  onRequestCapability: (queryText: string) => void;
}) {
  // No `role="status"` here deliberately: this renders inside cmdk's own
  // `role="listbox"` (`CommandList`), and axe's `aria-required-children`
  // rule (correctly) rejects a `status` landmark as a listbox child — caught
  // by this task's own axe pass, not asserted from the spec.
  return (
    <div className="px-3 py-4">
      <p className="text-sm font-semibold text-text-1">{response.reason}</p>
      {response.nearest.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {response.nearest.map((n) => (
            <li key={n.id} className="flex items-center justify-between gap-2 text-xs text-text-3">
              <span className="font-mono">{n.id}</span>
              <span>{n.score.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-xs text-text-3">{response.next}</p>
      <button
        type="button"
        onClick={() => onRequestCapability(queryText)}
        className="mt-3 rounded-md bg-status-write-strong px-3 py-1.5 text-xs font-semibold text-white focus-visible:outline-2 focus-visible:outline-focus-ring"
      >
        Request this capability
      </button>
    </div>
  );
}
