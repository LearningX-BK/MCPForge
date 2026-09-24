// MCPForge guard rule — CLAUDE.md non-negotiable #1, 02 §4.4 rule 2, 02 §11.5.1.
//
// "There is no service-account fallback anywhere in this codebase." A missing
// target-identity mapping is a hard failure (IDENTITY_UNRESOLVED) — never a
// default responsibility, a shared token, or a "temporary" env var.
//
// HEURISTIC (a judgment call, documented here on purpose — the architecture
// states the prohibition, not its detection). The rule fires on:
//   1. any binding/property/string naming a service account in a
//      credential-bearing sense (`serviceAccountToken`, `SERVICE_ACCOUNT_USER`),
//   2. shared/default/fallback credential names
//      (`fallbackCredential`, `sharedToken`, `defaultIdentity`, …),
//   3. `process.env.*` reads whose variable name matches either of the above,
//   4. a `||` / `??` / ternary default applied to an identity-resolution call
//      (`resolveTargetIdentity(x) ?? something`) — substitution, which
//      02 §11.5.1 is explicit is the forbidden act.
// It deliberately does NOT fire on documentary names, whose tail is a
// docs/url/label word: `serviceAccountDocsUrl` is the named legitimate
// near-miss. Storage of a scoped credential is legitimate under the four-part
// test of 02 §11.5.1; substitution never is — hence the narrow name shapes.

const SERVICE_ACCOUNT_RE = /service[_\s-]?account/i;
// Tail words that make a service-account name documentary rather than operative.
const DOCUMENTARY_TAIL_RE =
  /(docs?|documentation|url|uri|link|href|label|message|text|comment|note|desc|description|help|reason|policy|rule)$/i;
const SHARED_CREDENTIAL_RE =
  /\b(fallback|shared|default|generic|system|temp|temporary)[_\s-]?(credential|creds?|identity|principal|user|username|token|secret|password|passwd|pwd|login|account|apikey|api[_\s-]?key)\b/i;
const IDENTITY_RESOLVE_RE =
  /(resolve|lookup|map|get)[A-Za-z]*(identity|principal|subject)|(identity|principal)[A-Za-z]*(resolve|lookup)/i;

function isDocumentary(name) {
  const tail = name.replace(SERVICE_ACCOUNT_RE, '');
  return DOCUMENTARY_TAIL_RE.test(tail);
}

// Exact OS API names that collide with the "generic credential" shape above but
// are command VERBS, not credential identifiers. macOS `security(1)`'s
// subcommands are literally spelled `…-generic-password`, which SHARED_CREDENTIAL_RE
// reads as "generic password" (W0-N5, core/gateway/secrets/keychain.ts).
//
// This is an EXACT-STRING allowlist and cannot be widened by naming: every
// entry contains hyphens, so no JavaScript identifier, property or env-var name
// can ever match one. It exempts three fixed argv tokens and nothing else — the
// heuristic keeps its full force on every name a human could actually choose.
const OS_KEYCHAIN_SUBCOMMANDS = new Set([
  'add-generic-password',
  'find-generic-password',
  'delete-generic-password',
]);

function offends(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (OS_KEYCHAIN_SUBCOMMANDS.has(name)) return false;
  if (SERVICE_ACCOUNT_RE.test(name)) return !isDocumentary(name);
  return SHARED_CREDENTIAL_RE.test(name.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()));
}

function calleeName(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') return calleeName(node.property);
  return '';
}

/** @type {import('eslint').Rule.RuleModule} */
export const noServiceAccountFallback = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid service-account, shared or fallback credential paths. A missing target-identity mapping must be a hard failure (IDENTITY_UNRESOLVED).',
    },
    schema: [],
    messages: {
      fallback:
        '"{{name}}" looks like a service-account or shared/fallback credential path. There is no service-account fallback in MCPForge (CLAUDE.md #1, 02 §4.4 rule 2) — a missing target-identity mapping must fail with IDENTITY_UNRESOLVED.',
      substitution:
        'An identity resolution ("{{name}}") is being defaulted with {{op}}. Substituting for an unresolved identity is exactly the service-account fallback 02 §11.5.1 forbids — fail with IDENTITY_UNRESOLVED instead.',
    },
  },
  create(context) {
    function check(node, name) {
      if (offends(name)) context.report({ node, messageId: 'fallback', data: { name } });
    }
    return {
      Identifier(node) {
        // Skip the property half of `a.b` when it is not computed and the
        // object was already checked — reporting once is enough.
        check(node, node.name);
      },
      Literal(node) {
        // Only bare token-shaped strings are candidates — a config key or an
        // env-var name. Prose, URLs and paths are documentary, not operative,
        // and a rule that fires on them teaches people to disable it.
        if (typeof node.value !== 'string') return;
        if (!/^[A-Za-z0-9_.$-]+$/.test(node.value)) return;
        check(node, node.value);
      },
      LogicalExpression(node) {
        if (node.operator !== '??' && node.operator !== '||') return;
        const left = node.left;
        const name = left.type === 'CallExpression' ? calleeName(left.callee) : '';
        if (name && IDENTITY_RESOLVE_RE.test(name)) {
          context.report({ node, messageId: 'substitution', data: { name, op: node.operator } });
        }
      },
      ConditionalExpression(node) {
        const t = node.test;
        const name = t.type === 'CallExpression' ? calleeName(t.callee) : '';
        if (name && IDENTITY_RESOLVE_RE.test(name)) {
          context.report({ node, messageId: 'substitution', data: { name, op: '?:' } });
        }
      },
    };
  },
};

export default noServiceAccountFallback;
