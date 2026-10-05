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
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  createFunctionExecutor,
  createHttpAisClient,
  createHttpAisTokenProvider,
  loadAisTargetsOverlay,
  validatePairRegistry,
  type AisClient,
  type ValidatePairRegistry,
} from '@mcpforge/adapter-function';
import { loadManifestFiles } from '@mcpforge/codegen/validate';
import {
  isEnvironmentClass,
  loadProbeReport,
  probeDeployment,
  probeReportPath,
  writeProbeReport,
  type ClientCredentialSource,
  type EnvironmentClass,
} from '@mcpforge/probe';
import { createGatewayHttpTransport, type GatewayHttpTransport } from './transport/index.js';
import { ConsumerAuthenticator, readConsumerPresentation } from './transport/index.js';
import { loadConsumerRegistry } from './consumer/index.js';
import { openRuntimeStore } from './store/store.js';
import type { StoreConfig } from './store/config.js';
import type { RuntimeStore } from './store/repository.js';
import { EncryptedFileStore, type SecretStore } from './secrets/server.js';
import { parseSecretRef } from './secrets/index.js';
import {
  DEFAULT_LOCAL_AUDIENCE,
  DEFAULT_LOCAL_ISSUER,
  buildMultiProviderIdentity,
  loadIdentityConfig,
  localIdentityProvider,
  localSignInService,
  localTokenIssuer,
  localUserStore,
  type LocalIdentityProvider,
  type SessionLimits,
} from './identity/index.js';
import type { IncomingHttpHeaders } from 'node:http';
import { createReadApi } from './api/v1/read-api.js';
import { resolveGatewayKeys } from './identity/keys.js';
import {
  identityAdminGroups,
  identityAdminGroupsFor,
  loadDeploymentGroupRoleMapping,
  mappedGroupsFor,
  mappedProviderIds,
  superAdminGroups,
} from './identity/group-role-mapping.js';
import type { LocalUserStore } from './identity/local/index.js';
import type { UserAdminDeps } from './api/v1/user-admin.js';
import { approvalGate } from './policy/approval/index.js';
import {
  confirmWriteGate,
  executionGrantCheck,
  functionDryRunner,
  guardrailEvaluator,
  idempotencyGate,
  type PolicyRuntime,
} from './policy/index.js';
import { CapsRuntime, loadEffectiveCaps } from './caps/index.js';
import { createPolledRuntimeFlagSource } from './flags/index.js';
import {
  createCallExecution,
  createCatalogueReloader,
  createServedSurface,
  createSessionAssembly,
  loadRuntimeCatalogue,
  type PreparedSurfaceDefinitions,
  type RuntimeCatalogue,
  type SessionAssembly,
  type SurfaceDefinitionsInput,
} from './assembly/index.js';

/**
 * W0-P33c — one catalogue generation's parts: the catalogue and everything
 * the launch assembly derives from it and the rest of the definitions root.
 */
interface DefinitionsParts {
  readonly catalogue: RuntimeCatalogue;
  readonly sessions: SessionAssembly;
  readonly superAdminGroups: readonly string[];
  readonly surface: SurfaceDefinitionsInput;
}

/** A generation the reloader holds: its parts, plus the surface definitions checked against them. */
interface DefinitionsGeneration extends DefinitionsParts {
  readonly prepared: PreparedSurfaceDefinitions;
}

/**
 * W0-P28 — the user-admin half the read API needs: the local store, and who
 * may administer it, from this deployment's git mapping. The session assembly
 * reads the same files at startup and refuses to start on a broken one, so a
 * failure here cannot be reached with a gateway that is otherwise serving.
 */
function userAdminFor(
  repoRoot: string,
  deployment: string,
  users: LocalUserStore,
): Omit<UserAdminDeps, 'store' | 'gatewayVersion' | 'now'> {
  const mapping = loadDeploymentGroupRoleMapping(join(repoRoot, 'overlays'), deployment);
  // W0-P23: the accounts administered here are LOCAL, so their groups are the
  // local provider's; the actor may come from any configured provider.
  const admins = identityAdminGroupsFor(mapping, 'local');
  const mappedGroups = new Set<string>([...mappedGroupsFor(mapping, 'local'), ...admins]);
  return {
    users,
    identityAdminGroups: admins,
    identityAdminActorGroups: identityAdminGroups(mapping),
    mappedGroups,
  };
}

/** The closed, two-value vocabulary 02 §6.5 names. Nothing else is a mode. */
export const GATEWAY_MODES = ['headless', 'full'] as const;
export type GatewayMode = (typeof GATEWAY_MODES)[number];

const DEFAULT_MODE: GatewayMode = 'full';
/** The probe target name a portal-triggered run reports under: `forge probe`'s default. */
const PORTAL_PROBE_TARGET_ID = 'local';
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
  throw new Error(`Unknown MCPFORGE_MODE "${raw}" — expected one of: ${GATEWAY_MODES.join(', ')}.`);
}

/**
 * W0-P33d — this deployment's environment class (02 §7.1), from `MCPFORGE_ENV`
 * exactly as `forge dev`, `forge consumer issue-credential` and `forge probe`
 * read it: unset or empty is `local` (the clean-clone path), and any value
 * outside the closed four refuses startup rather than being assumed local.
 * It decides whether the portal may START a probe (`mayProbeFromPortal`).
 */
export function parseEnvironmentClass(
  env: { readonly MCPFORGE_ENV?: string | undefined } = process.env,
): EnvironmentClass {
  const raw = env.MCPFORGE_ENV?.trim();
  if (raw === undefined || raw === '') return 'local';
  if (isEnvironmentClass(raw)) return raw;
  throw new Error(
    `Unknown MCPFORGE_ENV "${raw}" — expected one of: local, probe, staging, prod (02 §7.1).`,
  );
}

export interface LaunchOptions {
  /**
   * Install root: the code, and `.mcpforge/` (runtime store, sealed secrets,
   * probe report). Also the definitions root unless `definitionsRoot` is set.
   */
  readonly repoRoot: string;
  /**
   * W0-P33a — where the DEFINITIONS live: manifests/, generated/, roles,
   * consumers/, overlays/. On the VM this is the git clone the portal merges
   * into (docs/build-plan/w0-p33-portal-merge.md §2.1). Defaults to
   * `repoRoot`; the process entrypoint reads `MCPFORGE_DEFINITIONS_ROOT`.
   */
  readonly definitionsRoot?: string;
  /** Defaults to `parseGatewayMode()`. */
  readonly mode?: GatewayMode;
  /**
   * W0-P33d — this deployment's environment class. Defaults to `local`; the
   * process entrypoint passes `parseEnvironmentClass()` (`MCPFORGE_ENV`).
   */
  readonly environmentClass?: EnvironmentClass;
  /** Port the gateway's Streamable HTTP endpoint binds to. 0 = OS-assigned (tests). */
  readonly gatewayPort?: number;
  readonly gatewayHost?: string;
  /** The assertion audience `[2a]` checks incoming consumer assertions against. */
  readonly audience?: string;
  /** The overlay directory under `overlays/`. Defaults to `MCPFORGE_DEPLOYMENT`, else `local`. */
  readonly deployment?: string;
  /** Defaults to SQLite at `<repoRoot>/.mcpforge/runtime.db` (02 §10.2). */
  readonly storeConfig?: StoreConfig;
  /** Defaults to `EncryptedFileStore` under `<repoRoot>` (02 §11.5). Injected by tests. */
  readonly secretStore?: SecretStore;
  /**
   * Sign-in session limits (W0-P4 §9 decision 6; defaults 8 h idle, 12 h
   * absolute). Their overlay home is `identity.sessionLimits` in
   * `overlays/<deployment>/identity.yaml` (W0-P23); a value here overrides it.
   */
  readonly sessionLimits?: Partial<SessionLimits>;
  /** Kill-switch poll interval (02 §4.7, default 5 s). */
  readonly flagPollMs?: number;
  /**
   * Injectable in tests so `launch.contract.test.ts` can assert *whether* a
   * portal process would be spawned, in which mode, without actually
   * starting `next start` (which is not built in a unit-test run) or
   * shelling out at all.
   */
  readonly spawnPortal?: (repoRoot: string, gatewayUrl: string) => ChildProcess;
}

export interface LaunchedGateway {
  readonly mode: GatewayMode;
  readonly gateway: GatewayHttpTransport;
  readonly gatewayPort: number;
  /** Non-null only in `full` mode. */
  readonly portal: ChildProcess | null;
  /** The runtime store the gateway writes audit and state to. */
  readonly store: RuntimeStore;
  /**
   * The identity provider sessions authenticate humans against. Humans sign in
   * over `POST /auth/local/token` (W0-P5a); this handle is exposed for tests
   * and for the token-issuance CLI (W0-P19).
   */
  readonly identity: LocalIdentityProvider;
  /** Refs of gateway keys minted on this start because they did not exist. Refs only. */
  readonly mintedKeys: readonly string[];
  /** Startup findings that are not fatal (e.g. a mapping naming a role with no scope). */
  readonly warnings: readonly string[];
  close(): Promise<void>;
}

function defaultSpawnPortal(repoRoot: string, gatewayUrl: string): ChildProcess {
  const options: SpawnOptions = {
    cwd: repoRoot,
    // W0-P5b: the portal signs its viewers in through this gateway's
    // `/auth/local/*`, so it is told where the gateway actually listens.
    env: { ...process.env, MCPFORGE_GATEWAY_URL: gatewayUrl },
    stdio: 'inherit',
    // Windows needs a shell to resolve the `pnpm` shim; POSIX does not.
    shell: process.platform === 'win32',
  };
  return spawn('pnpm', ['-C', 'core/portal', 'start'], options);
}

/**
 * Probe evidence for `_VALIDATE` siblings (02 §3.5), from the probe report's
 * own `validatePair` blocks. Only a PASSED probe check counts as present; no
 * report means no evidence, and every validate-pair write degrades.
 */
function validatePairEvidence(repoRoot: string): ValidatePairRegistry {
  const presence = new Map<string, boolean>();
  if (existsSync(probeReportPath(repoRoot))) {
    for (const tool of loadProbeReport(repoRoot).tools) {
      const pair = tool.validatePair;
      if (pair !== undefined && pair.expectedRef !== null) {
        presence.set(pair.expectedRef, pair.present && pair.evidence === 'probe_check');
      }
    }
  }
  return validatePairRegistry(presence);
}

/**
 * One AIS client per module server, from `overlays/<d>/ais-targets.yaml`
 * (W0-P14), routed by orchestration name. The executor holds ONE client, and
 * an `AisRequest` names its orchestration, never its server, so the route is
 * built from the catalogue: every execute ref and every `_VALIDATE` ref maps to
 * the server its manifest declares. An unrouted orchestration is refused.
 */
function routedAisClient(
  repoRoot: string,
  deployment: string,
  catalogue: RuntimeCatalogue,
  secretStore: SecretStore,
): AisClient {
  const overlay = loadAisTargetsOverlay(join(repoRoot, 'overlays', deployment, 'ais-targets.yaml'));
  const byServer = new Map<string, AisClient>();
  for (const [serverId, target] of overlay.servers) {
    byServer.set(
      serverId,
      createHttpAisClient({
        baseUrl: target.baseUrl,
        tokens: createHttpAisTokenProvider({
          tokenUrl: target.tokenUrl,
          clientId: target.clientId,
          clientCredential: { ref: parseSecretRef(target.clientCredentialRef), secretStore },
        }),
      }),
    );
  }
  const serverFor = new Map<string, string>();
  for (const tool of catalogue.tools.values()) {
    if (tool.functionDescriptor === undefined) continue;
    serverFor.set(tool.functionDescriptor.ref, tool.entry.serverId);
    const validateRef = tool.dryRunDescriptor?.validateRef;
    if (validateRef !== undefined && validateRef !== null) {
      serverFor.set(validateRef, tool.entry.serverId);
    }
  }
  return {
    call(request) {
      const serverId = serverFor.get(request.orchestration);
      const client = serverId === undefined ? undefined : byServer.get(serverId);
      if (client === undefined) {
        return Promise.reject(
          new Error(
            `orchestration ${request.orchestration} has no AIS target: add its server to overlays/${deployment}/ais-targets.yaml`,
          ),
        );
      }
      return client.call(request);
    },
  };
}

/**
 * Builds and starts the ONE gateway assembly, then — only in `full` mode —
 * spawns the portal as a sibling process. `headless` returns with `portal:
 * null` and never touches `spawnPortal` at all.
 *
 * W0-P11: this is the composition root of 02 §4.2's whole request path, and it
 * composes only. Every stage is the tested library: [2a] the consumer
 * registry, [2]/[3] the local identity provider over the runtime store, [4]
 * the session assembly, [5] the served surface, [6] the ten-stage chain with
 * the real 6c–6h seams and the execution-grant keyring, [7]–[9] the call
 * execution over the `function` executor and the routed HTTP AIS client. The
 * executor is constructed HERE and nowhere else in production code
 * (tests/policy/escalation.trust-boundary.test.ts). Anything that cannot be
 * built refuses startup; there is no partial gateway.
 */
export async function launchGateway(options: LaunchOptions): Promise<LaunchedGateway> {
  const mode = options.mode ?? parseGatewayMode();
  const audience = options.audience ?? DEFAULT_AUDIENCE;
  const repoRoot = options.repoRoot;
  // W0-P33a: definitions (git) and runtime state (.mcpforge/) may live apart.
  const defsRoot = options.definitionsRoot ?? repoRoot;
  const deployment = options.deployment ?? process.env['MCPFORGE_DEPLOYMENT'] ?? 'local';
  const environmentClass = options.environmentClass ?? 'local';

  const catalogue = await loadRuntimeCatalogue({ repoRoot: defsRoot });
  const store = await openRuntimeStore(
    options.storeConfig ?? { kind: 'sqlite', file: join(repoRoot, '.mcpforge', 'runtime.db') },
  );
  const cleanups: (() => Promise<void> | void)[] = [() => store.close()];

  try {
    const secretStore = options.secretStore ?? new EncryptedFileStore({ repoRoot });
    const keys = await resolveGatewayKeys(secretStore);

    // [2]/[3] — the Wave 0 local provider, verifying tokens signed with the
    // gateway's own key against accounts in the runtime store (W0-D1/D2).
    const users = localUserStore({ store });
    const identity = localIdentityProvider({
      issuer: localTokenIssuer({
        signingKey: keys.jwtSigning,
        issuer: DEFAULT_LOCAL_ISSUER,
        audience: DEFAULT_LOCAL_AUDIENCE,
      }),
      source: users.principalSource(),
    });
    // W0-P23 — `identity.providers` (overlays/<d>/identity.yaml): every
    // configured provider, local and OIDC, behind one router. OIDC discovery
    // runs here, so an unreachable or misconfigured IdP refuses startup.
    const identityConfig = loadIdentityConfig(join(defsRoot, 'overlays'), deployment);
    const humans = await buildMultiProviderIdentity(identityConfig, { local: identity });
    const localConfigured = identityConfig.providers.some((p) => p.kind === 'local');
    // W0-P5a — the gateway as the local provider's token endpoint (W0-P4 §2),
    // only when a local provider is configured. Session limits come from the
    // overlay (W0-P23); LaunchOptions may still override them (tests).
    const localSignIn = localConfigured
      ? localSignInService({
          store,
          users,
          provider: identity,
          limits: { ...identityConfig.sessionLimits, ...options.sessionLimits },
        })
      : undefined;
    const identityWarnings = mappedProviderIds(
      loadDeploymentGroupRoleMapping(join(defsRoot, 'overlays'), deployment),
    )
      .filter((id) => humans.provider(id) === undefined)
      .map(
        (id) =>
          `overlays/${deployment}/mappings names identity provider "${id}", which overlays/${deployment}/identity.yaml does not configure; its entries grant nobody anything`,
      );

    // ¬KillSwitched — polled from the store (02 §4.7).
    const flags = createPolledRuntimeFlagSource(store.runtimeFlags);
    await flags.refreshNow();

    const capsLoaded = loadEffectiveCaps(join(defsRoot, 'overlays', deployment, 'caps.yaml'));
    if (!capsLoaded.ok) {
      throw new Error(
        `overlays/${deployment}/caps.yaml is invalid: ${JSON.stringify(capsLoaded.error)}`,
      );
    }
    const caps = capsLoaded.caps;

    // The ONE approval gate: stage 6g raises through it and the /api/v1
    // decision path (W0-P25) decides through it. There is no second instance.
    const approvals = approvalGate({ queue: store.approvals, keyring: keys.confirm });
    // ONE rate limiter for the life of the process, shared by every catalogue
    // generation (W0-P33c): a reload must never hand anyone fresh rate-limit
    // windows or concurrency slots.
    const rateLimiter = new CapsRuntime(caps);

    /**
     * W0-P33c — everything derived from ONE runtime catalogue, built the same
     * way at startup and on every reload. Constructs, never serves: what it
     * returns is swapped in only by the reloader's commit. Throws on any
     * problem (the session assembly's and the AIS overlay's own refusals).
     */
    function generationFor(catalogue: RuntimeCatalogue): DefinitionsParts {
      const sessions = createSessionAssembly({
        repoRoot: defsRoot,
        runtimeRoot: repoRoot,
        deployment,
        identity: humans,
        flags,
      });
      const executor = createFunctionExecutor({
        client: routedAisClient(defsRoot, deployment, catalogue, secretStore),
        grants: executionGrantCheck(keys.executionGrant),
      });
      const scopeHoursFor = (toolId: string): number | undefined =>
        catalogue.tools.get(toolId)?.view.writeSafety?.idempotencyScopeHours ?? undefined;
      const runtime: PolicyRuntime = {
        rateLimiter,
        argumentValidator: catalogue.argumentValidator,
        guardrails: guardrailEvaluator({}),
        writeGate: confirmWriteGate({
          writeSafetyFor: (id) => catalogue.writeSafetyFor(id),
          dryRun: functionDryRunner({
            executor,
            keyring: keys.executionGrant,
            descriptorFor: (id) => catalogue.dryRunDescriptorFor(id),
            validatorFor: (id) => catalogue.schemaValidatorFor(id),
            registry: validatePairEvidence(repoRoot),
          }),
          keyring: keys.confirm,
          approval: approvals,
        }),
        idempotency: idempotencyGate({ store, scopeHoursFor }),
        executionGrantKeyring: keys.executionGrant,
      };
      const calls = createCallExecution({ store, catalogue, executor, caps });
      return {
        catalogue,
        sessions,
        // W0-P32 — who may approve their own request (flagged), and W0-P33c —
        // who may reload: git, like the rest, as of this generation.
        superAdminGroups: superAdminGroups(
          loadDeploymentGroupRoleMapping(join(defsRoot, 'overlays'), deployment),
        ),
        surface: { catalogue, runtime, execute: calls.execute, record: calls.record },
      };
    }

    const first = generationFor(catalogue);
    const surface = createServedSurface({ repoRoot: defsRoot, ...first.surface });

    const reloader = createCatalogueReloader<DefinitionsGeneration>({
      initial: { ...first, prepared: surface.definitions },
      async build() {
        // Re-run the startup loader on the definitions root, then build every
        // derived part and check the discovery artefacts against it. Nothing
        // here is served until `commit`.
        const parts = generationFor(await loadRuntimeCatalogue({ repoRoot: defsRoot }));
        return { ...parts, prepared: surface.prepare(parts.surface) };
      },
      commit(next) {
        surface.install(next.prepared);
      },
      notify: () => surface.notifyToolListChanged(),
    });

    // The sessions the transport and the read API use: always the serving
    // generation's assembly. A live session is re-verified on every request
    // (W0-P15), so after a reload its next request is scoped by the new
    // role scopes, mapping, consumer authorizations and probe report.
    const sessions: SessionAssembly = {
      get deployment() {
        return reloader.current().sessions.deployment;
      },
      get warnings() {
        return reloader.current().sessions.warnings;
      },
      establish: (input) => reloader.current().sessions.establish(input),
      reverify: (session, request, correlationId) =>
        reloader.current().sessions.reverify(session, request, correlationId),
    };

    // Kill switch -> `list_changed` to every live session, on every poll where
    // the active flag set changed (02 §4.7, §5.8).
    const flagWatch = surface.watchFlags(flags);
    const timer = setInterval(() => {
      void flags
        .refreshNow()
        .then(() => flagWatch.checkAndNotify())
        .catch(() => undefined);
    }, options.flagPollMs ?? 5000);
    timer.unref();
    cleanups.push(() => clearInterval(timer));

    const registry = loadConsumerRegistry(defsRoot);
    const authenticator = new ConsumerAuthenticator({ registry, audience });
    const consumerAuth = {
      authenticate: (headers: IncomingHttpHeaders, correlationId: string) =>
        authenticator.authenticate(readConsumerPresentation(headers), correlationId),
    };
    // W0-P3a — the read-only governance API, behind the SAME [2a] gate and the
    // SAME session assembly as /mcp (W0-P2 §7, non-negotiable 6).
    const readApi = createReadApi({
      repoRoot,
      definitionsRoot: defsRoot,
      store,
      catalogue: () => reloader.current().catalogue,
      consumerAuth,
      sessions,
      consumers: registry,
      // W0-P23: the configured kinds, e.g. `local` or `local+oidc`.
      identityProviderKind: [...new Set(identityConfig.providers.map((p) => p.kind))].join('+'),
      approvals,
      // W0-P28 — who may administer local users is git: `identityAdmins:` in
      // this deployment's group mapping, read once here like the grants. Only
      // when there are local accounts to administer (W0-P23).
      ...(localConfigured ? { userAdmin: userAdminFor(defsRoot, deployment, users) } : {}),
      // W0-P32 — who may approve their own request (flagged): git, like the
      // rest, read from the generation serving each request.
      superAdminGroups: () => reloader.current().superAdminGroups,
      // W0-P33c — the reload endpoint: super admin only, audited, all or nothing.
      catalogueReload: reloader,
      // W0-P33d — the portal-triggered probe: super admin, `local` only,
      // audited. The definitions root is probed (the one implementation
      // `forge probe` runs); the report lands under the install root, beside
      // the vault the client credentials are read from.
      probeRun: {
        environmentClass,
        targetId: PORTAL_PROBE_TARGET_ID,
        run: () =>
          probeDeployment({
            definitionsRoot: defsRoot,
            manifestDocs: loadManifestFiles(defsRoot).map((f) => f.doc),
            target: {
              id: PORTAL_PROBE_TARGET_ID,
              environmentClass,
              deploymentId: deployment,
            },
            credential: (ref) =>
              ({ ref: parseSecretRef(ref), secretStore }) as ClientCredentialSource<unknown>,
          }),
        write: (report) => {
          writeProbeReport(repoRoot, report);
        },
      },
    });
    const gateway = createGatewayHttpTransport({
      consumerAuth,
      readApi,
      sessions,
      ...(localSignIn === undefined ? {} : { localSignIn }),
      // W0-P23 — which providers to offer, and who an OIDC token is.
      identityRoutes: { identity: humans, config: identityConfig },
      createServer: (handle) => surface.createServer(handle),
    });
    const { port } = await gateway.listen(options.gatewayPort ?? 0, options.gatewayHost);
    cleanups.unshift(() => gateway.close());

    // W0-K4: a wildcard bind (0.0.0.0 / ::, as in the container) is not an
    // address to DIAL; the sibling portal on the same host reaches the gateway
    // over loopback either way.
    const dialHost =
      options.gatewayHost === undefined ||
      options.gatewayHost === '0.0.0.0' ||
      options.gatewayHost === '::'
        ? '127.0.0.1'
        : options.gatewayHost;
    const gatewayUrl = `http://${dialHost}:${port}`;
    const portal =
      mode === 'full' ? (options.spawnPortal ?? defaultSpawnPortal)(repoRoot, gatewayUrl) : null;

    return {
      mode,
      gateway,
      gatewayPort: port,
      portal,
      store,
      identity,
      mintedKeys: keys.minted,
      warnings: [
        ...first.sessions.warnings,
        ...identityWarnings,
        ...catalogue.warnings.map((w) => w.message),
      ],
      async close() {
        for (const cleanup of cleanups) await cleanup();
        if (portal) {
          portal.kill();
        }
      },
    };
  } catch (error) {
    for (const cleanup of cleanups) await cleanup();
    throw error;
  }
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
  // W0-K4: loopback unless told otherwise. A developer's `npx tsx launch.ts`
  // stays private to the machine; the container image sets 0.0.0.0 so its
  // published port is reachable, with TLS in front of it (see DEPLOY.md).
  const host = process.env['MCPFORGE_GATEWAY_HOST'] ?? '127.0.0.1';
  // W0-P33a: on the VM the definitions are a git clone mounted beside the code.
  const definitionsRoot = process.env['MCPFORGE_DEFINITIONS_ROOT'];
  launchGateway({
    repoRoot: process.cwd(),
    // W0-P33d: MCPFORGE_ENV, read here only, like MCPFORGE_DEFINITIONS_ROOT.
    environmentClass: parseEnvironmentClass(),
    ...(definitionsRoot === undefined || definitionsRoot === '' ? {} : { definitionsRoot }),
    gatewayPort: port,
    gatewayHost: host,
  })
    .then((launched) => {
      console.log(
        `mcpforge gateway listening on ${host}:${launched.gatewayPort} (mode=${launched.mode}, portal=${launched.portal ? 'spawned' : 'not started'})`,
      );
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    });
}
