# Deploying MCPForge on one VM (Wave 0)

What this covers: running the `mcpforge-core` image (gateway + portal, one
container) on a single Linux VM, for example an OCI Compute instance, against
the **local mock JD Edwards**. Verified locally with Docker 29.8 on 30 Sep 2026
(W0-K4). This is a **demo deployment**, not production: see "Not possible yet".

## What the image is

- One image, `mcpforge-core`, built from this repo's `Dockerfile` (`node:22-slim`).
  The gateway is the entrypoint (`node --import tsx core/gateway/launch.ts`) and,
  in `full` mode, spawns the portal (`next start`) as a sibling process.
- Gateway on **3939** (MCP at `/mcp`, the governance API at `/api/v1`, sign-in at
  `/auth/local/*`); portal on **3000**.
- All runtime state lives in ONE mounted directory, `./.mcpforge-docker`
  (SQLite runtime store, the sealed SecretStore, the gateway's signing keys).
  Definitions (manifests, roles, consumers, overlays) are in the image from git.
- `.dockerignore` keeps every local secret and runtime file out of the image.
  Never remove `.mcpforge/` from it.

## Steps

1. **Install Docker** on the VM (Docker Engine + Compose plugin). Open only the
   ports your TLS proxy needs (443); do NOT expose 3939 or 3000 publicly.
   On **Oracle Linux 8/9** the default container tool is Podman; this stack was
   verified with Docker, so install Docker CE from Docker's RHEL repository
   (`dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo`,
   then `dnf install docker-ce docker-ce-cli containerd.io docker-compose-plugin`,
   `systemctl enable --now docker`). Open 443 with `firewall-cmd` and in the
   OCI security list. If SELinux is enforcing, the bind mounts need the `:z`
   suffix in `docker-compose.yml`.

2. **Clone the repo** at the commit you want to run and build:
   ```sh
   docker compose build
   ```

   **Then make the definitions clone (W0-P33a).** Tool definitions live in a
   separate git clone that the portal will merge into, so adding a tool never
   needs an image rebuild. Clone it from the checkout you just built, with no
   remote (local only, by owner decision):
   ```sh
   sudo git clone --no-hardlinks "$PWD" /opt/mcpforge/defs
   sudo git -C /opt/mcpforge/defs remote remove origin
   sudo git -C /opt/mcpforge/defs config user.name  "MCPForge Portal"
   sudo git -C /opt/mcpforge/defs config user.email "portal@mcpforge.local"
   ```
   Start with the VM override on top of the base file (every later
   `docker compose` command takes the same two `-f` flags):
   ```sh
   docker compose -f docker-compose.yml -f docker-compose.vm.yml up -d
   ```
   The gateway, the portal and `forge validate`/`forge codegen` then read the
   definitions from `/defs`. Runtime state stays in `./.mcpforge-docker`. Back
   up `/opt/mcpforge/defs`: it is now the system of record for definitions.
   On SELinux-enforcing Oracle Linux, add `:z` to that volume line.

   **Adding a tool from the portal (W0-P33b).** In **Build**: Save draft →
   Propose → an admin **Approves** → a super admin **Merges**. Merge runs
   `forge codegen` and `forge validate` on the change first and merges into
   the clone's `main` only if both pass; otherwise it shows the rule and what
   to fix. Drafts live in a git worktree under `.mcpforge-docker/`, so the
   clone is only ever touched by a merge. Keep the clone clean and on `main`:
   the portal refuses to merge into it otherwise. **Merged is not deployed:**
   until the gateway reload lands (W0-P33c), restart to serve the new tool:
   `docker compose -f docker-compose.yml -f docker-compose.vm.yml restart`.
   A new tool then reads "Not probed" until a probe enables it.

3. **Choose the SecretStore key.** A container has no OS keychain, so the store
   is sealed with `MCPFORGE_SECRETS_KEY` (05 §4.3.1's env-var path). Use a long
   random passphrase, keep it in the VM's secret manager or an OCI Vault secret,
   and supply it at start. Compose refuses to start without it. Losing it means
   losing the sealed store (the gateway re-mints its own keys on a fresh store;
   binding credentials must be re-seeded).
   ```sh
   export MCPFORGE_SECRETS_KEY='<long random passphrase>'
   ```

4. **Give the portal its consumer key.** The portal presents the registered
   consumer `portal-local` (`consumers/portal-local.consumer.yaml`) with a
   private key whose public half is in that record. For a VM, issue a key for
   this deployment rather than copying a developer's:
   ```sh
   node core/cli/bin/forge.js consumer issue-credential portal-local \
     --method private-key-jwt --key-file .mcpforge/portal/portal-local.private.jwk.json --by <you>
   ```
   That stages a change proposal adding the public key; it must be approved and
   merged (a reviewed grant, like every consumer change). `docker-compose.yml`
   mounts `.mcpforge/portal/portal-local.private.jwk.json` read-only.

5. **Put TLS in front.** The portal sets `Secure` session cookies whenever it is
   not reached on loopback, so over plain HTTP sign-in cannot work. Terminate
   HTTPS at nginx/Caddy on the VM, or at an OCI Load Balancer, and proxy to
   `127.0.0.1:3000` (portal) and, for agents, `127.0.0.1:3939` (gateway).
   The gateway's consumer-assertion audience is fixed at
   `https://mcpforge.local/mcp` whatever public URL it is reached on; clients
   sign for that audience. Do not set `MCPFORGE_GATEWAY_AUDIENCE` on the portal
   alone: the gateway does not read it, and the two would stop matching.

6. **Start:**
   ```sh
   docker compose up -d
   docker compose logs -f   # expect: "gateway listening on 0.0.0.0:3939 (mode=full, portal=spawned)"
   ```

7. **Create the first admin, then everyone else in the portal (W0-P28).** Once,
   on the VM, create the first identity admin. Type the password at the prompt
   (`-it`), or pipe it on stdin (`-T`). Never pass it as an argument:
   ```sh
   docker compose exec -it mcpforge-core node core/cli/bin/forge.js \
     identity bootstrap-admin --username <name> --display-name "<Full Name>"      --group mcpforge-superadmins
   ```
   `--group mcpforge-superadmins` makes that first account the **super admin**
   (W0-P31): every tool through `roles/super-admin.yaml`, identity admin, and
   every portal persona. Leave `--group` off for an ordinary identity admin
   (`mcpforge-admins`). It refuses
   once any active admin exists, and when `CI=true`. After that, sign in to the
   portal as that admin and create, disable, enable, regroup and reset accounts
   under **Governance → Users**. Every change is an `identity` audit row. Groups
   map to roles in the same mapping file.

   **Self-approval (W0-P22).** A super admin may approve their own definitional
   change only if their subject (printed by `bootstrap-admin` as
   `created <name> (local:…)`) is listed under `superAdminSubjects:` in
   `overlays/<deployment>/mappings/groups-to-roles.yaml`. `forge validate`
   (which Merge runs) fails any other self-approved record, and reports a
   listed super admin's as a warning naming them. The first entry cannot come
   from your own portal change (that change would be a self-approval by
   someone not yet listed): add it as a commit to the definitions clone, or
   have another approver approve the change.

8. **Point it at a JD Edwards target and probe (optional).** Start the mock
   (`pnpm --filter @mcpforge/mocks mock-jde`, or run it as a second service),
   store the three per-server client credentials named in
   `overlays/local/ais-targets.yaml`, one at a time, typing each value at the
   prompt (or `--from-file <path>`; never as an argument):
   ```sh
   docker compose exec -it mcpforge-core node core/cli/bin/forge.js \n     secrets put secretRef://binding/jde-fin-ap/token-provider-client
   ```
   (W0-P26: refused when `CI=true`, for a ref the overlay does not name, and
   for one already stored unless `--replace`.) Restart the gateway, then run
   `forge probe --env local` so tools are enabled.
   Without a probe report every tool reads "Not probed" and nothing can execute.

## Verified (30 Sep 2026, local Docker)

- `docker compose build` succeeds on `node:22-slim` (including `better-sqlite3`).
- The gateway binds `0.0.0.0:3939` in the container and spawns the portal.
- Unregistered callers are refused on `/mcp` and `/api/v1` (`CONSUMER_UNREGISTERED`, with a `next`).
- Local sign-in through the gateway issues tokens from the container's sealed store.
- A browser signed in to the portal and read live data (Activity, Environments, Catalog)
  through `/api/v1` with the portal's consumer key.

## Not possible yet (and which task owns it)

- **A real JD Edwards target:** the real token-provider protocol is an open human decision (W0-P14 note).
- **Ordinary approvers:** only the super admin (`mcpforge-superadmins`, W0-P31) holds a real role today. The other local groups still map to role ids that do not exist (`p2p-ap-clerk`, …), so they grant nothing until the mapping is fixed (owner). A super admin approving their OWN request is W0-P32.
- **External agents (Claude Desktop, any MCP client): optional**, by owner decision (30 Sep 2026). Nothing in this deployment depends on one. Issuing a key to a new consumer is still unbuilt (W0-P19, W0-Q12, both optional).
- **Production secrets:** `OciVaultStore` is the named production target and is not built in Wave 0.
- **More than one instance:** SQLite is single-instance; multi-replica needs the Postgres store (built and tested, not wired for this image).
