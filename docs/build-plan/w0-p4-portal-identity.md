# W0-P4 — Portal viewer identity and persona-bound action gating

**Status: DECIDED 26 Sep 2026 — all six decisions taken by the owner; see §9.** Decision 1 was revised to multi-mode sign-in (§2.1, §2.2), decision 3 to allow admin self-approval of definitional changes, and decision 6 to seamless sessions. This note is the whole of `W0-P4`; no code was written.
Author: build lane (Opus), 25 Sep 2026. Reads: 03 §2, 05 §1.3, 02 §4.4, and `w0-p2-portal-gateway-seam.md` §7.

---

## 0. The one-paragraph version

The portal has no idea who is looking at it. There is no login, no session and no principal anywhere in `core/portal`. That has two consequences, and the second is the one that matters today. **First,** `W0-P3` cannot be built: the approved seam (W0-P2 §7) requires every `/api/v1/**` read to carry a resolved human, exactly like `/mcp`, and the only way to feed the 13 pages without one would be a portal service identity, which non-negotiable 1 forbids. **Second,** the portal already performs identity-bearing acts with *invented* identities. Every Save draft and Propose records its author as the literal string `'portal'` (`components/shell/app-chrome.tsx:33`). The approval screen's Approve button writes a hard-coded approver, `meera.rao@example.com`, into client state (`app/approvals/[approvalId]/page.tsx:96`). **My recommendation:** the portal signs its viewer in *through the gateway*, never in-process. The portal server holds the resulting short-lived token in an httpOnly cookie. Every portal act takes its author from that session and never from the component. Four actions are gated server-side, never hidden. Proposer ≠ approver is enforced in three places, not one.

---

## 1. What exists today, verified in source

| Claim | Evidence |
|---|---|
| No viewer identity | no middleware, no session, no principal in `core/portal`; `topbar.tsx:24` *"persona is prop-driven placeholder text — no auth/session backend yet"* |
| Author is a constant | `app-chrome.tsx:33` `const PORTAL_AUTHOR = 'portal'`, passed to every `host.propose(...)` |
| Author is caller-supplied | `lib/change-host/types.ts` `SaveDraftInput.author` / `ProposeInput.author` are plain inputs to server actions; the server trusts them |
| Approve is fiction | `app/approvals/[approvalId]/page.tsx:96` sets `decidedBy: { subject: 'meera.rao@example.com' }` in React state; nothing reaches the gateway |
| Kill is unwired | `kill-switch-panel.tsx` exposes `onKill`; no page connects it to anything |
| `issue-credential` is CLI-only | `consumer-actions.tsx:179` tells the user to run `forge consumer issue-credential`; the portal never mints a credential |
| Runtime SoD exists | `core/gateway/policy/approval/gate.ts:18` refuses `approver == requester` with `POLICY_GUARDRAIL_BREACH` |
| Definitional SoD does not | no `forge validate` rule compares an approval record's `approver` with its `requestedBy`; a hand-edited record can approve itself |
| The identity seam is ready | `IdentityProvider` (local + OIDC, one contract suite), `LocalUserStore` (Argon2id, TOTP), `localTokenIssuer`, and since W0-P11 a launched gateway holding all of them |
| Nothing issues a human token | no authorize or token endpoint and no CLI (`W0-P19`, open) |

---

## 2. (a) Which `IdentityProvider`, and how the portal reaches it

**Recommendation: the portal resolves its viewer through the gateway's own `IdentityProvider`, over HTTP. It never reads the user store and never verifies a password itself.**

- **Wave 0 (local).** The gateway gains one sign-in endpoint for the local provider, `POST /auth/local/token`. It takes username + password (+ TOTP when enrolled), verifies them with `LocalUserStore`, and returns `localTokenIssuer`'s short-lived JWT (the existing 15-minute TTL). This is the "Admin UI in the portal (Phase 3)" half of 02 §4.4: the gateway issues and the portal asks. It is **not** a REST facade in the W0-P2 §7 sense: it serves no tool discovery, invocation or governance data. It is the local provider's token endpoint, which 02 §4.4 already assumes exists ("the gateway itself issues short-lived signed JWTs").
- **Wave 1 (OIDC).** The portal uses authorization code + PKCE against LTM AD, as 02 §4.4 states. The endpoint above is simply absent under `identity.provider: oidc`. Nothing else in the portal changes, because the portal only ever holds a bearer token.
- **Where the token lives.** In the portal **server**, in an httpOnly, `SameSite=Strict`, `Secure`-when-not-localhost cookie session. It is never readable by browser script and never rendered. The portal server attaches it as `Authorization: Bearer` to every `/api/v1/**` read and every `/mcp` session it opens, next to `portal-local`'s consumer credential. Both are required on every request (non-negotiable 6). On expiry the viewer is asked to sign in again. I am not proposing refresh tokens at Wave 0; a 15-minute re-prompt is the cost, and it is stated.
- **R8 consequence.** None new. The portal imports nothing from `@mcpforge/gateway` to do this; `portal-http-boundary.ts`'s allowlist does not grow.
- **Overlap with `W0-P19`.** The same endpoint is the natural answer to "how does a human get a token for an external agent" (option 2 of P19). I recommend deciding them together but keeping P19's note separate, because P19 also has to settle printing a token once, the CLI and `CI=true` refusal.

### 2.1 Owner revision, 25 Sep 2026 — sign-in is multi-mode

The owner's words: *"1 can be multiple mode, like Agentis, the one you are building, or can be Azure, Intra, OCI IAM, Local etc."* So the portal does not sign in against "local now, AD later". It signs in against **whichever identity provider a deployment configures**, and the design must not privilege any of them. How each named mode maps onto the existing seam:

| Mode | Protocol | What it is in code |
|---|---|---|
| **Local** | the gateway is the authority: `POST /auth/local/token` | the existing `local` provider (`LocalUserStore` + `localTokenIssuer`) |
| **Azure / Entra ID** | OIDC, authorization code + PKCE | a **configuration** of the existing `oidc` provider (issuer, client id, groups claim); no new code |
| **OCI IAM** (Identity Domains) | OIDC, authorization code + PKCE | the same: a configuration of `oidc` |
| **"the one you are building"** (read as: MCPForge's own local issuer) | as Local | as Local |
| **Agentis** | a peer agent gateway (owner, 25 Sep 2026), with its own local store or federating to Entra/OCI; see §2.2 | a configuration of `oidc` when Agentis publishes OIDC discovery + JWKS; otherwise its own `IdentityProvider`, passing the shared contract suite first |

**What changes in the design.**

1. **The overlay block becomes a list.** `identity.providers: [{ id, kind: local | oidc, ... }]`, replacing the single `identity.provider`. Each entry is values only (issuer, client id, groups claim, discovery URL, a `secretRef://` for any client secret). The overlay-purity rule is unchanged. The portal's sign-in page lists the configured providers; one configured provider means no chooser.
2. **Subjects are issuer-qualified whenever more than one provider is configured.** Two providers can mint the same `sub` for different people. `Principal.subject`, the only identity value written to audit, role mappings and idempotency keys (02 §4.4 item 3), must be unambiguous, so it becomes `<providerId>:<sub>`. The local provider already does this (`local:<uuid>`). **This touches audit and mappings, so it must be decided before the first multi-provider deployment writes a row.** `forge identity remap` (02 §4.4 item 3) is the migration tool it already names.
3. **Group-to-role mapping keys are per provider.** An Entra group object id and an OCI IAM group name are different namespaces, so the mapping file is keyed `groups: { <providerId>: { <group>: { roles: [...] } } }`. The alternative is one mapping file per provider.
4. **Tokens.** OIDC tokens are verified against each provider's JWKS; the gateway is only a Resource Server for them. `POST /auth/local/token` exists only when a `local` provider is configured.
5. **Nothing downstream changes.** Every consumer of identity still sees one `Principal`. The consumer ∩ human intersection (non-negotiable 6) is per call, whichever provider resolved the human.

**Decided by the owner, 25 Sep 2026: several providers may be active at once in one deployment.** Items 1–3 above are therefore requirements, not options. Subjects are issuer-qualified (`<providerId>:<sub>`) from the first row written, and the sign-in page offers a chooser whenever more than one provider is configured.

### 2.2 Agentis — two relationships, kept apart

The owner: *"It's another Agent Gateway you are helping me build, it can have local store or can connect to others like entra or OCI."* A peer gateway can stand in two different relationships to MCPForge, and they must not be merged, because merging them is exactly how a service-account fallback gets in.

1. **Agentis as an identity provider.** A human signs in to MCPForge (portal or agent session) with an identity Agentis issued. This is supported as an `oidc` configuration when Agentis publishes OIDC discovery and a JWKS, and puts the **human** in `sub`. Recommendation, since both gateways are being built together: Agentis's local issuer emits the same OIDC-shaped claim set MCPForge's does (`sub`, `groups`, `iat`, `exp`, `amr`, 02 §4.4). Then no new code is needed on either side. When Agentis itself federates to Entra or OCI IAM, MCPForge should trust **that** IdP directly rather than through Agentis: one hop fewer, and the subject is the IdP's own.
2. **Agentis as a consumer.** Agentis's agents call MCPForge's `/mcp` for their users. Then Agentis is a **registered consumer** (a reviewed git record in `consumers/`, 05 §1.3.2), and every call must still carry the human: either the user's own token, or one exchanged for it (RFC 8693 token exchange, `act` claim naming Agentis). **An Agentis service token standing in for its users is never sufficient.** It is the consumer-only path non-negotiable 6 forbids, and a substitute identity non-negotiable 1 forbids. Audit then records `consumer_id = agentis-<deployment>` and `caller_subject = <the human>`, exactly as for any other consumer.

**Not decided here:** the token-exchange wire details between the two gateways. That belongs in a joint MCPForge↔Agentis note once Agentis's issuer exists.

**Personas (03 §2): a lens bound to held roles.** Personas are derived, never chosen freely. Recommendation: a `personas:` block in the **same git mapping file** that already maps groups to roles (`overlays/<d>/mappings/groups-to-roles.yaml`). It maps groups to any of `developer`, `business`, `admin`, so persona eligibility is reviewed in the same diff as the role grant it rides on. A viewer eligible for no persona still signs in, sees every page, and holds no gated action (§3).

---

## 3. (b) The gated actions, and their refusal copy

Gating is **server-side**: a server action, or the gateway, refuses. The UI mirrors that with a disabled control plus the reason, never by removing the control or the page (03 §2: *"it never hides a page"*). Every refusal carries a human-form `next` (non-negotiable 5).

| Action | Who may | Enforced at | Refusal copy (message · next) |
|---|---|---|---|
| **Save draft / Propose** | any signed-in viewer; author = the session's `Principal.subject`, **never** a component argument | portal server action (drops `author` from `SaveDraftInput`/`ProposeInput`) | "You are not signed in." · "Sign in, then propose again; your draft is kept." |
| **Discard** | the proposal's author only | portal server action | "Only the author, {author}, can discard this change." · "Ask {author} to discard it, or request changes on the proposal instead." |
| **Approve a definitional change** (role, consumer, binding grant, package, manifest) | a viewer with the `admin` persona who is **not** the proposal's `requestedBy` | portal server action + `forge validate` rule (§4) | "You proposed this change, so you cannot approve it." · "Ask another approver to review it; the proposal stays open." |
| **Approve a runtime write** (`/approvals/[id]`) | whoever the gateway's approval gate accepts; the portal only forwards the decision | gateway (`approval/gate.ts`, already refuses requester == approver) | the gateway's own `ForgeError`, rendered verbatim, `next` included |
| **Kill** (all five granularities) | `admin` persona | gateway: the kill switch is a runtime write, so it goes through `/mcp` or `forge kill`, **not** `/api/v1/**` (W0-P2 §7 authorizes no write there) | "Kill switches need the admin persona." · "Ask an MCPForge admin, or run `forge kill` if you hold the admin role locally." |
| **`issue-credential`** | nobody, in the portal | not offered; the portal shows the CLI command | (no button to refuse) · "Run `forge consumer issue-credential <id>` on the gateway host; it prints once and is refused when CI=true or in staging/prod." |

**Flag:** "Kill needs a write path from the portal" is a new write surface. I recommend it is a `/mcp` tool call only for a later task, never a new `/api/v1` verb. Until then the portal shows the `forge kill` command, exactly as it does for `issue-credential`.

---

## 4. (c) Proposer ≠ approver — yes, enforced in three places

1. **Runtime writes.** Already enforced by the gateway approval gate. Nothing to add.
2. **Portal Approve for definitional changes.** The server action compares the session subject with the review record's `requestedBy` and refuses on a match.
3. **`forge validate` rule `approval-not-self-approved`**: an approval record whose `approver` equals its `requestedBy` fails validation. This is the one that matters most: approval records are git files, and a person can write one by hand without the portal. It fails in CI and in the Build checks pane.

**Flag for the owner:** existing records use `approver: Admin`, a display label, while `requestedBy` is an email. The rule compares identities, so from `W0-P5` on, `approver` should hold a `Principal.subject`. Recommendation: grandfather records dated before the rule (they stay valid; the rule reports a warning), and require subjects afterwards.

---

## 5. (d) What "full access for admin" means, enumerated

The `admin` persona **may**: see every page (as everyone may); approve definitional changes it did not propose; fire and lift kill switches at all five granularities (via the write path above); see every consumer's usage and anomalies; and read the integrity chain.
It **may not**: approve its own proposal; approve a runtime write the gateway's grants and SoD refuse; execute a tool outside its roles (the gateway intersection still applies to the admin's own calls); see a secret value anywhere (non-negotiable 8); issue a credential from the portal; or override a probe-disabled tool from the UI (02 §4.4 rule 4: only a governance exception with an approval record).

---

## 6. (e) The persona pill's tooltip

> **Persona is a view, not a permission.** It changes where you land and what is emphasised. What you can actually do is decided by the gateway from your roles, whatever this pill says. You can switch to: {personas you hold}.

---

## 7. What this unblocks, and what it does not decide

- **`W0-P5`** implements this note. **`W0-P3`** follows `W0-P5`, not the other way round: `/api/v1/**` needs the session this note defines.
- **Not decided here:** the `/api/v1/**` endpoint list (P3); refresh tokens; the Kill write path's tool shape; TOTP enrolment UX.
- **One tension to name:** the portal server must present `portal-local`'s consumer credential, and non-negotiable 8 allows `SecretStore.get()` only in `adapters/**` and `core/gateway/identity/**`. Recommendation: `portal-local` moves from `client-secret` to `private-key-jwt`. Its private key is minted by `forge consumer issue-credential portal-local` into the git-ignored `.mcpforge/portal/`, and the portal server signs its assertion with it. No `SecretStore.get()` call happens in the portal, and the registry holds only the public key. This is a change to a consumer record, so it is a reviewed proposal.

---

## 8. Decisions the owner needs to make

1. **Sign-in is multi-mode (owner, 25 Sep 2026; §2.1).** Local through the gateway (`POST /auth/local/token`), and Entra ID, OCI IAM and other OIDC IdPs through authorization code + PKCE, chosen by an `identity.providers` list in the overlay. The token is held in a portal-server httpOnly cookie. **Decided:** several providers at once, with issuer-qualified subjects. Agentis is supported as an OIDC-shaped issuer and, separately, as a registered consumer relaying its humans (§2.2).
2. **Personas from a `personas:` block in the git groups-to-roles mapping.** *Recommended*, or name another source.
3. **Proposer ≠ approver for definitional changes**, enforced in the portal and by a new `forge validate` rule, with pre-rule records grandfathered as warnings. *Recommended.*
4. **Kill from the portal**: show the `forge kill` command now, and give it a real write path in a later task. *Recommended.*
5. **`portal-local` moves to `private-key-jwt`**, so the portal never reads a secret store. *Recommended.*
6. **Refresh tokens**: none at Wave 0, so viewers re-sign-in every 15 minutes. *Recommended*, or name a longer TTL.

---

## 9. Decision record — 25–26 Sep 2026

**Decided by:** the owner (Bikash Pattnaik), in session.

1. **Sign-in: multi-mode, several providers at once.** See §2.1 and §2.2: local, Entra ID, OCI IAM, Agentis; subjects issuer-qualified `<providerId>:<sub>`; mappings keyed per provider.
2. **Personas** from a `personas:` block in the git groups-to-roles mapping. *Accepted as recommended.*
3. **Proposer ≠ approver for definitional changes, EXCEPT an admin may approve their own.** The owner's words: *"Admin can do though as both."* How it is built, so the exception is visible rather than silent:
   - a viewer holding the `admin` persona may approve a definitional change they proposed; anyone else may not (the portal refuses, as in §3);
   - the approval record then carries `selfApproved: true`, and `forge validate`'s `approval-not-self-approved` rule reports it as a **warning** naming the admin, never as a failure; a self-approval by a non-admin, or a record without the flag, **fails**;
   - **runtime writes are unchanged**: the gateway's approval gate still refuses approver == requester for every runtime write, admin included, because that is the write path (non-negotiable 4) and the owner's words were about the portal's change approvals. *Flag:* if the owner meant runtime writes too, that is a separate, explicit change to `core/gateway/policy/approval/**`.
4. **Kill from the portal:** show the `forge kill` command now; a real write path later. *Accepted.*
5. **`portal-local` → `private-key-jwt`.** *Accepted.*
6. **Sessions: seamless, not a 15-minute re-prompt.** The owner's words: *"better to reduce and have seamless."* The access token stays short-lived (15 min), so revocation still bites quickly. The portal server renews it silently:
   - **local provider:** the gateway issues a rotating refresh token alongside the access token. It is stored hashed in the runtime store, rotated on every use, and **reuse of a spent refresh token revokes the whole session** (theft detection). Disabling the account stops renewal at the next refresh;
   - **OIDC providers:** the provider's own refresh token (`offline_access`), held only in the portal-server session;
   - **limits:** 8 hours idle, 12 hours absolute, as overlay values; after either, sign in again.
   The refresh token is a credential: it is never logged, never rendered, never sent to the browser, and never written to audit, only a hash of it.

`W0-P5` is unblocked. It implements §2–§6 with these decisions; `W0-P3` follows it.
