// MCPForge guard rule — 02 §11.5 rule 2, CLAUDE.md non-negotiable #8.
//
// "No secret value is returned above the adapter layer. SecretStore.get() is
// callable only from adapters/** and core/gateway/identity/**."
//
// Detection is by receiver name: any `…SecretStore.get(…)` / `secretStore.get(…)`
// call — including `this.secretStore.get()` and `deps.secrets.secretStore.get()`.
// Only `.get()` is restricted; `metadata()`, `rotate()` and `list()` return
// references, never values, and are safe everywhere.
//
// W0-N5 adds the SECOND gate. `SecretStore.get()` now returns an opaque
// `SecretValue` whose only way out is `.revealSecretValue()` — so a `get()`
// that escapes the adapter layer no longer leaks on its own, and the call that
// actually matters is the reveal. That one is matched by METHOD NAME alone, on
// any receiver: the name is unique in the repository and deliberately
// unmistakable, so there is no receiver-naming loophole of the kind `.get()`
// detection inevitably has.

import { isSecretValueAllowedPath } from '../shared.js';

const RECEIVER_RE = /(^|[._])secret_?store$/i;

function receiverName(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed) return receiverName(node.property);
  if (node.type === 'ThisExpression') return 'this';
  return '';
}

/** @type {import('eslint').Rule.RuleModule} */
export const noSecretValueEscape = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'SecretStore.get() may only be called inside adapters/** and core/gateway/identity/** — a secret value must never escape the adapter layer.',
    },
    schema: [],
    messages: {
      escape:
        'SecretStore.get() returns a secret value and may only be called inside adapters/** or core/gateway/identity/** (02 §11.5 rule 2). Pass the secretRef:// instead.',
      reveal:
        'SecretValue.revealSecretValue() returns the raw credential and may only be called inside adapters/** or core/gateway/identity/** (02 §11.5 rule 2). Pass the SecretValue itself — it redacts under logging, JSON and inspect — or pass the secretRef://.',
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (isSecretValueAllowedPath(filename)) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed) return;
        if (callee.property.type !== 'Identifier') return;
        // Gate 2 — the raw value. Method name alone, any receiver.
        if (callee.property.name === 'revealSecretValue') {
          context.report({ node, messageId: 'reveal' });
          return;
        }
        // Gate 1 — the store handle. Receiver-name detection.
        if (callee.property.name !== 'get') return;
        if (!RECEIVER_RE.test(receiverName(callee.object))) return;
        context.report({ node, messageId: 'escape' });
      },
    };
  },
};

export default noSecretValueEscape;
