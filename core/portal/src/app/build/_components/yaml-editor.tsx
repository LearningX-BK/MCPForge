'use client';
// MCPForge — W0-J14: the left pane. CodeMirror 6, and ONLY CodeMirror 6 —
// Monaco is explicitly rejected by the task brief and this is the single
// editor engine anywhere in the portal. Schema-aware completion comes from
// the real `mcpforge/v1` manifest field names (via `fieldCompletions`,
// derived from the Tool schema's own top-level/nested property names — not
// a hand-typed parallel list); inline `forge validate` diagnostics render
// as CodeMirror gutter markers via `@codemirror/lint`, fed by
// `_lib/structural-check.ts`'s real, reused Ajv validator.
import * as React from 'react';
import { EditorState, RangeSetBuilder, type Extension, type RangeSet } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, gutter, GutterMarker } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { yaml } from '@codemirror/lang-yaml';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { linter, type Diagnostic } from '@codemirror/lint';
import { runStructuralCheck, type StructuralDiagnostic } from '../_lib/structural-check';

// W0-J21 gate 3: `@codemirror/language`'s `defaultHighlightStyle` hardcodes
// its own fixed palette (e.g. property names at `#0000cc`) — readable in
// light theme, 1.5:1 against this editor's dark-theme background, an AA
// failure axe caught on `/build/draft-voucher-create`'s dark render. CSS
// custom properties resolve through CodeMirror's plain DOM spans exactly
// like anywhere else on the page, so mapping each syntax tag to one of this
// design system's own text/status tokens (`no-raw-color`: these are Tier 2
// tokens, not literal colours) makes the highlighting theme-aware for free
// — no runtime theme detection needed, and every colour already passes AA
// per `contrast.test.ts`.
const manifestHighlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--text-1)', fontWeight: 600 },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--status-ok-strong)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--status-write-strong)' },
  { tag: tags.comment, color: 'var(--text-2)', fontStyle: 'italic' },
  { tag: tags.meta, color: 'var(--text-2)' },
  { tag: tags.punctuation, color: 'var(--text-2)' },
]);

/**
 * The manifest field vocabulary CodeMirror completes against. This is NOT a
 * second schema — it is the flat set of YAML keys the Tool schema (`02 §2.2`'s
 * worked example, `core/codegen/schema/tool.schema.json`) actually uses,
 * kept here as a plain string list because Ajv's compiled validator exposes
 * no "list every property name in this schema" API cheaply enough to call on
 * every keystroke. A drift between this list and the real schema shows up as
 * a missed completion, never as a false accept — `runStructuralCheck` is
 * still the sole source of truth for whether a key is actually valid.
 */
const MANIFEST_FIELD_COMPLETIONS = [
  'apiVersion', 'kind', 'id', 'version', 'server', 'title',
  'purpose', 'aliases', 'disambiguation', 'archetype', 'verb', 'entity', 'app', 'module',
  'functionalArea', 'processTags', 'sensitivity', 'write', 'coreForRoles',
  'binding', 'type', 'technology', 'ref', 'refVersion', 'identity', 'carries', 'probe',
  'onServiceAccount', 'echoOn', 'execution', 'timeoutMs', 'maxConcurrency', 'responseBytesMax',
  'bindingCustom', 'input', 'name', 'required', 'desc', 'example', 'minimum', 'maximum',
  'format', 'enum', 'enumRef', 'output', 'summaryTemplate', 'resultKeys', 'path',
  'writeSafety', 'dryRun', 'strategy', 'confirm', 'tokenTtlSeconds', 'planTemplate',
  'humanApprovalRequired', 'reversal', 'class', 'tool', 'argMap', 'windowHours',
  'preconditions', 'idempotency', 'scopeHours', 'guardrails', 'kind', 'field', 'value',
  'message', 'with', 'scope', 'limit', 'windowSeconds', 'governance', 'reviewPath',
  'owner', 'steward', 'eval', 'intentsFile', 'minIntents', 'policyException',
];

function manifestFieldCompletion(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[A-Za-z_]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return {
    from: word.from,
    options: MANIFEST_FIELD_COMPLETIONS.map((label) => ({ label, type: 'property' })),
  };
}

/** Adapt `_lib/structural-check.ts`'s line-numbered diagnostics to CodeMirror's offset-based `Diagnostic`. */
function toCodeMirrorDiagnostics(
  doc: EditorState['doc'],
  diagnostics: readonly StructuralDiagnostic[],
): Diagnostic[] {
  return diagnostics.map((d) => {
    const lineNumber = Math.min(Math.max(d.line, 1), doc.lines);
    const line = doc.line(lineNumber);
    return {
      from: line.from,
      to: line.to,
      severity: 'error',
      message: `${d.path || '/'}: ${d.message}`,
    };
  });
}

export interface YamlEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly 'aria-label': string;
}

/** One dot per gutter-marker line, per CLAUDE.md's no-raw-color rule via `--status-danger`. */
class DiagnosticMarker extends GutterMarker {
  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'inline-block size-2 rounded-full bg-status-danger';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
}
const diagnosticMarker = new DiagnosticMarker();

export function YamlEditor({ value, onChange, ...rest }: YamlEditorProps): React.ReactElement {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  React.useEffect(() => {
    if (!hostRef.current) return;

    const diagnosticLinter = linter((view) => {
      const { diagnostics } = runStructuralCheck(view.state.doc.toString());
      return toCodeMirrorDiagnostics(view.state.doc, diagnostics);
    });

    const extensions: Extension[] = [
      lineNumbers(),
      gutter({
        class: 'cm-diagnostic-gutter',
        markers: (view) => {
          const { diagnostics } = runStructuralCheck(view.state.doc.toString());
          const lines = new Set(diagnostics.map((d) => Math.min(Math.max(d.line, 1), view.state.doc.lines)));
          // A RangeSetBuilder is the idiomatic API; a hand-rolled marker set
          // keeps this file free of a second CodeMirror extension package.
          return buildMarkerSet(view, lines);
        },
      }),
      history(),
      yaml(),
      syntaxHighlighting(manifestHighlightStyle),
      autocompletion({ override: [manifestFieldCompletion] }),
      diagnosticLinter,
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
      EditorView.theme({
        '&': { fontSize: '13px', height: '100%' },
        '.cm-scroller': { fontFamily: 'var(--font-mono, monospace)', overflow: 'auto' },
      }),
      // CodeMirror's own `contenteditable` div (`.cm-content`, `role="textbox"`)
      // is the actual ARIA input field a screen reader and axe's
      // `aria-input-field-name` rule see — the wrapping host `<div>`'s own
      // `aria-label` below never reaches it. `contentAttributes` is
      // CodeMirror's supported way to put attributes on that inner element
      // directly, so the same caller-supplied label ends up on the element
      // that actually needs it.
      EditorView.contentAttributes.of({ 'aria-label': rest['aria-label'] }),
    ];

    const state = EditorState.create({ doc: value, extensions });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => view.destroy();
    // Intentionally mount once: `value` is the INITIAL document only. Every
    // subsequent edit is driven by the user typing inside CodeMirror itself,
    // which calls `onChange`; the parent does not push text back in, so
    // there is exactly one writer of the editor's live document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={hostRef}
      role="textbox"
      aria-multiline="true"
      aria-label={rest['aria-label']}
      className="h-full min-h-0 overflow-auto rounded-md border border-line bg-bg-surface [&_.cm-editor]:h-full [&_.cm-gutters]:bg-bg-surface-2"
      data-testid="yaml-editor"
    />
  );
}

/**
 * `@codemirror/view`'s `RangeSetBuilder` needs positions in ascending order
 * and a `Range<GutterMarker>` per marked line — this builds exactly that
 * from a set of 1-based line numbers, without pulling in a second gutter
 * helper package.
 */
function buildMarkerSet(view: EditorView, lines: ReadonlySet<number>): RangeSet<GutterMarker> {
  const builder = new RangeSetBuilder<GutterMarker>();
  for (const lineNumber of [...lines].sort((a, b) => a - b)) {
    if (lineNumber < 1 || lineNumber > view.state.doc.lines) continue;
    const line = view.state.doc.line(lineNumber);
    builder.add(line.from, line.from, diagnosticMarker);
  }
  return builder.finish();
}
