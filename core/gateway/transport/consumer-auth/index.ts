// MCPForge — the `[2a]` consumer-authentication boundary. W0-N2.
// 02 §4.2, 02 §11.2, 05 §1.3.4, 05 §A.
//
// What crosses this boundary: the gate, its result, and the DCR refusal. What
// does NOT, deliberately:
//
// - No credential value, and no accessor for one. `ConsumerPresentation` holds
//   the presented secret behind a private field with a single named reader,
//   and its `toJSON` redacts (CLAUDE.md non-negotiable 8).
// - No "authenticate or default" helper. There is one entry point and it
//   refuses; nothing here can be called in a way that yields a consumer
//   without a verified registration (CLAUDE.md non-negotiable 1).
// - No `Principal`, and no way to acquire one. `[2a]` runs BEFORE identity
//   resolution and stands in for it never (CLAUDE.md non-negotiable 6).

export {
  MCPFORGE_CONSUMER_ASSERTION_HEADER,
  MCPFORGE_CONSUMER_ID_HEADER,
  MCPFORGE_CONSUMER_SECRET_HEADER,
  ConsumerPresentation,
  readConsumerPresentation,
  type PresentedMethod,
} from './presentation.js';
export { inMemoryAssertionReplayStore, type AssertionReplayStore } from './replay.js';
export {
  ACCEPTED_ASSERTION_ALGORITHMS,
  CLIENT_SECRET_MAX_SENSITIVITY,
  ConsumerAuthenticator,
  MAX_ASSERTION_LIFETIME_SECONDS,
  type ConsumerAuthOptions,
  type ConsumerAuthRefusal,
  type ConsumerAuthResult,
  type ConsumerAuthSuccess,
  type UserTokenCorroboration,
} from './authenticate.js';
// W0-N10 — the audit trail's view of what `[2a]` established. Takes a
// `ConsumerAuthSuccess` and nothing else, so provenance cannot be minted
// without an authentication that succeeded.
export { consumerSessionProvenance } from './provenance.js';
export {
  DYNAMIC_CLIENT_REGISTRATION_PATHS,
  DYNAMIC_CLIENT_REGISTRATION_STATUS,
  REGISTRATION_ENDPOINT_KEY,
  assertNoRegistrationEndpoint,
  dynamicClientRegistrationRefusal,
  isDynamicClientRegistrationPath,
} from './dcr.js';
