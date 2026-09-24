// MCPForge guard rule — 03 §4.3 ("The company is LTM. Never LTIMindtree.
// OraAIX, OraFORGE, OMF are retired names") and 03 §13.6 rule 2, plus the
// superseded palette hexes of 03 §4.3 ("Forbidden values, lint-blocked").
//
// `LTM` alone is the current brand and must never fire.

import { findRetiredBrandStrings } from '../shared.js';

/** @type {import('eslint').Rule.RuleModule} */
export const noRetiredBrandStrings = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid retired brand names (LTIMindtree, OraAIX, OraFORGE, OMF) and the superseded palette hexes.',
    },
    schema: [],
    messages: {
      retired:
        '"{{term}}" is retired (03 §4.3). The company is LTM; the product is MCPForge; the palette is the current one.',
    },
  },
  create(context) {
    function scan(node, text) {
      for (const term of findRetiredBrandStrings(String(text ?? ''))) {
        context.report({ node, messageId: 'retired', data: { term } });
      }
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string') scan(node, node.value);
      },
      TemplateElement(node) {
        scan(node, node.value.raw);
      },
      JSXText(node) {
        scan(node, node.value);
      },
      Identifier(node) {
        scan(node, node.name);
      },
    };
  },
};

export default noRetiredBrandStrings;
