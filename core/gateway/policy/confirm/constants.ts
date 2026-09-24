// MCPForge — the confirm-token TTL, factored out of `./token.ts` so this ONE
// plain numeric constant has ONE fs/crypto-free module. `./token.ts` imports
// `node:crypto` (`createHmac`, `randomBytes`, `randomUUID`,
// `timingSafeEqual`) for the token machinery itself — necessarily
// server-only — but `../../secrets/rotation.ts` needs only this TTL number
// to describe the confirm-HMAC key's rotation window, and `secrets/rotation.ts`
// is reached from the portal's `/environments` client route via
// `@mcpforge/gateway/secrets`. Importing this constant from `./token.ts`
// directly would drag `node:crypto` into that client bundle; importing it
// from here does not. `./token.ts` re-exports it, so there is still exactly
// one definition.
export const DEFAULT_CONFIRM_TTL_SECONDS = 300;
