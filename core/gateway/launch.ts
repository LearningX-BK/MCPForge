// MCPForge — headless mode. W0-K2, 02 §6.5.
//
// "`MCPFORGE_MODE=headless` starts the gateway without the portal. Same
// image, one environment variable. Because the portal is a separate Next.js
// app inside the image rather than a coupled component, this is a
// process-start decision, not a build variant."
//
// This module is that process-start decision, and nothing more. Both modes
// build and start the IDENTICAL gateway assembly below — same
// `createGatewayHttpTransport` call, same real `ConsumerAuthenticator` wired
// to the same git-backed consumer registry (`loadConsumerRegistry`, W0-N1).
// The only thing `mode` decides is whether a second process (the portal) is
// also spawned. There is no second build, no second image, and no branch
// that constructs a different gateway for either mode — a mode that could
// only be proven by rebuilding would not be a headless *mode*, it would be a
// headless *variant*, which is exactly what 02 §6.5 rules out.
//
// **02 §6.5 / R8, restated as code:** the portal, when it runs, is spawned as
// its own OS process (`pnpm -C core/portal start`, i.e. `next start`) — never
// `require`d or imported into this process. It reaches the gateway the only
// way an external client can: over `/mcp` (or, once built, `/api/*`) on the
// network. See `launch.contract.test.ts` for the both-modes proof this
// buys, and `../../tools/ci/src/portal-http-boundary.ts` for the static half
// of R8 (no portal source file may import a *runtime* — non-type — binding
// from `@mcpforge/gateway` beyond the small, explicitly allow-listed, pure/
// side-effect-free helpers that already exist there).

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createGatewayHttpTransport, type GatewayHttpTransport } from './transport/index.js';
import { ConsumerAuthenticator, readConsumerPresentation } from './transport/index.js';
import { loadConsumerRegistry } from './consumer/index.js';

/** The closed, two-value vocabulary 02 §6.5 names. Nothing else is a mode. */
export const GATEWAY_MODES = ['headless', 'full'] as const;
export type GatewayMode = (typeof GATEWAY_MODES)[number];

const DEFAULT_MODE: GatewayMode = 'full';
const DEFAULT_AUDIENCE = 'https://mcpforge.local/mcp';

/**
 * Reads `MCPFORGE_MODE` from the given environment (defaults to
 * `process.env`, injectable for tests). Unset/empty means `full` — the
 * portal ships unless something explicitly asks for headless. Any value
 * outside the closed vocabulary is a hard failure, not a silent fallback to
 * either mode: CLAUDE.md non-negotiable 1's discipline (no default-shaped
 * bypass) applies just as much to a process-start flag as to a credential.
 */
export function parseGatewayMode(
  env: { readonly MCPFORGE_MODE?: string | undefined } = process.env,
): GatewayMode {
  const raw = env.MCPFORGE_MODE;
  if (raw === undefined || raw === '') return DEFAULT_MODE;
  if ((GATEWAY_MODES as readonly string[]).includes(raw)) return raw as GatewayMode;
  throw new Error(
    `Unknown MCPFORGE_MODE "${raw}" — expected one of: ${GATEWAY_MODES.join(', ')}.`,
  );
}

export interface LaunchOptions {
  /** Repo root, for `consumers/**` resolution and the portal's `pnpm -C` cwd. */
  readonly repoRoot: string;
  /** Defaults to `parseGatewayMode()`. */
  readonly mode?: GatewayMode;
  /** Port the gateway's Streamable HTTP endpoint binds to. 0 = OS-assigned (tests). */
  readonly gatewayPort?: number;
  readonly gatewayHost?: string;
  /** The assertion audience `[2a]` checks incoming consumer assertions against. */
  readonly audience?: string;
  /**
   * Injectable in tests so `launch.contract.test.ts` can assert *whether* a
   * portal process would be spawned, in which mode, without actually
   * starting `next start` (which is not built in a unit-test run) or
   * shelling out at all.
   */
  readonly spawnPortal?: (repoRoot: string) => ChildProcess;
}

export interface LaunchedGateway {
  readonly mode: GatewayMode;
  readonly gateway: GatewayHttpTransport;
  readonly gatewayPort: number;
  /** Non-null only in `full` mode. */
  readonly portal: ChildProcess | null;
  close(): Promise<void>;
}

function defaultSpawnPortal(repoRoot: string): ChildProcess {
  const options: SpawnOptions = {
    cwd: repoRoot,
    stdio: 'inherit',
    // Windows needs a shell to resolve the `pnpm` shim; POSIX does not.
    shell: process.platform === 'win32',
  };
  return spawn('pnpm', ['-C', 'core/portal', 'start'], options);
}

/**
 * Builds and starts the ONE gateway assembly, then — only in `full` mode —
 * spawns the portal as a sibling process. `headless` returns with `portal:
 * null` and never touches `spawnPortal` at all.
 */
export async function launchGateway(options: LaunchOptions): Promise<LaunchedGateway> {
  const mode = options.mode ?? parseGatewayMode();
  const audience = options.audience ?? DEFAULT_AUDIENCE;

  const registry = loadConsumerRegistry(options.repoRoot);
  const authenticator = new ConsumerAuthenticator({ registry, audience });

  const gateway = createGatewayHttpTransport({
    consumerAuth: {
      authenticate: (headers, correlationId) =>
        authenticator.authenticate(readConsumerPresentation(headers), correlationId),
    },
  });
  const { port } = await gateway.listen(options.gatewayPort ?? 0, options.gatewayHost);

  const portal =
    mode === 'full' ? (options.spawnPortal ?? defaultSpawnPortal)(options.repoRoot) : null;

  return {
    mode,
    gateway,
    gatewayPort: port,
    portal,
    async close() {
      await gateway.close();
      if (portal) {
        portal.kill();
      }
    },
  };
}

/**
 * The image's actual process entrypoint (`node launch.js`, once built). Kept
 * separate from `launchGateway` so tests call the latter directly with an
 * injected `spawnPortal` and never reach this block; guarded so importing
 * this module (as every test and `index.ts` re-export does) never has the
 * side effect of starting a real server.
 */
function isDirectlyExecuted(): boolean {
  const entry = process.argv[1];
  return typeof entry === 'string' && import.meta.url === new URL(`file://${entry}`).href;
}

if (isDirectlyExecuted()) {
  const port = Number(process.env['MCPFORGE_GATEWAY_PORT'] ?? 3939);
  launchGateway({ repoRoot: process.cwd(), gatewayPort: port })
    .then((launched) => {
      console.log(
        `mcpforge gateway listening on :${launched.gatewayPort} (mode=${launched.mode}, portal=${launched.portal ? 'spawned' : 'not started'})`,
      );
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    });
}
