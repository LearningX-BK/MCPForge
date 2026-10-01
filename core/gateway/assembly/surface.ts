// MCPForge — W0-P16. The served surface: the four meta-tools, the role-scoped
// `tools/list`, and `tools/call` into the policy chain. 02 §4.2 step [5],
// 02 §5.2, §5.3, §5.8, §11.4.
//
// One `McpServer` per established session (the transport calls
// `createServer(handle)` once, after W0-P15 bound the consumer and the human).
// Every request rebuilds the context from the handle's LATEST verified session,
// so a group removal or a kill switch takes effect on the next call:
//
//   ScopeContext   = the session's `scopeAt(now)`, with this session's
//                    activation (held here, because `forge.activate` is the
//                    one thing that changes it and a re-verification must not
//                    reset it).
//   PolicyContext  = that scope + the runtime catalogue's entries + the
//                    compiled role views + the consumer's own grants + the
//                    injected `PolicyRuntime` (the stage 6c–6h seams).
//   MetaContext    = that policy context + the index, cards and descriptions.
//
// WHAT IS LISTED (02 §5.3(d), §5.7). The four meta-tools, always. Then:
//   * an EXPLICIT activation lists what it activated that this session may
//     list (`resolveDiscovery`'s `listable`, which applies all six predicates
//     and removes ungranted elevated tools);
//   * the DEFAULT lists the resident core set of the session's process role,
//     `coreTools` ∩ listable, whose ≤1,300 tokens codegen enforces per role.
//     "A known process role" is read as: the human holds exactly one role with
//     a compiled scope. A human holding several has no single role hint; their
//     cores' sum is not budgeted by anything, so they get 02 §5.7 Case B, the
//     four meta-tools only, and reach the rest through `forge.find` or
//     `forge.activate {role}`.
//
// WHAT A CALL DOES. `forge.find`, `forge.describe` and `forge.activate` are
// the W0-G4 functions, unchanged. `forge.invoke` is `forgeInvoke`, which is
// `invokeThroughForgeInvoke`; any other name is `callThroughToolsCall`. Both
// run the identical ten-stage chain with the real context (CLAUDE.md #7):
//   * `refused`   -> a tool ERROR carrying the closed code and its `next`;
//   * `responded` -> a tool RESULT: a plan, an approval hand-off, a replay;
//   * `proceed`   -> the injected `execute` handler (W0-P17: dispatcher,
//                    executor, result shaping, audit). This module never
//                    executes anything itself.
//
// `notifications/tools/list_changed` fires on activation (through W0-G4's
// notifier seam, to this session's server), on kill-switch changes
// (`watchFlags`, one watcher broadcasting to every live session), 02 §5.8,
// and after a catalogue reload installs new definitions (W0-P33c, `install`
// then `notifyToolListChanged`).

import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { buildDescribeResponse } from '@mcpforge/codegen/budget';
import { buildResidentDefinition } from '@mcpforge/codegen/templates';
import { forgeError, type ForgeError } from '@mcpforge/shared/errors';
import type { RuntimeFlagSource, ScopeContext, SessionActivation } from '../scope/index.js';
import {
  callThroughToolsCall,
  type EntryPointCall,
  type PolicyContext,
  type PolicyDecision,
  type PolicyEntryPoint,
  type PolicyRuntime,
} from '../policy/index.js';
import {
  FORGE_ACTIVATE,
  FORGE_DESCRIBE,
  FORGE_FIND,
  FORGE_INVOKE,
  forgeActivate,
  forgeDescribe,
  forgeFind,
  forgeInvoke,
  META_TOOL_DEFINITIONS,
  resolveDiscovery,
  type AgentMessageSource,
  type ElevatedApproverSource,
  type MetaContext,
  type MetaSession,
  type MetaToolDetail,
} from '../meta/index.js';
import {
  watchForKillSwitchChanges,
  type KillSwitchNotifyHandle,
  type ToolListChangedNotifier,
} from '../flags/index.js';
import {
  createGatewayMcpServer,
  type GatewayServerInfo,
  type ServedToolDefinition,
  type SessionHandle,
} from '../transport/index.js';
import type { RuntimeCatalogue } from './catalogue.js';
import type { EstablishedSession } from './session.js';
import { loadSurfaceArtefacts, type SurfaceArtefacts } from './surface-artefacts.js';

/** What the chain admitted, handed to the executor seam. */
export interface ProceedInput {
  readonly call: EntryPointCall & { readonly entryPoint: PolicyEntryPoint };
  readonly decision: Extract<PolicyDecision, { readonly outcome: 'proceed' }>;
  readonly policy: PolicyContext;
  readonly session: EstablishedSession;
}

/**
 * Step [7]–[9] for an admitted call: dispatch, execute, shape, audit. W0-P17
 * supplies it. Required, with no default: a surface that cannot execute must
 * say so at construction, not answer `proceed` with something that looks
 * like a result.
 */
export type ProceedHandler = (input: ProceedInput) => Promise<CallToolResult>;

/**
 * W0-P17 — appends the audit row for a call the chain ended: a refusal, a plan
 * or approval hand-off, a 6h replay. Required: every call leaves a row.
 */
export type DecisionRecordHandler = (input: {
  readonly call: EntryPointCall & { readonly entryPoint: PolicyEntryPoint };
  readonly ctx: PolicyContext;
  readonly decision: Exclude<PolicyDecision, { readonly outcome: 'proceed' }>;
}) => Promise<unknown>;

export interface ServedSurfaceOptions {
  readonly repoRoot: string;
  readonly catalogue: RuntimeCatalogue;
  /** The stage 6c–6h seams and the execution-grant keyring. */
  readonly runtime: PolicyRuntime;
  readonly execute: ProceedHandler;
  readonly record: DecisionRecordHandler;
  /** The probe report's per-tool `agentMessage` (02 §4.5). Absent: the refusing predicate's `next`. */
  readonly probeMessages?: AgentMessageSource;
  readonly approvers?: ElevatedApproverSource;
  readonly serverInfo?: GatewayServerInfo;
  readonly now?: () => Date;
}

/**
 * W0-P33c — everything the surface serves that is derived from ONE runtime
 * catalogue: the catalogue, the stage 6c–6h seams built over it, the executor
 * seams, and the discovery artefacts and definitions read against it. A
 * reload replaces all of it together or none of it.
 */
export interface SurfaceDefinitionsInput {
  readonly catalogue: RuntimeCatalogue;
  readonly runtime: PolicyRuntime;
  readonly execute: ProceedHandler;
  readonly record: DecisionRecordHandler;
}

/** A fully built, checked set of surface definitions, ready to install. Opaque to callers. */
export interface PreparedSurfaceDefinitions {
  readonly catalogue: RuntimeCatalogue;
  readonly runtime: PolicyRuntime;
  readonly execute: ProceedHandler;
  readonly record: DecisionRecordHandler;
  readonly artefacts: SurfaceArtefacts;
  readonly resident: ReadonlyMap<string, ServedToolDefinition>;
  readonly details: ReadonlyMap<string, MetaToolDetail>;
}

export interface ServedSurface {
  /** The transport's `createServer`: one server per established session. */
  createServer(handle?: SessionHandle<unknown>): McpServer;
  /**
   * W0-P33c — build and cross-check the discovery artefacts against a new
   * catalogue WITHOUT serving them. Throws `SurfaceArtefactsUnavailable` on
   * any problem, and the served surface is untouched.
   */
  prepare(next: SurfaceDefinitionsInput): PreparedSurfaceDefinitions;
  /**
   * W0-P33c — swap the prepared definitions in for every live and future
   * session, in one assignment. A call already in flight finishes on the
   * definitions it started with: each request reads one snapshot, never a
   * mix. The caller then sends `list_changed` (`notifyToolListChanged`).
   */
  install(prepared: PreparedSurfaceDefinitions): void;
  /** The definitions currently served. */
  readonly definitions: PreparedSurfaceDefinitions;
  /** Emit `list_changed` to every live session (probe change, bundle deploy, role-grant change). */
  notifyToolListChanged(): Promise<void>;
  /**
   * Watch a runtime-flag source and broadcast `list_changed` whenever its
   * active set changes. Call `checkAndNotify()` after every poll (02 §4.7).
   */
  watchFlags(source: Pick<RuntimeFlagSource, 'activeFlags'>): KillSwitchNotifyHandle;
  /** Sessions with a live server. */
  readonly liveSessions: number;
}

// --- wire shapes --------------------------------------------------------------

function toolResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function toolError(error: ForgeError): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(error.toJSON()) }] };
}

// --- meta-tool inputs ------------------------------------------------------------
//
// The same shapes as `META_TOOL_DEFINITIONS`, checked before the W0-G4
// functions see them: those functions are typed, and a JSON argument is not.

const optionalString = z.string().optional();

const findInput = z.object({
  query: optionalString,
  app: optionalString,
  module: optionalString,
  entity: optionalString,
  verb: optionalString,
  write: z.boolean().optional(),
  bindingType: optionalString,
  process: optionalString,
  package: optionalString,
  limit: z.number().int().min(1).max(10).optional(),
});

const describeInput = z.object({ toolIds: z.array(z.string()) });

const activateInput = z.object({
  role: optionalString,
  package: optionalString,
  module: optionalString,
  toolIds: z.array(z.string()).optional(),
});

const invokeInput = z.object({
  toolId: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
  confirm: z.string().nullable().optional(),
});

/** Drop keys whose value is `undefined`, for `exactOptionalPropertyTypes`. */
function defined<T extends Record<string, unknown>>(
  value: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

function metaInputError(tool: string, issues: z.ZodError, correlationId: string): ForgeError {
  const first = issues.issues[0];
  const field =
    first === undefined || first.path.length === 0 ? '(arguments)' : first.path.join('.');
  return forgeError(
    'INPUT_INVALID',
    `${tool} was called with invalid arguments: ${field} ${first?.message ?? 'is invalid'}.`,
    correlationId,
    {
      condition: `${tool}'s argument ${field} does not match its input schema.`,
      next: `Call ${tool} again with ${field} corrected to the type its tools/list definition declares.`,
    },
  );
}

// --- the surface -------------------------------------------------------------------

/**
 * Stage 6c ADMITS a call by taking a concurrency slot (`CapsRuntime.check`),
 * and nothing released it until a dispatcher existed (caps/index.ts's own
 * header). The call is finished when its decision has been answered — a
 * refusal after 6c, a plan, a replay or an execution — so the slot is released
 * here, exactly once, for every call 6c admitted.
 */
function releaseConcurrency(
  call: EntryPointCall,
  policy: PolicyContext,
  decision: PolicyDecision,
): void {
  const limiter = policy.runtime.rateLimiter as {
    release?: (call: { readonly toolId: string }, ctx: PolicyContext) => void;
  };
  if (typeof limiter.release !== 'function') return;
  const admittedBy6c =
    decision.stagesRun.includes('6c') &&
    !(decision.outcome === 'refused' && decision.stage === '6c');
  if (admittedBy6c) limiter.release({ toolId: call.toolId }, policy);
}

function isEstablishedSession(value: unknown): value is EstablishedSession {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { scopeAt?: unknown }).scopeAt === 'function' &&
    typeof (value as { sessionId?: unknown }).sessionId === 'string'
  );
}

/** Build the served surface, or throw `SurfaceArtefactsUnavailable` at startup. */
export function createServedSurface(options: ServedSurfaceOptions): ServedSurface {
  const now = options.now ?? (() => new Date());
  const live = new Set<McpServer>();

  // Resident definitions and full descriptions are codegen's own builders over
  // codegen's own view of each manifest: the shapes the token-budget gate
  // measured (02 §5.3(b), (c)). Built once per catalogue: at startup, and
  // again only when a reload installs a new one (W0-P33c).
  function prepare(next: SurfaceDefinitionsInput): PreparedSurfaceDefinitions {
    const artefacts = loadSurfaceArtefacts(options.repoRoot, next.catalogue);
    const resident = new Map<string, ServedToolDefinition>();
    const details = new Map<string, MetaToolDetail>();
    for (const [id, tool] of next.catalogue.tools) {
      resident.set(id, buildResidentDefinition(tool.view) as unknown as ServedToolDefinition);
      details.set(id, Object.freeze(buildDescribeResponse(tool.view)));
    }
    return Object.freeze({
      catalogue: next.catalogue,
      runtime: next.runtime,
      execute: next.execute,
      record: next.record,
      artefacts,
      resident,
      details,
    });
  }

  // The ONE mutable reference. Every request reads it once, at its start, and
  // works from that snapshot to the end; `install` replaces it in a single
  // assignment. There is no field-by-field update a request could observe
  // half done.
  let served: PreparedSurfaceDefinitions = prepare(options);

  const broadcaster: ToolListChangedNotifier = {
    async sendToolListChanged() {
      await Promise.all([...live].map((server) => server.sendToolListChanged()));
    },
  };

  function createServer(handle?: SessionHandle<unknown>): McpServer {
    if (handle === undefined) {
      // Serving a surface needs a verified human. A transport wired without
      // W0-P15's session establisher is misconfigured; refuse to build.
      throw new Error(
        'The served surface needs an established session: start the transport with `sessions` (W0-P15).',
      );
    }
    const sessionHandle = handle;
    let activation: SessionActivation = { mode: 'default' };

    // Refers to `server` below; only ever called after it is built.
    const notifier: ToolListChangedNotifier = {
      sendToolListChanged: () => server.sendToolListChanged(),
    };

    function session(): EstablishedSession {
      const current = sessionHandle.current();
      if (!isEstablishedSession(current)) {
        throw new Error('The session handle does not carry an established session.');
      }
      return current;
    }

    // Every function below takes the request's snapshot `d` explicitly, so a
    // reload that lands mid-request cannot change what that request reads.
    function policyContext(d: PreparedSurfaceDefinitions, s: EstablishedSession): PolicyContext {
      const base = s.scopeAt(now());
      const scope: ScopeContext = { ...base, session: { ...base.session, activation } };
      return {
        scope,
        catalogue: d.catalogue.entries,
        roles: d.artefacts.roles,
        consumerBindingGrants: d.artefacts.consumerBindingGrantsFor(
          s.scopeSession.consumer.consumerId,
        ),
        runtime: d.runtime,
      };
    }

    function metaContext(d: PreparedSurfaceDefinitions, policy: PolicyContext): MetaContext {
      return {
        index: d.artefacts.index,
        policy,
        cards: { cardFor: d.artefacts.cardFor },
        details: { detailFor: (id) => d.details.get(id) ?? null },
        probeMessages: options.probeMessages ?? { agentMessageFor: () => null },
        ...(options.approvers === undefined ? {} : { approvers: options.approvers }),
        notifier,
      };
    }

    function residentIds(d: PreparedSurfaceDefinitions, ctx: MetaContext): readonly string[] {
      const listable = resolveDiscovery(ctx).listable;
      if (activation.mode === 'explicit') return listable;
      const held = ctx.policy.scope.session.heldRoleIds.filter((r) => d.artefacts.coreTools.has(r));
      if (held.length !== 1) return [];
      const core = new Set(d.artefacts.coreTools.get(held[0] as string));
      return listable.filter((id) => core.has(id));
    }

    async function decide(
      d: PreparedSurfaceDefinitions,
      s: EstablishedSession,
      policy: PolicyContext,
      call: EntryPointCall & { readonly entryPoint: PolicyEntryPoint },
      decision: PolicyDecision,
    ): Promise<CallToolResult> {
      try {
        switch (decision.outcome) {
          case 'refused':
            await d.record({ call, ctx: policy, decision });
            return toolError(decision.error);
          case 'responded':
            await d.record({ call, ctx: policy, decision });
            return toolResult(decision.response);
          case 'proceed':
            return await d.execute({ call, decision, policy, session: s });
        }
      } finally {
        releaseConcurrency(call, policy, decision);
      }
    }

    async function callTool(
      name: string,
      args: Readonly<Record<string, unknown>>,
    ): Promise<CallToolResult> {
      const correlationId = randomUUID();
      const d = served;
      const s = session();
      const policy = policyContext(d, s);
      const ctx = metaContext(d, policy);

      switch (name) {
        case FORGE_FIND: {
          const input = findInput.safeParse(args);
          if (!input.success) return toolError(metaInputError(name, input.error, correlationId));
          return toolResult(forgeFind(ctx, defined(input.data)));
        }
        case FORGE_DESCRIBE: {
          const input = describeInput.safeParse(args);
          if (!input.success) return toolError(metaInputError(name, input.error, correlationId));
          const described = forgeDescribe(ctx, input.data, correlationId);
          return described.result === 'error' ? toolError(described.error) : toolResult(described);
        }
        case FORGE_ACTIVATE: {
          const input = activateInput.safeParse(args);
          if (!input.success) return toolError(metaInputError(name, input.error, correlationId));
          const meta: MetaSession = {
            context: () => ctx,
            setActivation: (next) => {
              activation = next;
            },
          };
          const activated = forgeActivate(meta, defined(input.data), correlationId);
          return activated.result === 'error' ? toolError(activated.error) : toolResult(activated);
        }
        case FORGE_INVOKE: {
          const input = invokeInput.safeParse(args);
          if (!input.success) return toolError(metaInputError(name, input.error, correlationId));
          const invoke = defined(input.data);
          const decision = await forgeInvoke(ctx, invoke, correlationId);
          const callArgs =
            invoke.confirm === undefined || invoke.confirm === null
              ? invoke.arguments
              : { ...invoke.arguments, confirm: invoke.confirm };
          return decide(
            d,
            s,
            policy,
            { toolId: invoke.toolId, args: callArgs, correlationId, entryPoint: 'forge.invoke' },
            decision,
          );
        }
        default: {
          const call = { toolId: name, args, correlationId };
          const decision = await callThroughToolsCall(call, policy);
          return decide(d, s, policy, { ...call, entryPoint: 'tools/call' }, decision);
        }
      }
    }

    const server: McpServer = createGatewayMcpServer(options.serverInfo, {
      listTools() {
        const d = served;
        const ctx = metaContext(d, policyContext(d, session()));
        const tools: ServedToolDefinition[] = [...META_TOOL_DEFINITIONS];
        for (const id of residentIds(d, ctx)) {
          const definition = d.resident.get(id);
          if (definition !== undefined) tools.push(definition);
        }
        return tools;
      },
      async callTool(name, args) {
        try {
          return await callTool(name, args);
        } catch (cause) {
          // Anything unexpected is a refusal with a `next`, never a bare
          // protocol error and never a partial result.
          const correlationId = randomUUID();
          return toolError(
            forgeError('INTERNAL', `The gateway failed while handling ${name}.`, correlationId, {
              condition: `The served surface threw: ${cause instanceof Error ? cause.message : String(cause)}. Nothing was executed.`,
              next: `Report correlationId ${correlationId} to the MCPForge operator. Tell the human the request did not reach the target system.`,
            }),
          );
        }
      },
    });

    live.add(server);
    const previousOnClose = server.server.onclose;
    server.server.onclose = () => {
      live.delete(server);
      previousOnClose?.();
    };
    return server;
  }

  return {
    createServer,
    prepare,
    install(prepared) {
      served = prepared;
    },
    get definitions() {
      return served;
    },
    notifyToolListChanged: () => Promise.resolve(broadcaster.sendToolListChanged()),
    watchFlags: (source) => {
      const handle = watchForKillSwitchChanges(source, broadcaster);
      handle.primeBaseline();
      return handle;
    },
    get liveSessions() {
      return live.size;
    },
  };
}
