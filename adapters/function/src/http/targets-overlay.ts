// MCPForge — where each module server's AIS target lives. W0-P14.
//
// `overlays/<deployment>/ais-targets.yaml`, `kind: AisTargets`. Values only
// (02 §6.3): URLs, a client id, and a `secretRef://` — never a secret value,
// never code. Changing one URL here is how the same core image points at the
// local mock JDE or a real AIS server (owner decision, W0-P11 (2)).
//
//   apiVersion: mcpforge/v1
//   kind: AisTargets
//   deployment: local
//   targets:
//     <targetId>: { baseUrl: <http(s) URL>, tokenUrl: <http(s) URL> }
//   servers:
//     <serverId>:
//       target: <targetId>
//       clientId: <the gateway's client id at the token provider>
//       clientCredentialRef: secretRef://binding/<serverId>/<purpose>
//
// The parser is STRICT, because an overlay "may only set values that the base
// schema declares": any undeclared key is an error. Two rules are structural:
//
//   * 02 §11.5 rule 4, one credential per binding × module × environment: a
//     server's `clientCredentialRef` must be scoped `secretRef://binding/
//     <that serverId>/…`. Server ids are unique keys, so this also makes it
//     impossible for two servers to share one credential. The deployment is
//     the environment; each overlay is one deployment.
//   * No default target. A server that is not listed has NO AIS target, and
//     `aisTargetForServer` refuses it rather than guessing (CLAUDE.md #1's
//     spirit: nothing is reached by a fallback).

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

export const AIS_TARGETS_KIND = 'AisTargets';

export interface AisTargetEndpoint {
  readonly baseUrl: string;
  readonly tokenUrl: string;
}

export interface AisServerTarget extends AisTargetEndpoint {
  readonly serverId: string;
  readonly targetId: string;
  readonly clientId: string;
  /** `secretRef://binding/<serverId>/<purpose>`. A reference, never a value. */
  readonly clientCredentialRef: string;
}

export interface AisTargetsOverlay {
  readonly deployment: string;
  readonly servers: ReadonlyMap<string, AisServerTarget>;
}

export class AisTargetsOverlayInvalid extends Error {
  readonly problems: readonly string[];
  constructor(source: string, problems: readonly string[]) {
    super(`${source} is not a valid AisTargets overlay:\n  ${problems.join('\n  ')}`);
    this.name = 'AisTargetsOverlayInvalid';
    this.problems = problems;
  }
}

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const BINDING_REF_RE = /^secretRef:\/\/binding\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function httpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return (
      (u.protocol === 'http:' || u.protocol === 'https:') && u.username === '' && u.password === ''
    );
  } catch {
    return false;
  }
}

function onlyKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  problems: string[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key))
      problems.push(`${where}.${key} is not declared by the AisTargets schema`);
  }
}

/** Parse an already-loaded YAML document. Throws `AisTargetsOverlayInvalid` listing every problem. */
export function parseAisTargetsOverlay(
  doc: unknown,
  source = 'ais-targets overlay',
): AisTargetsOverlay {
  const problems: string[] = [];
  if (!isRecord(doc)) throw new AisTargetsOverlayInvalid(source, ['the document is not a mapping']);
  onlyKeys(doc, ['apiVersion', 'kind', 'deployment', 'targets', 'servers'], '', problems);
  if (doc['apiVersion'] !== 'mcpforge/v1') problems.push('apiVersion must be mcpforge/v1');
  if (doc['kind'] !== AIS_TARGETS_KIND) problems.push(`kind must be ${AIS_TARGETS_KIND}`);
  const deployment = doc['deployment'];
  if (typeof deployment !== 'string' || !ID_RE.test(deployment)) {
    problems.push('deployment must be a lower-kebab id');
  }

  const targets = new Map<string, AisTargetEndpoint>();
  const rawTargets = doc['targets'];
  if (!isRecord(rawTargets) || Object.keys(rawTargets).length === 0) {
    problems.push('targets must be a non-empty mapping');
  } else {
    for (const [id, t] of Object.entries(rawTargets)) {
      const where = `targets.${id}`;
      if (!ID_RE.test(id)) problems.push(`${where}: the target id must be a lower-kebab id`);
      if (!isRecord(t)) {
        problems.push(`${where} must be a mapping`);
        continue;
      }
      onlyKeys(t, ['baseUrl', 'tokenUrl'], where, problems);
      if (!httpUrl(t['baseUrl']))
        problems.push(`${where}.baseUrl must be an http(s) URL with no credentials in it`);
      if (!httpUrl(t['tokenUrl']))
        problems.push(`${where}.tokenUrl must be an http(s) URL with no credentials in it`);
      if (httpUrl(t['baseUrl']) && httpUrl(t['tokenUrl'])) {
        targets.set(id, { baseUrl: t['baseUrl'], tokenUrl: t['tokenUrl'] });
      }
    }
  }

  const servers = new Map<string, AisServerTarget>();
  const rawServers = doc['servers'];
  if (!isRecord(rawServers) || Object.keys(rawServers).length === 0) {
    problems.push('servers must be a non-empty mapping');
  } else {
    for (const [serverId, s] of Object.entries(rawServers)) {
      const where = `servers.${serverId}`;
      if (!ID_RE.test(serverId)) problems.push(`${where}: the server id must be a lower-kebab id`);
      if (!isRecord(s)) {
        problems.push(`${where} must be a mapping`);
        continue;
      }
      onlyKeys(s, ['target', 'clientId', 'clientCredentialRef'], where, problems);
      const targetId = s['target'];
      const clientId = s['clientId'];
      const ref = s['clientCredentialRef'];
      const endpoint = typeof targetId === 'string' ? targets.get(targetId) : undefined;
      if (endpoint === undefined) problems.push(`${where}.target must name one of targets.*`);
      if (typeof clientId !== 'string' || clientId.trim().length === 0) {
        problems.push(`${where}.clientId must be a non-empty string`);
      }
      const match = typeof ref === 'string' ? BINDING_REF_RE.exec(ref) : null;
      if (match === null) {
        problems.push(
          `${where}.clientCredentialRef must be a secretRef://binding/<serverId>/<purpose> reference`,
        );
      } else if (match[1] !== serverId) {
        problems.push(
          `${where}.clientCredentialRef is scoped to "${match[1]}", not "${serverId}" — one credential per binding × module × environment (02 §11.5 rule 4)`,
        );
      }
      if (
        endpoint !== undefined &&
        typeof clientId === 'string' &&
        match !== null &&
        match[1] === serverId
      ) {
        servers.set(
          serverId,
          Object.freeze({
            serverId,
            targetId: targetId as string,
            clientId,
            clientCredentialRef: ref as string,
            ...endpoint,
          }),
        );
      }
    }
  }

  if (problems.length > 0) throw new AisTargetsOverlayInvalid(source, problems);
  return Object.freeze({ deployment: deployment as string, servers });
}

/** Read and parse `overlays/<deployment>/ais-targets.yaml`. */
export function loadAisTargetsOverlay(path: string): AisTargetsOverlay {
  let doc: unknown;
  try {
    doc = parseYaml(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new AisTargetsOverlayInvalid(path, [
      `could not be read as YAML: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
  return parseAisTargetsOverlay(doc, path);
}

/** The AIS target for one module server. Refuses an unlisted server; there is no default target. */
export function aisTargetForServer(overlay: AisTargetsOverlay, serverId: string): AisServerTarget {
  const found = overlay.servers.get(serverId);
  if (found === undefined) {
    throw new AisTargetsOverlayInvalid(`deployment ${overlay.deployment}`, [
      `server ${serverId} has no AIS target; add it under servers: in overlays/${overlay.deployment}/ais-targets.yaml`,
    ]);
  }
  return found;
}
