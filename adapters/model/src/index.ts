// MCPForge — W0-Q9: model-assisted authoring. See docs/build-plan/w0-q8-assisted-authoring.md.
export * from './types.js';
export * from './config.js';
export { NEVER_SENT, buildSuggestRequest, renderPrompt } from './payload.js';
export type { DraftContext, RequestBusiness, SiblingTool } from './payload.js';
export { checkSuggestion } from './gate.js';
export { applySuggestion } from './apply.js';
export type { ApplyResult } from './apply.js';
export { createModel, extractBlueVerseText, withSuggest } from './providers.js';
export type { ProviderDeps } from './providers.js';
export { authoringEnabled, previewPayload, suggestField } from './suggest.js';
export type { SuggestInput, Suggestion } from './suggest.js';
export { provenancePath, recordAcceptance } from './provenance.js';
export type { AcceptedField } from './provenance.js';
export {
  intentsPrompt,
  parseCandidates,
  promoteIntent,
  suggestIntents,
  suggestedIntentsYaml,
} from './intents.js';
export type { IntentCandidate, IntentsInput, PromoteResult } from './intents.js';
export { fakeModel } from './fake.js';
