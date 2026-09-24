// MCPForge — W0-B3 agent-facing copy and token-budget rules.
// 03 §10.3 (copy standards), 02 §2.2, §5.3, §5.5, §2.7 (the `calls` rejection).
//
//   policy.sibling-disambiguation — two tools sharing {app}.{module}.{entity}
//                                   must BOTH carry a disambiguation string
//   policy.purpose-word-budget    — purpose <= 14 words
//   policy.param-desc-word-budget — parameter desc <= 12 words
//   policy.inline-enum-too-long   — enums over 12 values must use enumRef
//   policy.calls-field            — a `calls` field anywhere is rejected
//
// These are agent-facing UI. In a chat client the card and the plan string are
// the entire UI, and the budgets are what keep the resident set inside the
// 1,300-token role ceiling (02 §5.3).

import type {
  IndexedManifest,
  RepoContext,
  ValidationFailure,
  ValidationRule,
} from '../validate/types.js';
import { fail, isRecord, tools, wordCount } from './helpers.js';

export const PURPOSE_MAX_WORDS = 14;
export const PARAM_DESC_MAX_WORDS = 12;
export const INLINE_ENUM_MAX_VALUES = 12;

/** The `{app}.{module}.{entity}` sibling key, from the declared fields, falling back to the id. */
function siblingKey(m: IndexedManifest): string | null {
  const app = m.doc['app'];
  const module = m.doc['module'];
  const entity = m.doc['entity'];
  if (typeof app === 'string' && typeof module === 'string' && typeof entity === 'string') {
    return `${app}.${module}.${entity}`;
  }
  const parts = m.id.split('.');
  return parts.length === 4 ? parts.slice(0, 3).join('.') : null;
}

const siblingsCarryDisambiguation: ValidationRule = {
  id: 'policy.sibling-disambiguation',
  check(ctx: RepoContext): ValidationFailure[] {
    const groups = new Map<string, IndexedManifest[]>();
    for (const m of tools(ctx)) {
      const key = siblingKey(m);
      if (key === null) continue;
      const list = groups.get(key);
      if (list) list.push(m);
      else groups.set(key, [m]);
    }

    const out: ValidationFailure[] = [];
    for (const [key, group] of groups) {
      if (group.length < 2) continue;
      const siblingIds = group.map((m) => m.id);
      for (const m of group) {
        const disambiguation = m.doc['disambiguation'];
        if (typeof disambiguation === 'string' && disambiguation.trim().length > 0) continue;
        out.push(
          fail(
            this.id,
            m.file.file,
            '/disambiguation',
            `"${m.id}" shares the ${key} prefix with ${siblingIds.filter((id) => id !== m.id).join(', ')} but carries no disambiguation. The requirement is mutual: every tool in a sibling set must say how it differs (02 §5.5).`,
            `Add a disambiguation string naming each sibling by id — e.g. one sentence per sibling, written by the steward (03 §10.3): "…To find existing records use ${siblingIds.find((id) => id !== m.id) ?? '<sibling id>'}."`,
          ),
        );
      }
    }
    return out;
  },
};

const purposeWithinWordBudget: ValidationRule = {
  id: 'policy.purpose-word-budget',
  check(ctx: RepoContext): ValidationFailure[] {
    const out: ValidationFailure[] = [];
    for (const m of tools(ctx)) {
      const purpose = m.doc['purpose'];
      if (typeof purpose !== 'string') continue;
      const words = wordCount(purpose);
      if (words <= PURPOSE_MAX_WORDS) continue;
      out.push(
        fail(
          this.id,
          m.file.file,
          '/purpose',
          `purpose is ${words} words; the budget is ${PURPOSE_MAX_WORDS} (03 §10.3). This string is agent-facing UI and it counts against the role's resident token budget.`,
          'Rewrite verb-first, saying what the tool does and never how — no product names, no "This tool…". Detail belongs in disambiguation and in the describe payload, not in the card.',
        ),
      );
    }
    return out;
  },
};

const paramDescWithinWordBudget: ValidationRule = {
  id: 'policy.param-desc-word-budget',
  check(ctx: RepoContext): ValidationFailure[] {
    const out: ValidationFailure[] = [];
    for (const m of tools(ctx)) {
      const inputs = m.doc['input'];
      if (!Array.isArray(inputs)) continue;
      inputs.forEach((input, i) => {
        if (!isRecord(input)) return;
        const desc = input['desc'];
        if (typeof desc !== 'string') return;
        const words = wordCount(desc);
        if (words <= PARAM_DESC_MAX_WORDS) return;
        out.push(
          fail(
            this.id,
            m.file.file,
            `/input/${i}/desc`,
            `parameter desc is ${words} words; the budget is ${PARAM_DESC_MAX_WORDS} (03 §10.3).`,
            'Cut it to one line that names the unit or format if there is one — e.g. "Gross amount in company currency." Constraints belong in minimum/maximum/format/enumRef, not in prose.',
          ),
        );
      });
    }
    return out;
  },
};

const longEnumsUseEnumRef: ValidationRule = {
  id: 'policy.inline-enum-too-long',
  check(ctx: RepoContext): ValidationFailure[] {
    const out: ValidationFailure[] = [];
    for (const m of tools(ctx)) {
      const inputs = m.doc['input'];
      if (!Array.isArray(inputs)) continue;
      inputs.forEach((input, i) => {
        if (!isRecord(input)) return;
        const values = input['enum'];
        if (!Array.isArray(values) || values.length <= INLINE_ENUM_MAX_VALUES) return;
        const name = typeof input['name'] === 'string' ? input['name'] : `input[${i}]`;
        out.push(
          fail(
            this.id,
            m.file.file,
            `/input/${i}/enum`,
            `inline enum on "${name}" has ${values.length} values; lists longer than ${INLINE_ENUM_MAX_VALUES} must use enumRef (02 §2.2, §5.3 token budget).`,
            `Move the values into enums/<list>.yaml and replace "enum" with "enumRef: <list>" on this parameter. A shared lookup list is also reusable across tools, which an inline list is not.`,
          ),
        );
      });
    }
    return out;
  },
};

/** Depth-first search for a `calls` key anywhere in a document, returning JSON pointers. */
function findCallsKeys(node: unknown, pointer: string, out: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => findCallsKeys(item, `${pointer}/${i}`, out));
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const childPointer = `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
    if (key === 'calls') out.push(childPointer);
    findCallsKeys(value, childPointer, out);
  }
}

/**
 * 02 §2.7 / CLAUDE.md §4. `calls` is the concept console's illustrative
 * consumption count. It is demo data, it is not a manifest field, and a
 * manifest carrying it would let a fixture number present itself as real
 * usage evidence in the portal. Rejected wherever it appears, in any kind.
 */
const noCallsField: ValidationRule = {
  id: 'policy.calls-field',
  check(ctx: RepoContext): ValidationFailure[] {
    const out: ValidationFailure[] = [];
    for (const m of ctx.manifests) {
      const pointers: string[] = [];
      findCallsKeys(m.doc, '', pointers);
      for (const pointer of pointers) {
        out.push(
          fail(
            this.id,
            m.file.file,
            pointer,
            'A "calls" field is present. `calls` is illustrative demo data carried by the concept-console seed, never a manifest field — real consumption is counted by the gateway from audit rows (02 §2.7).',
            'Delete the "calls" field. If you copied this manifest from a seed/ entry, drop calls, agentName and agentPlatform: seed entries are authoring input, not manifests.',
          ),
        );
      }
    }
    return out;
  },
};

export const COPY_RULES: readonly ValidationRule[] = [
  siblingsCarryDisambiguation,
  purposeWithinWordBudget,
  paramDescWithinWordBudget,
  longEnumsUseEnumRef,
  noCallsField,
];
