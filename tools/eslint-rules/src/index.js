// MCPForge — the guard lint rules (W0-A3).
// Four rules that make the central security and design claims machine-checked:
//   no-service-account-fallback   CLAUDE.md #1, 02 §4.4 rule 2
//   no-secret-value-escape        CLAUDE.md #8, 02 §11.5 rule 2
//   no-raw-color                  03 §13.6 rule 1
//   no-retired-brand-strings      03 §4.3, §13.6 rule 2

import { noServiceAccountFallback } from './rules/no-service-account-fallback.js';
import { noSecretValueEscape } from './rules/no-secret-value-escape.js';
import { noRawColor } from './rules/no-raw-color.js';
import { noRetiredBrandStrings } from './rules/no-retired-brand-strings.js';

export const rules = {
  'no-service-account-fallback': noServiceAccountFallback,
  'no-secret-value-escape': noSecretValueEscape,
  'no-raw-color': noRawColor,
  'no-retired-brand-strings': noRetiredBrandStrings,
};

/** ESLint flat-config plugin object. */
export const plugin = {
  meta: { name: '@mcpforge/eslint-rules', version: '0.0.0' },
  rules,
};

export default plugin;
