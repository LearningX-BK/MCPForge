// MCPForge — W0-P15. What this deployment selects: `overlays/<deployment>/deployment.yaml`.
//
// 02 §6.2: a deployment is the one core image + a catalogue selection + an
// overlay. The `Deployed` predicate (02 §5.1, axis 1) needs to know which
// packages are selected into THIS deployment, and that is deployment config,
// so it lives in the overlay, values only (02 §6.3). One kind per file, the
// same precedent as `caps.yaml` (kind Caps) and `ais-targets.yaml`:
//
//   apiVersion: mcpforge/v1
//   kind: Deployment
//   deployment: local
//   packages: [jde-fin]
//
// FLAGGED FOR THE OWNER: this file format is new (02 §6.3 names an overlay
// `config.yaml`, schema-validated, but no schema for it existed). It carries
// only the package selection. Strict: undeclared keys are refused, and every
// named package must have a compiled selection (`generated/packages/<id>.selection.json`).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface DeploymentConfig {
  readonly deployment: string;
  readonly packageIds: readonly string[];
}

export class DeploymentConfigInvalid extends Error {
  readonly problems: readonly string[];
  constructor(file: string, problems: readonly string[]) {
    super(`${file} is not a valid Deployment overlay:\n  ${problems.join('\n  ')}`);
    this.name = 'DeploymentConfigInvalid';
    this.problems = problems;
  }
}

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function deploymentConfigPath(repoRoot: string, deployment: string): string {
  return join(repoRoot, 'overlays', deployment, 'deployment.yaml');
}

/** Read and validate this deployment's selection. Throws `DeploymentConfigInvalid`. */
export function loadDeploymentConfig(repoRoot: string, deployment: string): DeploymentConfig {
  const file = deploymentConfigPath(repoRoot, deployment);
  const rel = `overlays/${deployment}/deployment.yaml`;
  if (!existsSync(file)) throw new DeploymentConfigInvalid(rel, ['the file does not exist']);
  let doc: unknown;
  try {
    doc = parseYaml(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new DeploymentConfigInvalid(rel, [
      `not YAML: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
  const problems: string[] = [];
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new DeploymentConfigInvalid(rel, ['the document is not a mapping']);
  }
  const d = doc as Record<string, unknown>;
  for (const key of Object.keys(d)) {
    if (!['apiVersion', 'kind', 'deployment', 'packages'].includes(key)) {
      problems.push(`${key} is not declared by the Deployment schema`);
    }
  }
  if (d['apiVersion'] !== 'mcpforge/v1') problems.push('apiVersion must be mcpforge/v1');
  if (d['kind'] !== 'Deployment') problems.push('kind must be Deployment');
  if (d['deployment'] !== deployment) {
    problems.push(`deployment must be "${deployment}", the overlay directory it lives in`);
  }
  const packages = d['packages'];
  const packageIds: string[] = [];
  if (!Array.isArray(packages) || packages.length === 0) {
    problems.push('packages must be a non-empty list of package ids');
  } else {
    for (const p of packages) {
      if (typeof p !== 'string' || !ID_RE.test(p)) {
        problems.push(`packages: ${JSON.stringify(p)} is not a package id`);
      } else if (!existsSync(join(repoRoot, 'generated', 'packages', `${p}.selection.json`))) {
        problems.push(
          `packages: ${p} has no compiled selection (generated/packages/${p}.selection.json); run forge codegen`,
        );
      } else if (!packageIds.includes(p)) {
        packageIds.push(p);
      }
    }
  }
  if (problems.length > 0) throw new DeploymentConfigInvalid(rel, problems);
  return Object.freeze({ deployment, packageIds: Object.freeze(packageIds) });
}
