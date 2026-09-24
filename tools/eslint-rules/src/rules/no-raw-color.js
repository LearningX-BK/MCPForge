// MCPForge guard rule — CLAUDE.md ("No raw colour anywhere outside
// tokens.primitives.css") and 03 §13.6 rule 1.
//
// No hex, rgb()/rgba() or hsl()/hsla() literal in any .tsx (or other source)
// outside `tokens.primitives.css`. CSS files are linted through the same rule
// once the portal's CSS language plugin lands in Phase 4; the detector is the
// shared RAW_COLOR_RE so both paths agree.

import { RAW_COLOR_RE, isPrimitivesTokenFile } from '../shared.js';

/** @type {import('eslint').Rule.RuleModule} */
export const noRawColor = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid raw colour literals (hex, rgb(), hsl()) outside tokens.primitives.css — use a semantic token.',
    },
    schema: [],
    messages: {
      rawColor:
        'Raw colour literal "{{value}}". Colour is defined only in tokens.primitives.css and consumed through a semantic token (03 §13.6).',
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (isPrimitivesTokenFile(filename)) return {};

    function scan(node, text) {
      const m = RAW_COLOR_RE.exec(text);
      if (m) context.report({ node, messageId: 'rawColor', data: { value: m[0] } });
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') scan(node, node.value);
      },
      TemplateElement(node) {
        scan(node, node.value.raw ?? '');
      },
      JSXText(node) {
        scan(node, node.value ?? '');
      },
    };
  },
};

export default noRawColor;
