// MCPForge — W0-P16. The committed discovery artefacts the served surface reads.
//
// Everything here is read once at startup from `generated/`, cross-checked
// against the runtime catalogue (W0-P13), and refused as a whole on any
// problem. Nothing is defaulted:
//
//   * the catalogue index (`generated/index/catalogue-index.json`), which
//     `forge.find` ranks over, read with the registry's own loader;
//   * the discovery cards (`generated/cards/<id>.json`), which `forge.find`
//     returns (02 §5.3(a));
//   * each role's POLICY view (`generated/roles/<id>.scope.json`): its
//     sensitivity ceiling, `writeAllowed` and compiled `bindingGrants`, which
//     stages 6e and 6e′ read, and its `coreTools`, the resident set 02 §5.3(d)
//     budgets at ≤1,300 tokens;
//   * each consumer's own compiled `bindingGrants`
//     (`generated/consumers/<id>.authorization.json`), for stage 6e′.
//
// The index and the cards must name exactly the catalogue's tools. A tool the
// chain can run that `forge.find` cannot rank would be a dead end, and a card
// for a tool the chain does not hold would advertise something unreachable.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { loadCatalogueIndex, type CatalogueIndex } from '@mcpforge/registry/index/server';
import type { CompiledBindingGrant, PolicyRoleView } from '../policy/types.js';
import type { MetaToolCard } from '../meta/types.js';
import type { RuntimeCatalogue } from './catalogue.js';

/** Thrown at startup when a discovery artefact is missing, malformed or disagrees with the catalogue. */
export class SurfaceArtefactsUnavailable extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`The tool surface cannot be served:\n  ${problems.join('\n  ')}`);
    this.name = 'SurfaceArtefactsUnavailable';
    this.problems = problems;
  }
}

export interface SurfaceArtefacts {
  readonly index: CatalogueIndex;
  cardFor(toolId: string): MetaToolCard | null;
  readonly roles: ReadonlyMap<string, PolicyRoleView>;
  /** roleId → the role's `coreTools`, the resident set (02 §5.3(d)). */
  readonly coreTools: ReadonlyMap<string, readonly string[]>;
  /** consumerId → the consumer's own compiled `bindingGrants`. */
  consumerBindingGrantsFor(consumerId: string): readonly CompiledBindingGrant[];
}

const standingSchema = z
  .object({
    ref: z.string(),
    status: z.string(),
    approver: z.string(),
    expiresAt: z.string(),
    effective: z.boolean(),
  })
  .passthrough();

const grantSchema = z
  .object({
    bindingType: z.string().min(1),
    names: z.array(z.string()),
    approvalRef: z.string().min(1),
    approver: z.string(),
    expiresAt: z.string().min(1),
    expired: z.boolean().optional(),
    standingAuthorization: z.union([standingSchema, z.string()]).optional(),
  })
  .passthrough();

const roleSchema = z
  .object({
    roleId: z.string().min(1),
    sensitivityCeiling: z.string().min(1),
    writeAllowed: z.boolean(),
    bindingGrants: z.array(grantSchema),
    coreTools: z.array(z.string()),
  })
  .passthrough();

const consumerSchema = z
  .object({
    consumerId: z.string().min(1),
    bindingGrants: z.array(grantSchema),
  })
  .passthrough();

/** Strip codegen's `//1`, `//2` provenance keys: they are file headers, not card fields. */
function withoutProvenance(doc: Record<string, unknown>): MetaToolCard {
  return Object.freeze(
    Object.fromEntries(Object.entries(doc).filter(([key]) => !key.startsWith('//'))),
  );
}

function readJson(file: string, problems: string[]): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    problems.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function jsonFiles(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(suffix))
    .sort();
}

function toGrant(g: z.infer<typeof grantSchema>): CompiledBindingGrant {
  return {
    bindingType: g.bindingType,
    names: g.names,
    approvalRef: g.approvalRef,
    approver: g.approver,
    expiresAt: g.expiresAt,
    ...(g.expired === undefined ? {} : { expired: g.expired }),
    ...(g.standingAuthorization === undefined
      ? {}
      : {
          standingAuthorization:
            typeof g.standingAuthorization === 'string'
              ? g.standingAuthorization
              : {
                  ref: g.standingAuthorization.ref,
                  status: g.standingAuthorization.status,
                  approver: g.standingAuthorization.approver,
                  expiresAt: g.standingAuthorization.expiresAt,
                  effective: g.standingAuthorization.effective,
                },
        }),
  };
}

/** Load and cross-check the discovery artefacts, or throw `SurfaceArtefactsUnavailable`. */
export function loadSurfaceArtefacts(
  repoRoot: string,
  catalogue: RuntimeCatalogue,
): SurfaceArtefacts {
  const problems: string[] = [];
  const toolIds = new Set(catalogue.toolIds);

  // --- the index ---------------------------------------------------------
  let index: CatalogueIndex | undefined;
  try {
    index = loadCatalogueIndex(repoRoot);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  if (index !== undefined) {
    const indexed = new Set(index.tools.map((t) => t.id));
    for (const id of toolIds) {
      if (!indexed.has(id)) {
        problems.push(
          `generated/index/catalogue-index.json has no entry for ${id}; run forge codegen`,
        );
      }
    }
    for (const id of indexed) {
      if (!toolIds.has(id)) {
        problems.push(
          `generated/index/catalogue-index.json lists ${id}, which has no manifest; run forge codegen`,
        );
      }
    }
  }

  // --- the cards ---------------------------------------------------------
  const cards = new Map<string, MetaToolCard>();
  const cardDir = join(repoRoot, 'generated', 'cards');
  for (const name of jsonFiles(cardDir, '.json')) {
    const raw = readJson(join(cardDir, name), problems);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      if (raw !== undefined) problems.push(`generated/cards/${name}: not a JSON object`);
      continue;
    }
    const card = withoutProvenance(raw as Record<string, unknown>);
    const id = card['id'];
    if (typeof id !== 'string' || `${id}.json` !== name) {
      problems.push(`generated/cards/${name}: its id does not match its file name`);
    } else if (!toolIds.has(id)) {
      problems.push(`generated/cards/${name}: ${id} has no manifest; run forge codegen`);
    } else {
      cards.set(id, card);
    }
  }
  for (const id of toolIds) {
    if (!cards.has(id)) problems.push(`generated/cards/${id}.json is missing; run forge codegen`);
  }

  // --- roles -------------------------------------------------------------
  const roles = new Map<string, PolicyRoleView>();
  const coreTools = new Map<string, readonly string[]>();
  const roleDir = join(repoRoot, 'generated', 'roles');
  for (const name of jsonFiles(roleDir, '.scope.json')) {
    const raw = readJson(join(roleDir, name), problems);
    if (raw === undefined) continue;
    const parsed = roleSchema.safeParse(raw);
    if (!parsed.success) {
      problems.push(`generated/roles/${name}: ${parsed.error.issues[0]?.message ?? 'malformed'}`);
      continue;
    }
    const r = parsed.data;
    roles.set(
      r.roleId,
      Object.freeze({
        roleId: r.roleId,
        sensitivityCeiling: r.sensitivityCeiling,
        writeAllowed: r.writeAllowed,
        bindingGrants: Object.freeze(r.bindingGrants.map(toGrant)),
      }),
    );
    coreTools.set(r.roleId, Object.freeze([...r.coreTools]));
  }

  // --- consumers' own grants --------------------------------------------
  const consumerGrants = new Map<string, readonly CompiledBindingGrant[]>();
  const consumerDir = join(repoRoot, 'generated', 'consumers');
  for (const name of jsonFiles(consumerDir, '.authorization.json')) {
    const raw = readJson(join(consumerDir, name), problems);
    if (raw === undefined) continue;
    // `bindingGrants` is optional on a consumer record; an artefact without it
    // holds none. Present but malformed is refused.
    const doc = raw as Record<string, unknown>;
    const parsed = consumerSchema.safeParse({ bindingGrants: [], ...doc });
    if (!parsed.success) {
      problems.push(
        `generated/consumers/${name}: ${parsed.error.issues[0]?.message ?? 'malformed'}`,
      );
      continue;
    }
    consumerGrants.set(
      parsed.data.consumerId,
      Object.freeze(parsed.data.bindingGrants.map(toGrant)),
    );
  }

  if (problems.length > 0 || index === undefined) throw new SurfaceArtefactsUnavailable(problems);

  return {
    index,
    cardFor: (toolId) => cards.get(toolId) ?? null,
    roles,
    coreTools,
    // A consumer with no compiled artefact holds no session at all (W0-P15),
    // so an absent entry here can only mean "no grants of its own".
    consumerBindingGrantsFor: (consumerId) => consumerGrants.get(consumerId) ?? [],
  };
}
