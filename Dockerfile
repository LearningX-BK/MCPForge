# MCPForge — W0-K4, the local Docker stack.
#
# 02 §10.1 item 2 / §6.6: Wave 0 must build, run, probe and demo on one
# developer machine with NO cloud account, NO OCI service and NO managed
# database. This image is Linux-targeted (node:22-slim / Debian) precisely so
# the eventual OCI move is a registry push, not a rebuild — the base image,
# the pnpm workspace layout and the process-start entrypoint (`launch.ts`,
# W0-K2) do not change between here and production; only the SQLite driver
# swaps for the Postgres one behind the store interface (02 §10.2).
#
# Topology decision (02 §6.6's "mcpforge-core" box): ONE image holds BOTH the
# gateway and the portal, exactly as the deployment diagram draws it — the
# gateway process is the entrypoint, and in `full` mode (the default) it
# spawns the portal as a SIBLING OS PROCESS via `pnpm -C core/portal start`
# (see core/gateway/launch.ts, W0-K2's headless-mode work), never in-process.
# Two Dockerfiles would fork a topology the architecture already settled as
# one artefact; MCPFORGE_MODE=headless (same image) is how a deployment opts
# out of the portal, per §6.5 — restated here rather than re-derived.
#
# Build stages:
#   deps    — install the full pnpm workspace (needs devDependencies: `tsc`,
#             `next`, test runners — Wave 0 has no separate prod-only lockfile
#             split, and this keeps the image buildable from a clean clone
#             with nothing hand-curated).
#   build   — compile the gateway (`tsc --build`, i.e. the `typecheck` script,
#             which — because `declaration`/`composite` are set in
#             tsconfig.base.json — also emits real `dist/**/*.js`, including
#             `dist/launch.js`, the process entrypoint) and build the portal
#             (`next build`). `generated/**` is already committed (manifest-
#             first, CI-verified clean) so no `forge codegen` runs here.
#   runtime — the image that actually ships: the built workspace, pruned dev
#             tooling not required, pnpm still present because `launch.ts`
#             spawns the portal via `pnpm -C core/portal start` at runtime.
#
# Small implementation details decided here, not specified upstream (CLAUDE.md
# §8): base image is `node:22-slim` (Debian, matches the `>=22 <23` engines
# constraint and gives `better-sqlite3` a prebuilt-binary-friendly glibc
# target); the runtime stage keeps full `node_modules` rather than a pruned
# `pnpm deploy` bundle — correctness over image size for a Wave 0 dev
# convenience image; gateway port 3939 matches `launch.ts`'s own default
# (`MCPFORGE_GATEWAY_PORT`), portal port 3000 matches Next's default.

FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

# ---- deps: install the whole workspace -------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY core ./core
COPY adapters/function ./adapters/function
COPY adapters/rest ./adapters/rest
COPY adapters/vendor ./adapters/vendor
COPY tools/eslint-rules ./tools/eslint-rules
COPY tools/ci ./tools/ci
COPY tests ./tests
RUN pnpm install --frozen-lockfile

# ---- build: compile gateway, build portal -----------------------------------
FROM deps AS build
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm -C core/gateway run typecheck \
 && pnpm -C core/portal run build

# ---- runtime: what actually ships -------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV MCPFORGE_MODE=full
ENV MCPFORGE_GATEWAY_PORT=3939
ENV PORT=3000

COPY --from=build /app ./

# `.mcpforge/` holds the SQLite runtime store (02 §10.2) — created here so the
# mount point exists before the volume is attached, but the volume (declared
# in docker-compose.yml) is what actually persists it across `down && up`.
RUN mkdir -p /app/.mcpforge

EXPOSE 3939 3000

# The gateway is the entrypoint; in `full` mode it spawns the portal as a
# sibling `pnpm -C core/portal start` process (core/gateway/launch.ts).
# `MCPFORGE_MODE=headless` (same image, one env var, 02 §6.5) starts the
# gateway alone.
CMD ["node", "core/gateway/dist/launch.js"]
