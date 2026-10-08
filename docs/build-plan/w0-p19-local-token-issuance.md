# W0-P19 — How a human gets a token for an external agent (local provider): design note

**Status: DRAFT for owner review. No code until this is approved.** OPTIONAL by owner decision (30 Sep 2026): nothing in the OCI deployment may depend on this or on `W0-Q12`.
Drafted 8 Oct 2026 on a Sonnet session although the task is routed to Opus (it touches identity). Every "recommendation" is a proposal; §6 lists the owner decisions.

Reads: 02 §4.4 · 05 §1.3 · CLAUDE.md §2 #6 and #8, §3.1.

## 0. What exists, found in the code

| Piece | Where | Fact |
|---|---|---|
| Token endpoint | `core/gateway/transport/sign-in-routes.ts` | `POST /auth/local/token {username,password,totpCode?}` → grant; `/refresh`, `/signout`. Built by W0-P5a. Human-only. `no-store` headers, JSON bodies only, errors never echo a password or token |
| Grant | `identity/local/sign-in.ts` | 15-minute access JWT (`DEFAULT_TOKEN_TTL_SECONDS = 900`), a rotating `mfr_` refresh token, session limits 8 h idle / 12 h absolute |
| Consumer credential | `transport/consumer-auth/presentation.ts` | `mcpforge-consumer-assertion` header: an Ed25519 `private-key-jwt` signed by the consumer's shim, `exp` ≤ 60 s, single-use `jti` |
| Human credential on `/mcp` | `identity/bearer.ts` | `Authorization: Bearer <user token>` |
| CLI | `core/cli/src/commands/identity.ts` | only `forge identity remap` (and bootstrap). Nothing prints a token |

So the **gap is narrow**: the endpoint exists, a browser (the portal) uses it, and an external MCP client has no way to get a human's token without hand-written `curl`. The question is only the *last metre*.

## 1. The three options

### A. `forge identity token` — a CLI over the existing endpoint (recommended)
Prompts for username, password and TOTP on the **TTY** (never argv, never an env var), calls `/auth/local/token`, prints the **access token once** to stdout, and nothing else.
- **No new gateway surface.** The endpoint, its rate limits, its audit and its error taxonomy are the ones the portal already depends on. A new code path in an identity module is a new thing to attack; this adds none.
- Refused when `CI=true` and when the environment class is `staging` or `prod`, the same rule and the same reason as `forge consumer issue-credential` (05 §1.3.3): in those classes the human signs in through the portal or the OIDC IdP.
- Works on a clean clone with one process running. No Docker, no cloud, no browser.

### B. Local OAuth authorize and token endpoints on the gateway
Gives an MCP client the standard spec-flow (discovery metadata, authorization code + PKCE) against the local provider.
- It is the "correct" shape for a client that can drive a browser, and it is what Wave 1 gets for free from the OIDC provider.
- It is also a **new authorization server inside the gateway**: a consent screen, client identifiers, redirect-URI validation, PKCE state, and `registration_endpoint` questions. 05 §1.3.3 makes Dynamic Client Registration structurally absent; an authorize endpoint invites the very clients that attempt it. Large blast radius for an optional feature, on the most security-sensitive module in the repo.
- Rejected for Wave 0. It stays the Wave 1 answer, and the Wave 1 answer is not code in this repo: it is the OIDC provider.

### C. Require the Keycloak docker profile for external agents at Wave 0
No new code. The OIDC provider is already contract-tested against Keycloak, so a human signs in there and the agent gets a spec-compliant token.
- Honest and cheap, and it is the right *demo* path if you ever want it today.
- But it makes Docker plus a second identity system a prerequisite for the external-agent demo on a deployment you have said is a single OCI Oracle Linux VM with local identity. Local-first (CLAUDE.md §3.1) says no prerequisite is added for an optional feature.

**Recommendation: A**, with C documented as the alternative for anyone who already runs Keycloak. B is not built.

## 2. Design of A

```
$ forge identity token --env local
Username: priya.s@ltm.example
Password: ********
TOTP code (if enrolled): 123456

Bearer token (valid 15 minutes, shown once):
eyJhbGciOi...

Send it as  Authorization: Bearer <token>
It does NOT authorize anything on its own: the client must also present its registered consumer assertion (05 §1.3).
```

| Question | Answer |
|---|---|
| Token TTL | The existing access-token TTL, **15 minutes**. No longer-lived token type is minted for this path |
| Refresh token | **Not printed.** The CLI discards it server-side by calling `/auth/local/signout` after printing, so the session ends with the 15-minute JWT. An agent that needs longer re-runs the command. A long-lived human credential in an agent's config is exactly the thing this design avoids |
| `--json` | Allowed; same single object, same once-only rule |
| Output stream | stdout only for the token; prompts and hints go to stderr so `forge identity token \| clip` works |
| Refused when | `CI=true`; environment class `staging` or `prod`; stdin is not a TTY (no scripted password feeding); the user has no TOTP enrolled **and** the deployment requires it |
| What is logged | The token, password, TOTP code and refresh token are never written to any file, log line, audit row or error. The sign-in itself is already one `/auth/local/token` event; the CLI adds `amr` from the grant. If W0-P5a did not audit sign-in rows, adding one is the only gateway change this task would need, and it is a row with `subject`, `amr`, `clientKind: cli`, never the token (to be confirmed at build; I did not verify this in the audit module) |
| `Principal.subject` | The only identity value anywhere downstream, unchanged |

## 3. How it composes with the consumer's private-key JWT (non-negotiable #6)

Two credentials ride the same request and neither substitutes for the other:

| Header | Is | Obtained by |
|---|---|---|
| `Authorization: Bearer <token>` | the **human** | `forge identity token` (this task) |
| `mcpforge-consumer-assertion: <jwt>` | the **software** | the consumer's shim, signing with the private key minted by `forge consumer issue-credential` (W0-P24) |

- A token with no registered consumer is `CONSUMER_UNREGISTERED`, with no `tools/list`. A registered consumer with no token is `IDENTITY_UNRESOLVED`. This task does not touch that logic and a test in the existing suite (`escalation.*`) already pins it.
- **The new risk this creates, stated plainly:** once a human pastes their bearer into an agent, that agent acts as them for up to 15 minutes. The bounds are the intersection model itself (the consumer's own authorizations still cap what the call may do), `humanInTheLoop` on the consumer (write plans go to a portal approver when it is false), the 15-minute TTL, and the audit row that carries both `consumer_id` and the human `subject`. This is not new power: a human could always run a client themselves. It is worth the owner knowing it.

## 4. Tests the build task would add

1. `forge identity token` against a real launched local gateway: password-only user, TOTP user, wrong password (no token, error with `next`), lockout still applies.
2. Refused with `CI=true`, with a non-TTY stdin, and with `env: staging|prod`, each with a `next` naming the portal sign-in.
3. Output contains the token once; a captured stderr/stdout/log scan finds the password and TOTP code **nowhere**.
4. The session is signed out after issuance (the refresh token printed nowhere, and unusable).
5. Escalation: token without consumer assertion → `CONSUMER_UNREGISTERED`; assertion without token → `IDENTITY_UNRESOLVED`; both → the call proceeds.
6. `no-secret-value-escape` lint is clean (the CLI never calls `SecretStore.get()`).

## 5. What this note deliberately does not cover

- Wave 1 OIDC: the IdP is the token endpoint and none of A applies.
- `W0-Q12`'s walkthrough itself (human).
- Any change to the consumer registry.
- Browser-based flows for external agents (option B).

## 6. Decisions I need from you

| # | Decision | Recommendation |
|---|---|---|
| D1 | A, B or C | **A**; C documented as an alternative |
| D2 | May `forge identity token` run outside `local`, e.g. a `dev`-class environment? | Local only for Wave 0, same as `issue-credential` |
| D3 | Should the refresh token be withheld (15-minute bearer only)? | Yes, withhold. Longer sessions re-run the command |
| D4 | Do you want the task kept at all, given your 30 Sep decision that external agents are optional? | Keep it parked as `OPTIONAL`; it is a half-day build once D1 is made, and `W0-Q12` cannot run on the local provider without it |
