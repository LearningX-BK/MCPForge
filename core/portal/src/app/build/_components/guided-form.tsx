'use client';
// MCPForge — W0-J14: the guided authoring form.
//
// HARD REQUIREMENT (03 §5.3): "a view over the manifest, never a separate
// representation." This component does not hold `id`/`purpose`/`binding.type`
// etc. as its own React state — every field reads its value FROM the parsed
// YAML text on every render and every edit writes back INTO that same text
// via the `yaml` package's `Document.setIn`, which mutates the parsed AST
// in place and re-serializes it — so a comment or a field this form does not
// know about survives untouched, and `String(doc) === yamlText` end to end
// is the round-trip proof this file's own test asserts. There is no second
// data model anywhere in this file: `parseDocument`'s `Document` IS the one
// source of truth, held only for the duration of one render/edit cycle.
import * as React from 'react';
import { Document, parseDocument } from 'yaml';
import { BINDING_TYPES, VERBS, SENSITIVITIES, type BindingType, type ReviewPath, type Sensitivity, type Verb } from '@mcpforge/shared';
import { ReviewPathField } from './review-path-field';

export interface GuidedFormProps {
  readonly yamlText: string;
  readonly onChange: (yamlText: string) => void;
}

function readField(doc: Document.Parsed, path: readonly string[]): unknown {
  return doc.getIn(path);
}

export function GuidedForm({ yamlText, onChange }: GuidedFormProps): React.ReactElement {
  // Re-parsed every render, deliberately: cheap (these manifests are a few
  // KB), and it is what guarantees the form can never read a value the YAML
  // text does not actually contain.
  const doc = React.useMemo(() => parseDocument(yamlText), [yamlText]);

  const setField = React.useCallback(
    (path: readonly string[], value: unknown) => {
      const next = doc.clone();
      next.setIn(path, value);
      onChange(String(next));
    },
    [doc, onChange],
  );

  const id = String(readField(doc, ['id']) ?? '');
  const title = String(readField(doc, ['title']) ?? '');
  const purpose = String(readField(doc, ['purpose']) ?? '');
  const write = readField(doc, ['write']) === true;
  const verb = (readField(doc, ['verb']) as Verb | undefined) ?? 'get';
  const sensitivity = (readField(doc, ['sensitivity']) as Sensitivity | undefined) ?? 'internal';
  const bindingType = (readField(doc, ['binding', 'type']) as BindingType | undefined) ?? 'rest';
  const reviewPath = (readField(doc, ['governance', 'reviewPath']) as ReviewPath | undefined) ?? 'standard';

  return (
    <form
      aria-label="Guided authoring form"
      className="flex flex-col gap-3 overflow-auto p-3"
      onSubmit={(e) => e.preventDefault()}
    >
      <p className="text-[11.5px] text-text-2">
        This form edits the YAML on the left. Nothing here is a separate copy of the manifest.
      </p>

      <label className="flex flex-col gap-1 text-[12px] font-medium text-text-1">
        Tool id
        <input
          data-testid="field-id"
          className="rounded-md border border-line bg-bg-surface px-2 py-1 text-[13px] font-mono text-text-1"
          value={id}
          onChange={(e) => setField(['id'], e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-[12px] font-medium text-text-1">
        Title
        <input
          data-testid="field-title"
          className="rounded-md border border-line bg-bg-surface px-2 py-1 text-[13px] text-text-1"
          value={title}
          onChange={(e) => setField(['title'], e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-[12px] font-medium text-text-1">
        Purpose (≤14 words)
        <textarea
          data-testid="field-purpose"
          className="rounded-md border border-line bg-bg-surface px-2 py-1 text-[13px] text-text-1"
          rows={2}
          value={purpose}
          onChange={(e) => setField(['purpose'], e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-[12px] font-medium text-text-1">
        Verb
        <select
          data-testid="field-verb"
          className="w-fit rounded-md border border-line bg-bg-surface px-2 py-1 text-[13px] text-text-1"
          value={verb}
          onChange={(e) => setField(['verb'], e.target.value)}
        >
          {VERBS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-[12px] font-medium text-text-1">
        <input
          type="checkbox"
          data-testid="field-write"
          checked={write}
          onChange={(e) => setField(['write'], e.target.checked)}
        />
        Write tool
      </label>

      <label className="flex flex-col gap-1 text-[12px] font-medium text-text-1">
        Sensitivity
        <select
          data-testid="field-sensitivity"
          className="w-fit rounded-md border border-line bg-bg-surface px-2 py-1 text-[13px] text-text-1"
          value={sensitivity}
          onChange={(e) => setField(['sensitivity'], e.target.value)}
        >
          {SENSITIVITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-[12px] font-medium text-text-1">
        Binding type
        <select
          data-testid="field-binding-type"
          required
          className="w-fit rounded-md border border-line bg-bg-surface px-2 py-1 text-[13px] text-text-1"
          value={bindingType}
          onChange={(e) => {
            const nextType = e.target.value as BindingType;
            const next = doc.clone();
            next.setIn(['binding', 'type'], nextType);
            if (['plsql', 'function'].includes(nextType)) {
              next.setIn(['governance', 'reviewPath'], 'standard');
            }
            onChange(String(next));
          }}
        >
          {BINDING_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <ReviewPathField
        bindingType={bindingType}
        value={reviewPath}
        onChange={(v) => setField(['governance', 'reviewPath'], v)}
      />
    </form>
  );
}
