// MCPForge — the mcpforge/v1 manifest JSON Schema, loaded and compiled.
//
// W0-B1. The schema documents themselves are JSON Schema **Draft 2020-12** and
// live beside this file at `core/codegen/schema/*.schema.json` — one document
// per kind plus a shared `common.schema.json` of `$defs`. They are data, not
// code, so they stay JSON: `forge validate`, the portal and any external
// reviewer can read them without a TypeScript build.
//
// This module is the runtime-validation counterpart of the type model in
// `@mcpforge/shared`'s `manifest/` — the two describe the same shape and must
// not drift. Ajv is the compiler here for the same reason CLAUDE.md §5 names it
// for tool arguments: one validator library, never a second hand-written one.
//
// SCOPE: STRUCTURE ONLY. Required fields, enum membership, the structural id
// pattern and the cross-field shapes that are unconditional. The ~40 policy and
// safety rules are W0-B3 (`core/codegen/rules/**`) and referential integrity
// across files is W0-B2. Nothing here reaches another file.

// Ajv ships CommonJS with `export =`-shaped typings; under NodeNext the named
// exports are the portable spelling for both the class and the formats plugin.
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import * as ajvFormats from 'ajv-formats';
import { API_VERSION, type ManifestKind } from '@mcpforge/shared/manifest';
// The schema documents are imported statically (JSON module, not
// `readFileSync`) so this module carries no `node:fs`/`node:path` dependency.
// `structural-check.ts` runs `validateManifest` CLIENT-SIDE in the portal's
// `/build` editor for live, per-keystroke diagnostics (W0-J14) — a
// filesystem read at call time would either fail in the browser or drag
// `node:fs` into the client bundle and crash the route, exactly like
// `core/gateway/store/dialect.ts` does for the native SQLite driver. A static
// JSON import is bundler- and Node-ESM-safe on both sides of that boundary.
import commonSchemaJson from '../../schema/common.schema.json' with { type: 'json' };
import toolSchemaJson from '../../schema/tool.schema.json' with { type: 'json' };
import serverSchemaJson from '../../schema/server.schema.json' with { type: 'json' };
import roleSchemaJson from '../../schema/role.schema.json' with { type: 'json' };
import packageSchemaJson from '../../schema/package.schema.json' with { type: 'json' };
import consumerSchemaJson from '../../schema/consumer.schema.json' with { type: 'json' };

const addFormats = (ajvFormats as unknown as { default: (ajv: Ajv2020) => void }).default;

const SCHEMA_DOCS = {
  Tool: toolSchemaJson,
  Server: serverSchemaJson,
  Role: roleSchemaJson,
  Package: packageSchemaJson,
  Consumer: consumerSchemaJson,
} as const satisfies Record<ManifestKind, Record<string, unknown>>;

export const MANIFEST_KINDS = Object.keys(SCHEMA_DOCS) as readonly ManifestKind[];

/** Draft 2020-12 — the modern standard, and the same draft 02 §2.3 names for the generated tool schemas. */
export const JSON_SCHEMA_DRAFT = 'https://json-schema.org/draft/2020-12/schema' as const;

/**
 * A fresh, deep copy every call — callers (Ajv's registration, the schema
 * tests) may read and, in the past, could rely on `readFileSync` handing back
 * an independent object each time. `structuredClone` keeps that contract now
 * that the source is one shared, statically-imported module object.
 */
function cloneSchema(doc: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(doc);
}

/** The raw schema document for one kind — for publishing, docs and tests. */
export function schemaFor(kind: ManifestKind): Record<string, unknown> {
  return cloneSchema(SCHEMA_DOCS[kind]);
}

/** The shared `$defs` document every kind refs. */
export function commonSchema(): Record<string, unknown> {
  return cloneSchema(commonSchemaJson);
}

function buildAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    strict: true,
    // Ajv's `strictRequired` is a style opinion, not a correctness one: it
    // objects to `if/then: {required: [x]}` unless the `then` also repeats a
    // `properties` entry for x. Conditional-required is exactly how "write:
    // true implies writeSafety" is expressed, so the opinion is declined.
    strictRequired: false,
    allErrors: true,
    // `$ref: "common.schema.json#/$defs/..."` resolves against each document's
    // `$id`, so the shared vocabulary is added once under its own `$id`.
    allowUnionTypes: true,
  });
  addFormats(ajv);
  ajv.addSchema(cloneSchema(commonSchemaJson));
  for (const doc of Object.values(SCHEMA_DOCS)) ajv.addSchema(cloneSchema(doc));
  return ajv;
}

const ajv = buildAjv();

const SCHEMA_FILE_NAMES = {
  Tool: 'tool.schema.json',
  Server: 'server.schema.json',
  Role: 'role.schema.json',
  Package: 'package.schema.json',
  Consumer: 'consumer.schema.json',
} as const satisfies Record<ManifestKind, string>;

const validators = new Map<ManifestKind, ValidateFunction>();
for (const kind of MANIFEST_KINDS) {
  const id = `https://mcpforge.ltm/schema/mcpforge/v1/${SCHEMA_FILE_NAMES[kind]}`;
  const validate = ajv.getSchema(id);
  /* c8 ignore next */
  if (!validate) throw new Error(`schema not registered: ${id}`);
  validators.set(kind, validate);
}

// --- results ------------------------------------------------------------------

export interface ManifestValidationIssue {
  /** JSON Pointer into the document, e.g. `/binding/identity/carries`. */
  readonly path: string;
  readonly message: string;
}

export type ManifestValidationResult =
  | { readonly ok: true; readonly kind: ManifestKind }
  | {
      readonly ok: false;
      readonly kind: ManifestKind | null;
      readonly issues: readonly ManifestValidationIssue[];
    };

function issue(path: string, message: string): ManifestValidationIssue {
  return { path, message };
}

function fromAjv(errors: readonly ErrorObject[] | null | undefined): ManifestValidationIssue[] {
  return (errors ?? []).map((e) =>
    issue(e.instancePath === '' ? '/' : e.instancePath, `${e.message ?? 'invalid'}`),
  );
}

// --- the apiVersion gate ------------------------------------------------------

/**
 * 02 §2.6: "Codegen refuses a manifest whose `apiVersion` it does not know,
 * naming the required migration — never a silent best-effort parse."
 *
 * A JSON Schema `const` would say only "must be equal to constant", which names
 * neither the offending value nor what to do about it. So the gate runs first,
 * by hand, and the schemas keep the `const` as well — belt and braces, and the
 * schema documents stay correct when read on their own.
 */
export function checkApiVersion(doc: unknown): ManifestValidationIssue | null {
  const value = (doc as { apiVersion?: unknown } | null)?.apiVersion;
  if (value === undefined) {
    return issue(
      '/apiVersion',
      `apiVersion is required on every manifest and must be "${API_VERSION}".`,
    );
  }
  if (value === API_VERSION) return null;
  return issue(
    '/apiVersion',
    `unknown apiVersion ${JSON.stringify(value)}: no migration path is defined for this apiVersion. ` +
      `This build understands "${API_VERSION}" only. Migrate the manifest to "${API_VERSION}" — ` +
      `a manifest is never best-effort parsed against a version it does not declare.`,
  );
}

// --- the entry point ----------------------------------------------------------

const KIND_SET = new Set<string>(MANIFEST_KINDS);

/**
 * Validate one parsed manifest document against the schema for its `kind`.
 * Dispatches on `kind` after the `apiVersion` gate, so a v2 document is refused
 * by name rather than measured against v1's shape.
 */
export function validateManifest(doc: unknown): ManifestValidationResult {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return {
      ok: false,
      kind: null,
      issues: [issue('/', 'a manifest must be a YAML/JSON object.')],
    };
  }

  const apiVersionIssue = checkApiVersion(doc);
  if (apiVersionIssue) return { ok: false, kind: null, issues: [apiVersionIssue] };

  const kind = (doc as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || !KIND_SET.has(kind)) {
    return {
      ok: false,
      kind: null,
      issues: [
        issue(
          '/kind',
          `unknown kind ${JSON.stringify(kind ?? null)}: expected one of ${MANIFEST_KINDS.join(', ')}.`,
        ),
      ],
    };
  }

  const validate = validators.get(kind as ManifestKind)!;
  const ok = validate(doc);
  return ok
    ? { ok: true, kind: kind as ManifestKind }
    : { ok: false, kind: kind as ManifestKind, issues: fromAjv(validate.errors) };
}
