// MCPForge — W0-Q9: what leaves the machine, and nothing else. Note §4.
//
// A POSITIVE list: this module reads only the fields named here from a draft,
// so a field is never sent by omission-from-a-blocklist. Everything not read
// below is, by construction, never sent: binding.* (refs, technology, hosts),
// writeSafety values (other than the plan template's own text), identity.*,
// governance.*, coreForRoles, anything under consumers/ overlays/ .mcpforge/,
// secretRefs, audit rows and probe reports. `NEVER_SENT` documents that and the
// tests assert it against a draft stuffed with sentinel values.

import { PARAM_DESC_MAX_WORDS, PURPOSE_MAX_WORDS } from '@mcpforge/codegen/rules';

import {
  failure,
  isAllowedField,
  type FieldConstraint,
  type FieldTarget,
  type SuggestFailure,
  type SuggestRequest,
} from './types.js';

export const NEVER_SENT = [
  'binding',
  'writeSafety (except confirm.planTemplate text)',
  'identity',
  'governance',
  'coreForRoles',
  'consumers/',
  'overlays/',
  '.mcpforge/',
  'secretRef://',
  'audit rows',
  'probe reports',
] as const;

export interface SiblingTool {
  readonly id: string;
  readonly purpose: string;
}

/** The linked intake request's business half (W0-Q5), when there is one. */
export interface RequestBusiness {
  readonly does: string;
  readonly goodAnswer?: string;
  readonly inputs?: readonly string[];
}

export interface DraftContext {
  /** The parsed draft manifest. Read through the positive list only. */
  readonly doc: Readonly<Record<string, unknown>>;
  /** Other tools sharing `{app}.{module}.{entity}`; needed for `disambiguation`. */
  readonly siblings?: readonly SiblingTool[];
  readonly request?: RequestBusiness;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const rec = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function inputsOf(doc: Readonly<Record<string, unknown>>): Record<string, unknown>[] {
  return list(doc['input']).map(rec);
}
export function resultKeyNames(doc: Readonly<Record<string, unknown>>): string[] {
  return list(rec(doc['output'])['resultKeys'])
    .map((k) => str(rec(k)['name']))
    .filter((n): n is string => n !== undefined);
}

function constraintFor(target: FieldTarget, ctx: DraftContext): FieldConstraint {
  switch (target.field) {
    case 'purpose':
      return {
        maxWords: PURPOSE_MAX_WORDS,
        description: `One sentence, verb-first, at most ${PURPOSE_MAX_WORDS} words, saying what the tool does. No quotes.`,
      };
    case 'disambiguation': {
      const ids = (ctx.siblings ?? []).map((s) => s.id);
      return {
        mustMention: ids,
        description:
          ids.length === 0
            ? 'One or two sentences saying what this tool is NOT and when to use something else.'
            : `One or two sentences saying what this tool is NOT, naming each sibling tool id (${ids.join(', ')}) and when to use it instead.`,
      };
    }
    case 'aliases':
      return {
        maxItems: 8,
        description: 'Up to 8 short alternative phrases a business user might say, one per line, no numbering.',
      };
    case 'input.desc':
      return {
        maxWords: PARAM_DESC_MAX_WORDS,
        description: `A description of the parameter, at most ${PARAM_DESC_MAX_WORDS} words.`,
      };
    case 'input.example':
      return { description: 'One realistic example value for the parameter, nothing else.' };
    case 'output.summaryTemplate':
      return {
        description: `One sentence summarising the result, using only these {placeholders}: ${resultKeyNames(ctx.doc).join(', ') || '(none declared yet)'}.`,
      };
    case 'writeSafety.confirm.planTemplate':
      return {
        description:
          'The confirmation text a person reads before a write runs. Name the system, the object, the amounts and the business consequence in plain words, ending with a sentence that starts "This ..." stating what changes (for example "This creates an OPEN PAYABLE in JD Edwards.").',
      };
  }
}

/**
 * Build the request, or refuse before any provider is called. The field must be
 * on the closed allow-list; a per-input field must name a real input.
 */
export function buildSuggestRequest(
  target: FieldTarget,
  ctx: DraftContext,
): { ok: true; request: SuggestRequest } | SuggestFailure {
  if (!isAllowedField(target.field)) {
    return failure(
      'AUTHORING_FIELD_NOT_ALLOWED',
      `"${String(target.field)}" is not a field a model may draft.`,
      'Write this field by hand. A model may only draft: purpose, disambiguation, aliases, input.desc, input.example, output.summaryTemplate and writeSafety.confirm.planTemplate.',
    );
  }
  const doc = ctx.doc;
  const context: Record<string, string> = {};
  const put = (k: string, v: unknown): void => {
    const s = typeof v === 'boolean' ? String(v) : str(v);
    if (s !== undefined) context[k] = s;
  };

  put('toolId', doc['id']);
  put('app', doc['app']);
  put('module', doc['module']);
  put('entity', doc['entity']);
  put('verb', doc['verb']);
  put('write', doc['write']);
  put('sensitivity', doc['sensitivity']);
  put('title', doc['title']);
  put('purpose', doc['purpose']);
  put('disambiguation', doc['disambiguation']);
  const aliases = list(doc['aliases']).filter((a): a is string => typeof a === 'string');
  if (aliases.length > 0) context['aliases'] = aliases.join('; ');
  const inputs = inputsOf(doc);
  if (inputs.length > 0) {
    context['inputs'] = inputs
      .map((i) => [str(i['name']), str(i['type']), str(i['desc'])].filter(Boolean).join(' | '))
      .join('\n');
  }
  const keys = resultKeyNames(doc);
  if (keys.length > 0) context['resultKeys'] = keys.join(', ');
  put('planTemplate', rec(rec(doc['writeSafety'])['confirm'])['planTemplate']);
  const sibs = ctx.siblings ?? [];
  if (sibs.length > 0) context['siblings'] = sibs.map((s) => `${s.id}: ${s.purpose}`).join('\n');
  if (ctx.request !== undefined) {
    context['requestDoes'] = ctx.request.does;
    if (ctx.request.goodAnswer) context['requestGoodAnswer'] = ctx.request.goodAnswer;
    if (ctx.request.inputs && ctx.request.inputs.length > 0) {
      context['requestInputs'] = ctx.request.inputs.join(', ');
    }
  }

  if (target.field === 'input.desc' || target.field === 'input.example') {
    const found = inputs.find((i) => i['name'] === target.inputName);
    if (target.inputName === undefined || found === undefined) {
      return failure(
        'AUTHORING_FIELD_NOT_ALLOWED',
        `${target.field} needs the name of an existing input; "${String(target.inputName)}" is not one.`,
        'Name one of the draft\'s declared inputs.',
      );
    }
    context['targetInput'] = [str(found['name']), str(found['type']), str(found['format'])]
      .filter(Boolean)
      .join(' | ');
  }

  return { ok: true, request: { target, constraint: constraintFor(target, ctx), context } };
}

/** The exact text sent to a provider. Shown to the user before the first call (§4). */
export function renderPrompt(request: SuggestRequest): { system: string; user: string } {
  const system =
    'You write short agent-facing copy for a tool catalogue. Reply with the text for the ONE field requested and nothing else: no quotes, no markdown, no YAML, no explanations, no other fields.';
  const target =
    request.target.inputName === undefined
      ? request.target.field
      : `${request.target.field} (parameter "${request.target.inputName}")`;
  const ctxLines = Object.entries(request.context).map(([k, v]) => `${k}: ${v}`);
  const user = [`Field: ${target}`, `Requirement: ${request.constraint.description}`, '', 'Context:', ...ctxLines].join('\n');
  return { system, user };
}
