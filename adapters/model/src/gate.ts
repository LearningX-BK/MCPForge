// MCPForge — W0-Q9: the structural gate every suggestion passes before a human
// even sees it as acceptable. Note §5 step 3. A refusal here names the limit.
//
// Word limits come from the SAME constants `forge validate` enforces
// (`@mcpforge/codegen/rules`), not copies. The codegen token budgets (card,
// describe, role core set) can only be measured on a BUILT tool, so they are
// enforced where they always are: `forge codegen`/`forge validate`, which the
// merge check runs on the proposal. A suggestion that busts one fails the merge,
// it is not silently trimmed.

import { PARAM_DESC_MAX_WORDS, PURPOSE_MAX_WORDS } from '@mcpforge/codegen/rules';

import { inputsOf, resultKeyNames, type DraftContext } from './payload.js';
import { failure, type AllowedField, type FieldTarget, type SuggestFailure } from './types.js';

const words = (t: string): number => t.trim().split(/\s+/).filter((w) => w.length > 0).length;

function refuse(message: string, next: string): SuggestFailure {
  return failure('AUTHORING_GATE_REFUSED', message, next);
}

/** Models like to wrap a single value in quotes or backticks. Strip one matching layer. */
function clean(raw: string): string {
  let t = raw.trim();
  const pairs: [string, string][] = [['"', '"'], ["'", "'"], ['`', '`']];
  for (const [a, b] of pairs) {
    if (t.length >= 2 && t.startsWith(a) && t.endsWith(b)) t = t.slice(1, -1).trim();
  }
  return t;
}

function placeholdersIn(text: string): string[] {
  return [...text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]!);
}

const STILL_PLACEHOLDER = /\bREPLACE\b/;

export function checkSuggestion(
  target: FieldTarget,
  raw: string,
  ctx: DraftContext,
): { ok: true; text: string } | SuggestFailure {
  const field: AllowedField = target.field;
  const text = clean(raw);
  if (text.length === 0) {
    return refuse('The model returned no text.', 'Ask again, or write this field by hand.');
  }
  if (text.includes('secretRef://')) {
    return refuse(
      'The suggestion contains a secret reference.',
      'Discard it and write this field by hand: copy never carries a credential or a reference to one.',
    );
  }
  if (STILL_PLACEHOLDER.test(text)) {
    return refuse(
      'The suggestion still contains a REPLACE placeholder.',
      'Ask again, or write this field by hand.',
    );
  }

  // Structure is never copy. JSON, a YAML document marker, or a leading `key: value`
  // is a model trying to supply another field. (A `{placeholder}` is fine.)
  if (/^\s*[[{]\s*["{[]/.test(text) || /^---/.test(text) || /^[a-z_][a-zA-Z0-9_.]*:\s/.test(text)) {
    return refuse(
      `The suggestion for ${field} looks like structured data (JSON or YAML), not copy. A model supplies one value, never other fields.`,
      'Discard it and ask again, or write this field by hand.',
    );
  }

  // Every field is one value. Only `aliases` is a list, one per line.
  if (field !== 'aliases' && /[\r\n]/.test(text)) {
    return refuse(
      `The suggestion for ${field} spans several lines. A field is one value; a model cannot supply other fields or structure.`,
      'Discard it and ask again, or write this field by hand.',
    );
  }

  switch (field) {
    case 'purpose': {
      const n = words(text);
      if (n > PURPOSE_MAX_WORDS) {
        return refuse(
          `purpose is ${n} words; the budget is ${PURPOSE_MAX_WORDS} (03 §10.3).`,
          'Ask again for a shorter one, or edit it down before accepting.',
        );
      }
      return { ok: true, text };
    }
    case 'input.desc': {
      const n = words(text);
      if (n > PARAM_DESC_MAX_WORDS) {
        return refuse(
          `parameter desc is ${n} words; the budget is ${PARAM_DESC_MAX_WORDS} (03 §10.3).`,
          'Ask again for a shorter one, or edit it down before accepting.',
        );
      }
      return { ok: true, text };
    }
    case 'input.example': {
      const input = inputsOf(ctx.doc).find((i) => i['name'] === target.inputName);
      const type = input?.['type'];
      if ((type === 'number' || type === 'integer') && Number.isNaN(Number(text))) {
        return refuse(
          `The example "${text}" is not a ${String(type)}, which is what this parameter is.`,
          'Ask again, or type a valid example.',
        );
      }
      if (type === 'integer' && !Number.isInteger(Number(text))) {
        return refuse(`The example "${text}" is not an integer.`, 'Ask again, or type a valid example.');
      }
      if (type === 'boolean' && text !== 'true' && text !== 'false') {
        return refuse(`The example "${text}" is not true or false.`, 'Ask again, or type a valid example.');
      }
      if (text.length > 80) {
        return refuse('The example is longer than 80 characters.', 'Ask again for a shorter one.');
      }
      return { ok: true, text };
    }
    case 'aliases': {
      const items = text
        .split(/[\r\n]+/)
        .map((s) => s.replace(/^[-*\d.)\s]+/, '').trim())
        .filter((s) => s.length > 0);
      if (items.length === 0) return refuse('No aliases were returned.', 'Ask again.');
      if (items.length > 8) {
        return refuse(
          `${items.length} aliases were returned; the limit is 8 (02 §2.2).`,
          'Keep the best 8 before accepting, or ask again.',
        );
      }
      if (items.some((i) => words(i) > 6)) {
        return refuse('An alias is longer than 6 words.', 'Ask again for short phrases.');
      }
      return { ok: true, text: items.join('\n') };
    }
    case 'disambiguation': {
      const missing = (ctx.siblings ?? []).map((s) => s.id).filter((id) => !text.includes(id));
      if (missing.length > 0) {
        return refuse(
          `disambiguation must name every sibling tool; missing ${missing.join(', ')}.`,
          'Ask again, or add the missing tool ids by hand.',
        );
      }
      return { ok: true, text };
    }
    case 'output.summaryTemplate': {
      const declared = new Set(resultKeyNames(ctx.doc));
      const bad = placeholdersIn(text).filter((p) => !declared.has(p));
      if (bad.length > 0) {
        return refuse(
          `summaryTemplate uses {${bad.join('}, {')}}, which are not declared resultKeys (${[...declared].join(', ') || 'none yet'}).`,
          'Declare those result keys first, or ask again.',
        );
      }
      return { ok: true, text };
    }
    case 'writeSafety.confirm.planTemplate': {
      if (!/\bThis\b[^.]*\./.test(text)) {
        return refuse(
          'The plan text does not state the business consequence ("This creates ...").',
          'Ask again, or add the consequence sentence by hand: in a chat client this string is the entire UI.',
        );
      }
      return { ok: true, text };
    }
  }
}
