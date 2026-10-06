// MCPForge — W0-Q9: the ONLY place text from a model is written into a draft.
// Note §5 step 4. It writes exactly one allow-listed path and then PROVES it:
// the parsed document, with that one path removed, must be identical before and
// after. So a response that tries to smuggle YAML, a `binding:` block or a
// `reviewPath` override cannot change anything else: the text only ever becomes
// a string scalar (or a list of strings, for aliases) at the named path.

import { isDeepStrictEqual } from 'node:util';
import { parseDocument } from 'yaml';

import { failure, isAllowedField, type FieldTarget, type SuggestFailure } from './types.js';

type Path = readonly (string | number)[];

function refuse(message: string, next: string): SuggestFailure {
  return failure('AUTHORING_FIELD_NOT_ALLOWED', message, next);
}

export type ApplyResult = { ok: true; yaml: string } | SuggestFailure;

function without(value: unknown, path: Path): unknown {
  const clone = structuredClone(value) as unknown;
  let cur: unknown = clone;
  for (let i = 0; i < path.length - 1; i += 1) {
    if (typeof cur !== 'object' || cur === null) return clone;
    cur = (cur as Record<string | number, unknown>)[path[i]!];
  }
  if (typeof cur === 'object' && cur !== null) {
    delete (cur as Record<string | number, unknown>)[path[path.length - 1]!];
  }
  return clone;
}

export function applySuggestion(yamlText: string, target: FieldTarget, text: string): ApplyResult {
  if (!isAllowedField(target.field)) {
    return refuse(
      `"${String(target.field)}" is not a field a model may write.`,
      'Write this field by hand.',
    );
  }
  const doc = parseDocument(yamlText);
  if (doc.errors.length > 0) {
    return refuse(
      'The draft is not valid YAML, so nothing was written.',
      'Fix the draft in the editor, then apply the suggestion again.',
    );
  }
  const before = doc.toJS() as Record<string, unknown>;

  let path: Path;
  let value: string | string[] = text;
  switch (target.field) {
    case 'purpose':
    case 'disambiguation':
      path = [target.field];
      break;
    case 'aliases':
      path = ['aliases'];
      value = text.split('\n').filter((s) => s.length > 0);
      break;
    case 'output.summaryTemplate':
      path = ['output', 'summaryTemplate'];
      break;
    case 'writeSafety.confirm.planTemplate': {
      // Never CREATE write safety: a plan template is only drafted into a write
      // tool whose confirm block a human already scaffolded.
      const confirm = (before['writeSafety'] as Record<string, unknown> | undefined)?.['confirm'];
      if (typeof confirm !== 'object' || confirm === null) {
        return refuse(
          'This draft has no writeSafety.confirm block, and a model never creates write safety.',
          'Scaffold the write tool with "forge new tool --write" first; then the plan text can be drafted.',
        );
      }
      path = ['writeSafety', 'confirm', 'planTemplate'];
      break;
    }
    case 'input.desc':
    case 'input.example': {
      const inputs = before['input'];
      const index = Array.isArray(inputs)
        ? inputs.findIndex((i) => (i as Record<string, unknown> | null)?.['name'] === target.inputName)
        : -1;
      if (index < 0) {
        return refuse(
          `The draft has no input named "${String(target.inputName)}".`,
          'Name one of the draft\'s declared inputs.',
        );
      }
      path = ['input', index, target.field === 'input.desc' ? 'desc' : 'example'];
      break;
    }
  }

  doc.setIn(path as (string | number)[], value);
  const after = doc.toJS() as Record<string, unknown>;

  // The proof: nothing but the one path moved.
  if (!isDeepStrictEqual(without(before, path), without(after, path))) {
    return refuse(
      'Applying the suggestion would change a field other than the one named. Nothing was written.',
      'Report this as a bug; write the field by hand meanwhile.',
    );
  }
  return { ok: true, yaml: String(doc) };
}
