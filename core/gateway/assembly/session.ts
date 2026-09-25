// MCPForge — W0-P15. Session establishment: consumer ∩ human -> the real ScopeContext.
//
// 02 §4.2 steps [2] (human authentication), [2a] (consumer, already done by
// the transport's ConsumerAuthenticator before this runs), [3] (identity
// resolution) and [4]'s inputs. Non-negotiable #6: every call needs BOTH a
// registered consumer AND a resolved human, and authorization is their
// INTERSECTION. This module is where both meet:
//
//   establish()  runs once, at `initialize`, only after [2a] succeeded. It
//                authenticates the human through the configured
//                IdentityProvider, maps their groups to roles from git, pairs
//                them with the consumer's compiled authorizations and freezes
//                the consumer's provenance. Any failure is a refusal BEFORE a
//                session exists, so no `tools/list` is ever served.
//   reverify()   runs on EVERY later request on that session. 05 §11.8: "per-
//                user identity passthrough is ... still required on every
//                call". The bearer is verified again, its subject must be the
//                one the session was established for, and the human's roles
//                are re-derived from the fresh token, so a group removal takes
//                effect on the next call, not the next session. A session id
//                alone is never an identity.
//
// Built once at startup from committed artefacts, failing closed on any
// problem: role scopes (`generated/roles/*.scope.json`), package selections
// (`generated/packages/*.selection.json`), the deployment's selection
// (`overlays/<deployment>/deployment.yaml`), the group->role mapping
// (`overlays/<deployment>/mappings/`) and consumer authorizations
// (`generated/consumers/*.authorization.json`). Probe status comes from
// `.mcpforge/probe-report.json` when present and is otherwise the explicit
// "no report" source: nothing is visible until a probe has run (02 §4.5).
// Flags come from the runtime-flags store, injected.
//
// TARGET-IDENTITY MAPPINGS, stated rather than faked: every Wave 0 binding is
// `function`, whose target identity is carried by the per-user token exchange
// (02 §3.5 option (a), W0-P14): the token provider maps the subject, and the
// runtime echo proves it. There is no `overlays/<d>/mappings/*-identity.yaml`
// for a Wave 0 binding type (02 §3.3/§3.4's db- and ebs-identity mappings
// arrive with those binding types), so there is nothing further to load here.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ForgeError, forgeError } from '@mcpforge/shared/errors';
import { loadProbeReport, probeReportPath, probeStatusMap } from '@mcpforge/probe';
import type { IdentityProvider, Principal } from '../identity/types.js';
import {
  loadDeploymentGroupRoleMapping,
  rolesForPrincipal,
  type GroupRoleMappingFile,
} from '../identity/group-role-mapping.js';
import {
  consumerAuthorizationFromArtefact,
  deploymentView,
  noProbeReport,
  packageSelectionsFromArtefacts,
  roleScopesFromArtefacts,
  staticProbeStatuses,
  type ConsumerAuthorizationView,
  type ProbeStatusSource,
  type RuntimeFlagSource,
  type ScopeContext,
  type ScopeSession,
  type SessionActivation,
  type ToolId,
} from '../scope/index.js';
import type { ConsumerAuthSuccess } from '../transport/consumer-auth/index.js';
import { consumerSessionProvenance } from '../transport/consumer-auth/provenance.js';
import { loadDeploymentConfig, type DeploymentConfig } from './deployment.js';

export interface SessionAssemblyOptions {
  readonly repoRoot: string;
  /** The overlay directory name under `overlays/`. */
  readonly deployment: string;
  readonly identity: IdentityProvider;
  readonly flags: RuntimeFlagSource;
  /** Defaults to `.mcpforge/probe-report.json`, or no report (nothing visible). */
  readonly probe?: ProbeStatusSource;
  readonly now?: () => Date;
}

/** One established session: who, for which consumer, and its provenance. Frozen. */
export interface EstablishedSession {
  readonly sessionId: string;
  readonly principal: Principal;
  readonly scopeSession: ScopeSession;
  /** The full ScopeContext at `now` — rebuilt per call so kill-switch windows are current. */
  scopeAt(now?: Date): ScopeContext;
}

export type SessionOutcome =
  | { readonly ok: true; readonly session: EstablishedSession }
  | { readonly ok: false; readonly error: ForgeError };

export interface SessionAssembly {
  readonly deployment: DeploymentConfig;
  /** Startup findings that are not fatal, e.g. a mapping granting a role that does not exist. */
  readonly warnings: readonly string[];
  establish(input: {
    readonly auth: ConsumerAuthSuccess;
    readonly request: Request;
    readonly sessionId: string;
    readonly correlationId: string;
  }): Promise<SessionOutcome>;
  reverify(
    session: EstablishedSession,
    request: Request,
    correlationId: string,
  ): Promise<SessionOutcome>;
}

/** Thrown at startup when a committed artefact the session needs is missing or malformed. */
export class SessionAssemblyUnavailable extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`Sessions cannot be established:\n  ${problems.join('\n  ')}`);
    this.name = 'SessionAssemblyUnavailable';
    this.problems = problems;
  }
}

function readJsonDir(dir: string, suffix: string, problems: string[]): unknown[] {
  if (!existsSync(dir)) return [];
  const out: unknown[] = [];
  for (const name of readdirSync(dir)
    .filter((n) => n.endsWith(suffix))
    .sort()) {
    try {
      out.push(JSON.parse(readFileSync(join(dir, name), 'utf8')));
    } catch (error) {
      problems.push(
        `${join(dir, name)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return out;
}

function defaultProbe(repoRoot: string): ProbeStatusSource {
  if (!existsSync(probeReportPath(repoRoot))) return noProbeReport();
  // A report that exists but does not validate is a startup failure, never
  // read as "no report" and never half-trusted (loadProbeReport throws).
  return staticProbeStatuses(probeStatusMap(loadProbeReport(repoRoot)));
}

/** Build the session assembly, or throw `SessionAssemblyUnavailable`. */
export function createSessionAssembly(options: SessionAssemblyOptions): SessionAssembly {
  const { repoRoot } = options;
  const now = options.now ?? (() => new Date());
  const problems: string[] = [];
  const warnings: string[] = [];

  let deployment: DeploymentConfig | undefined;
  try {
    deployment = loadDeploymentConfig(repoRoot, options.deployment);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }

  let mapping: readonly GroupRoleMappingFile[] = [];
  try {
    mapping = loadDeploymentGroupRoleMapping(join(repoRoot, 'overlays'), options.deployment);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }

  let roleScopes: ReadonlyMap<string, ReadonlySet<ToolId>> = new Map();
  let packageSelections: ReadonlyMap<string, ReadonlySet<ToolId>> = new Map();
  const consumers = new Map<string, ConsumerAuthorizationView>();
  try {
    roleScopes = roleScopesFromArtefacts(
      readJsonDir(join(repoRoot, 'generated', 'roles'), '.scope.json', problems),
    );
    packageSelections = packageSelectionsFromArtefacts(
      readJsonDir(join(repoRoot, 'generated', 'packages'), '.selection.json', problems),
    );
    for (const raw of readJsonDir(
      join(repoRoot, 'generated', 'consumers'),
      '.authorization.json',
      problems,
    )) {
      const view = consumerAuthorizationFromArtefact(raw);
      consumers.set(view.consumerId, view);
    }
  } catch (error) {
    problems.push(
      `a compiled artefact is malformed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let probe: ProbeStatusSource = noProbeReport();
  try {
    probe = options.probe ?? defaultProbe(repoRoot);
  } catch (error) {
    problems.push(
      `.mcpforge/probe-report.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (problems.length > 0 || deployment === undefined)
    throw new SessionAssemblyUnavailable(problems);

  // A mapped role with no compiled scope grants nothing (fail closed), but it
  // almost certainly means the mapping and roles/ disagree, so it is surfaced.
  const mappedRoles = new Set<string>();
  for (const doc of mapping) {
    for (const entry of Object.values(doc.groups)) entry.roles.forEach((r) => mappedRoles.add(r));
    for (const entry of Object.values(doc.subjectOverrides ?? {})) {
      entry.roles.forEach((r) => mappedRoles.add(r));
    }
  }
  const unknownRoles = [...mappedRoles].filter((r) => !roleScopes.has(r)).sort();
  if (unknownRoles.length > 0) {
    warnings.push(
      `overlays/${options.deployment}/mappings grants roles with no compiled scope under generated/roles/, which therefore grant nothing: ${unknownRoles.join(', ')}`,
    );
  }

  const deploymentConfig = deployment;
  const deploymentScope = deploymentView(deploymentConfig.deployment, deploymentConfig.packageIds);

  async function authenticateHuman(
    request: Request,
    correlationId: string,
  ): Promise<
    { ok: true; principal: Principal; roles: readonly string[] } | { ok: false; error: ForgeError }
  > {
    try {
      const principal = await options.identity.authenticate(request);
      const groups = await options.identity.resolveGroups(principal);
      const roles = rolesForPrincipal(mapping, { subject: principal.subject, groups });
      return { ok: true, principal: { ...principal, groups: [...groups] }, roles };
    } catch (error) {
      if (error instanceof ForgeError) return { ok: false, error };
      // An unexpected provider failure (an IdP outage, a JWKS fetch error) is
      // still a refusal: no human was resolved, and there is no fallback.
      return {
        ok: false,
        error: forgeError(
          'IDENTITY_UNRESOLVED',
          'The identity provider could not resolve a human for this request.',
          correlationId,
          {
            next: 'Sign in again to obtain a fresh token and retry; if it persists, report this correlationId to the MCPForge operator — the identity provider may be unavailable.',
          },
        ),
      };
    }
  }

  function buildSession(
    sessionId: string,
    principal: Principal,
    roles: readonly string[],
    consumer: ConsumerAuthorizationView,
    provenance: ScopeSession['consumerSession'],
    activation: SessionActivation,
  ): EstablishedSession {
    const scopeSession: ScopeSession = Object.freeze({
      principal,
      heldRoleIds: Object.freeze([...roles]),
      consumer,
      consumerSession: provenance,
      activation,
    });
    return Object.freeze({
      sessionId,
      principal,
      scopeSession,
      scopeAt: (at?: Date): ScopeContext => ({
        deployment: deploymentScope,
        packageSelections,
        roleScopes,
        session: scopeSession,
        probe,
        flags: options.flags,
        now: at ?? now(),
      }),
    });
  }

  return {
    deployment: deploymentConfig,
    warnings: Object.freeze(warnings),

    async establish({ auth, request, sessionId, correlationId }) {
      // [2a] already passed. The consumer's COMPILED authorizations are what
      // scope intersects with; a registered record with no compiled artefact
      // authorizes nothing and holds no session.
      const consumerId = auth.consumer.record.id;
      const consumer = consumers.get(consumerId);
      if (consumer === undefined) {
        return {
          ok: false,
          error: forgeError(
            'CONSUMER_UNREGISTERED',
            `Consumer ${consumerId} is registered but has no compiled authorization, so it may hold no session.`,
            correlationId,
            {
              next: `Ask the MCPForge operator to run forge codegen so generated/consumers/${consumerId}.authorization.json exists, then reconnect.`,
            },
          ),
        };
      }
      if (consumer.effectiveStatus !== 'active') {
        return {
          ok: false,
          error: forgeError(
            'CONSUMER_SUSPENDED',
            `Consumer ${consumerId}'s compiled registration is ${consumer.effectiveStatus}.`,
            correlationId,
            {
              next: `This client's registration is ${consumer.effectiveStatus}. Contact the consumer's steward to renew or reinstate it; no session was established.`,
            },
          ),
        };
      }

      // [2] + [3] — the human. Refused here means no session, no tools/list.
      const human = await authenticateHuman(request, correlationId);
      if (!human.ok) return human;

      return {
        ok: true,
        session: buildSession(
          sessionId,
          human.principal,
          human.roles,
          consumer,
          consumerSessionProvenance(auth, sessionId),
          { mode: 'default' },
        ),
      };
    },

    async reverify(session, request, correlationId) {
      const human = await authenticateHuman(request, correlationId);
      if (!human.ok) return human;
      if (human.principal.subject !== session.principal.subject) {
        return {
          ok: false,
          error: forgeError(
            'AUTH_REQUIRED',
            'This session was established for a different person than the one this request authenticates as.',
            correlationId,
            {
              next: 'Open a new MCP session with your own token; a session belongs to the person it was established for and cannot be carried by anyone else.',
            },
          ),
        };
      }
      return {
        ok: true,
        session: buildSession(
          session.sessionId,
          human.principal,
          human.roles,
          session.scopeSession.consumer,
          session.scopeSession.consumerSession,
          session.scopeSession.activation,
        ),
      };
    },
  };
}
