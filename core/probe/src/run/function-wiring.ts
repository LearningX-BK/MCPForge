// MCPForge — W0-P21: the `function` probe executor for a real deployment.
//
// `forge probe` used to register no executor at all, so every tool probed to
// `disabled_missing_binding` and a real report disabled the whole catalogue.
// This builds the executor the way the gateway builds its AIS routing
// (`core/gateway/launch.ts`): per MODULE SERVER, from
// `overlays/<deployment>/ais-targets.yaml` — that server's AIS target, its own
// client credential at the token provider (02 §11.5 rule 4) — and, per the
// owner's decision of 30 Sep 2026, the target's designated `probeIdentity`.
//
// Nothing is defaulted, and a gap is refused BEFORE any check runs, naming the
// fix: a `function` tool whose server has no AIS target, or whose target names
// no `probeIdentity`, makes the wiring fail with a `next`. A probe that quietly
// substituted an identity would be asserting carriage for a user nobody chose
// (CLAUDE.md #1, #2).
//
// The credential is reached through the caller's `credential` callback, so this
// package never holds a secret store: `SecretStore.get()` runs inside
// `adapters/function`'s token provider, where 02 §11.5 rule 2 allows it.

import {
  createHttpAisClient,
  createHttpAisTokenProvider,
  type AisTargetsOverlay,
  type ClientCredentialSource,
} from '@mcpforge/adapter-function';
import { createFunctionProbeExecutor } from './function-executor.js';
import type { ProbeCheckExecutor } from '../plan/types.js';

/** How long the probe waits for one token exchange. */
const TOKEN_TIMEOUT_MS = 10_000;

export interface FunctionProbeTool {
  readonly toolId: string;
  /** The owning module server (`manifest.server`). */
  readonly serverId: string;
}

export interface FunctionProbeWiringProblem {
  readonly serverId: string;
  readonly message: string;
  readonly next: string;
}

export type FunctionProbeWiring =
  | {
      readonly ok: true;
      /** One executor for the `function` binding type, routing each tool to its server's target. */
      readonly executor: ProbeCheckExecutor;
      /** serverId -> the identity that server was probed as, for the report details. */
      readonly probeIdentityByServer: ReadonlyMap<string, string>;
    }
  | { readonly ok: false; readonly problems: readonly FunctionProbeWiringProblem[] };

export interface WireFunctionProbeInput<Ref> {
  readonly overlay: AisTargetsOverlay;
  /** Every `function` tool to be probed, with its module server. */
  readonly tools: readonly FunctionProbeTool[];
  /** Turns a server's `clientCredentialRef` into a credential source. */
  readonly credential: (clientCredentialRef: string) => ClientCredentialSource<Ref>;
  readonly fetch?: typeof fetch;
}

export function wireFunctionProbe<Ref>(input: WireFunctionProbeInput<Ref>): FunctionProbeWiring {
  const { overlay } = input;
  const file = `overlays/${overlay.deployment}/ais-targets.yaml`;
  const serverOf = new Map(input.tools.map((t) => [t.toolId, t.serverId]));
  const servers = [...new Set(input.tools.map((t) => t.serverId))].sort();

  const problems: FunctionProbeWiringProblem[] = [];
  const executors = new Map<string, ProbeCheckExecutor>();
  const probeIdentityByServer = new Map<string, string>();

  for (const serverId of servers) {
    const target = overlay.servers.get(serverId);
    if (target === undefined) {
      problems.push({
        serverId,
        message: `module server ${serverId} has no AIS target, so its tools cannot be probed.`,
        next: `Add servers.${serverId} (target, clientId, clientCredentialRef) to ${file}, then re-run forge probe.`,
      });
      continue;
    }
    if (target.probeIdentity === undefined) {
      problems.push({
        serverId,
        message: `AIS target ${target.targetId} (used by ${serverId}) names no probeIdentity, and the probe never picks a test user itself.`,
        next: `Add probeIdentity: <the Principal.subject of the designated probe test user on that JDE instance> under targets.${target.targetId} in ${file}, then re-run forge probe.`,
      });
      continue;
    }
    const probeIdentity = target.probeIdentity;
    const tokens = createHttpAisTokenProvider({
      tokenUrl: target.tokenUrl,
      clientId: target.clientId,
      clientCredential: input.credential(target.clientCredentialRef),
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
    });
    executors.set(
      serverId,
      createFunctionProbeExecutor({
        client: createHttpAisClient({
          baseUrl: target.baseUrl,
          tokens,
          ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
        }),
        testIdentity: probeIdentity,
        // A failed exchange throws; the executor turns it into a FAILED auth
        // check carrying the reason, never an assumed pass.
        acquireToken: () => tokens.tokenFor(probeIdentity, AbortSignal.timeout(TOKEN_TIMEOUT_MS)),
      }),
    );
    probeIdentityByServer.set(serverId, probeIdentity);
  }

  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    probeIdentityByServer,
    executor: {
      bindingType: 'function',
      async run(ctx) {
        const serverId = serverOf.get(ctx.toolId);
        const executor = serverId === undefined ? undefined : executors.get(serverId);
        if (executor === undefined) {
          // Unreachable when the caller listed every function tool; if it did
          // not, the check FAILS rather than running under another server.
          return {
            name: ctx.check.name,
            result: 'fail',
            detail: `${ctx.toolId} was not wired to any module server's AIS target, so it was not probed`,
          };
        }
        return executor.run(ctx);
      },
    },
  };
}
