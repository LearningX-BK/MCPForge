// MCPForge — `LocalUserStore`'s public surface. W0-D2, 02 §4.4.
//
// **What does not cross this boundary.** No password hash, no TOTP secret, and
// no function that returns either. `hashPassword` and `verifyPassword` are
// exported because the identity contract suite (W0-D3) verifies the KDF
// parameters directly, and neither can produce a secret it was not given.
// `LocalUserCredential` — the one type that carries credential columns — is NOT
// re-exported here: it is reachable only from the store package, by the one
// module that needs it.
//
// `generateTotpSecret` IS exported and does return a secret, because enrolment
// has to hand one to the person once. It is the single such function, it mints
// rather than reads, and it cannot recover the secret of an existing account.

export {
  DEFAULT_LOCKOUT_SECONDS,
  DEFAULT_LOCKOUT_THRESHOLD,
  LOCAL_SUBJECT_PREFIX,
  localSubject,
  localUserStore,
  type CreateLocalUserRequest,
  type LocalAuthentication,
  type LocalSignIn,
  type LocalUserStore,
  type LocalUserStoreOptions,
} from './store.js';
export {
  ARGON2_HASH_LENGTH,
  ARGON2_ITERATIONS,
  ARGON2_MEMORY_KIB,
  ARGON2_PARALLELISM,
  ARGON2_SALT_BYTES,
  MIN_PASSWORD_LENGTH,
  PASSWORD_ALGORITHM,
  hashPassword,
  verifyPassword,
} from './password.js';
export {
  AMR_OTP,
  AMR_PASSWORD,
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  TOTP_SECRET_BYTES,
  TOTP_WINDOW_STEPS,
  generateTotpSecret,
  verifyTotp,
  type TotpEnrolment,
  type TotpVerification,
} from './totp.js';
