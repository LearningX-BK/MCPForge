# MCPForge — handoff, 30 Sep 2026

For whoever picks this up next: the owner, another Claude session, or GitHub Copilot.
Read this first, then `CLAUDE.md` (the rules), then `TASKS.md` (the work).

`main` at the time of writing: **`11e0b29`** (W0-P33b merged).

---

## 1. Deploying to an OCI Oracle Linux VM (demo, against the mock JDE)

The full checklist is **`DEPLOY.md`**. The short version, using the handoff archive:

```sh
# On your workstation: copy the archive and the portal's key to the VM. The key never goes in the archive.
scp MCPForge-handoff-2026-09-30.tar.gz opc@<vm>:~
scp .mcpforge/portal/portal-local.private.jwk.json opc@<vm>:~   # from C:\GenAIGenerated\LTM\MCP\MCPForge

# On the VM (Oracle Linux 8/9)
tar -xzf MCPForge-handoff-2026-09-30.tar.gz
git clone mcpforge-main.bundle MCPForge          # a full git repo, branch main
cd MCPForge
mkdir -p .mcpforge/portal && mv ~/portal-local.private.jwk.json .mcpforge/portal/ && chmod 600 .mcpforge/portal/*
# Install Docker CE (not Podman): DEPLOY.md step 1
docker compose build
sudo git clone --no-hardlinks "$PWD" /opt/mcpforge/defs     # the definitions clone (DEPLOY.md step 2)
sudo git -C /opt/mcpforge/defs remote remove origin
sudo git -C /opt/mcpforge/defs config user.name "MCPForge Portal"
sudo git -C /opt/mcpforge/defs config user.email "portal@mcpforge.local"
export MCPFORGE_SECRETS_KEY='<long random passphrase — keep it safe>'
docker compose -f docker-compose.yml -f docker-compose.vm.yml up -d
# First super admin (type the password at the prompt):
docker compose -f docker-compose.yml -f docker-compose.vm.yml exec -it mcpforge-core \
  node core/cli/bin/forge.js identity bootstrap-admin \
  --username <you> --display-name "<Your Name>" --group mcpforge-superadmins
```

Then put TLS in front (nginx or Caddy, or an OCI Load Balancer) and proxy to `127.0.0.1:3000` (portal) and `127.0.0.1:3939` (gateway). Open only 443.

**Why the key is copied by hand.** The portal authenticates to the gateway as the registered consumer `portal-local`. Its public key is in git (`consumers/portal-local.consumer.yaml`); its private key is only on the dev machine. Copying that one file makes the VM match git. The proper per-deployment path is a key rotation through `forge consumer rotate` / `issue-credential` plus a reviewed change. Do that before anything beyond a demo.

### Verified vs not yet verified on a VM
- **Verified (W0-K4, local Docker):** the image builds; the gateway and portal start; sign-in works; live `/api/v1` reads work.
- **Built and tested, NOT yet run in a container:**
  - The `git` install added to the Dockerfile (W0-P33b).
  - The definitions clone mount (`docker-compose.vm.yml`, W0-P33a).
  - Portal Approve/Merge against the clone (W0-P33b).
  - Super admin (W0-P31/P32) and user admin (W0-P28).

  All of it passes unit, contract and policy tests on Windows. Expect small first-run fixes, most likely a file ownership or `safe.directory` complaint from git inside the container. The fix for that is `git config --global --add safe.directory /defs` in the container, or `chown` the clone to the container user.
- **Not possible yet:**
  - A real JD Edwards target.
  - Serving a merged tool without a restart (W0-P33c). After a portal Merge, run `docker compose ... restart`.
  - A portal-triggered probe (W0-P33d). Run `forge probe --env local` in the container.

---

## 2. What was done in this stretch (30 Sep 2026)

| Task | What |
|---|---|
| W0-P25 | Humans decide runtime approvals in the portal (`POST /api/v1/approvals/{id}/decision`) |
| W0-P3c/d/e/f | Portal pages on live `/api/v1` data; fixtures retired |
| W0-P21, P12, P20, K4 | Probe wiring, stored-credential fail-closed, CLI tests, Docker stack + `DEPLOY.md` |
| W0-P28 | Local user admin in the portal (Governance → Users), `forge identity bootstrap-admin` |
| W0-P26 | `forge secrets put` (value from a file or stdin, never argv) |
| W0-P29, P30 | Reset/disable ends sessions; overlay-purity accepts consumer public keys |
| W0-P31, P32 | Super admin role over every tool; super-admin self-approval, always flagged |
| W0-P33 (design) | Adding tools from the portal: `docs/build-plan/w0-p33-portal-merge.md` (owner-approved) |
| W0-P33a | `MCPFORGE_DEFINITIONS_ROOT`: definitions in a git clone, runtime in `.mcpforge/` |
| W0-P33b | Portal Approve + Merge, gated by the real `forge codegen` + `forge validate` |

Owner decisions are recorded verbatim in each task block in `TASKS.md`.

---

## 3. What to do next, in order

1. **W0-P33c — gateway catalogue reload** (security spine; `core/gateway/**`). A super-admin-only, audited reload behind the `/api/v1` front door. It re-runs `loadRuntimeCatalogue` on the definitions root and swaps atomically **only on a clean load**; otherwise it keeps the old catalogue and returns why. Sends `tools/list_changed`. A plan minted before a change to its tool must not confirm after it. The `done:` criterion is in `TASKS.md`.
2. **W0-P33d — probe from the portal, local/dev only.** First split `forge probe` so it reads definitions from the definitions root while the report and vault stay under the install root (`core/cli/src/commands/probe.ts` uses one `root` today).
3. **W0-P18** — strip Path B from codegen.
4. **W0-P22** — `forge validate` rule `approval-not-self-approved`; the only exception is a super admin with `selfApproved: true`.
5. **Owner, not code:** fix `overlays/local/mappings/groups-to-roles.yaml`. The ordinary groups map to role ids that don't exist (`p2p-ap-clerk`, …), so only the super admin holds a real role today. This unblocks the W0-P3 walkthrough.
6. **Optional (owner decision):** W0-P19 and W0-Q12, external agents such as Claude Desktop. Nothing in the deployment depends on them.

---

## 4. Working rules, for GitHub Copilot or any other assistant

- **Read `CLAUDE.md` first.** Its eight non-negotiables are enforced by lint, tests and `forge validate`, and they are the product's security claim. In short:
  - No service-account fallback.
  - Consumer ∩ human identity on every call.
  - Writes go plan → confirm → execute, with audit.
  - Every error carries a `next`.
  - Secrets appear only as `secretRef://`.
- **One task per branch:** `forge/<taskId>-<slug>`. Commit message names the task and its exit criterion. Tick the task in `TASKS.md` with a `result:` line. Merge `--no-ff` to `main` only when green.
- **Don't re-decide what the docs decided** (`docs/build-plan/01..04`). If something looks wrong, write it down and stop.
- **Paths that are security-critical** (`CLAUDE.md` §6: policy, identity, audit, consumer, secrets, binding executors, write-path components) deserve extra review.

### Commands
```sh
pnpm install
pnpm test                       # everything (slow; see flaky notes below)
pnpm test:policy                # privilege-escalation suite — must stay all green
npx vitest run <path>           # one area
node core/cli/bin/forge.js validate   # or: forge validate
node core/cli/bin/forge.js codegen && git diff --exit-code generated/
pnpm test:postgres              # needs Docker
```

### Known gotchas
- **Timeouts under load.** The spawned-CLI tests (`core/cli/src/cli.test.ts`, `kill`, `identity`, `slice-diff`, `package`, `tests/consumer-access/d.*`) can hit the 5 s timeout when the whole suite runs. They pass alone, and they fail the same way on `main`. Run them alone before blaming a change.
- **Evidence files.** A full `pnpm test` rewrites the tracked `tests/consumer-access/.evidence/*.json`. Revert them before committing: `git checkout -- tests/consumer-access/.evidence/`.
- **Formatting.** Some files are CRLF or not prettier-clean at HEAD (for example `core/gateway/errors/enumeration.test.ts` and `core/portal/src/lib/change-host/local-git-actions.ts`). Run prettier only on files that were clean at HEAD, or the diff becomes the whole file.
- **Existing failures on `main`:**
  - A portal type error in `src/app/catalog/load-catalog.test.ts`.
  - A lint error in `core/cli/src/commands/consumer.test.ts:481`.
  - The Postgres contract suite has no auth-session coverage.
- **Every `next:` counts.** Every new computed `next:` site must be classified in `core/gateway/errors/enumeration.test.ts`.
