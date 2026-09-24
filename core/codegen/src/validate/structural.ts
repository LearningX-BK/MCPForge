// MCPForge — the structural pass of `forge validate`. W0-B2.
//
// This does no independent schema work: the W0-B1 Ajv-compiled validators
// (`@mcpforge/codegen/schema`) are the sole source of structural truth —
// required fields, the id pattern, enum membership, the `apiVersion` gate.
// This module's only job is to run them and translate their output into
// MCPForge's `{ruleId, file, path, fix}` shape.

import { validateManifest } from '../schema/index.js';
import type { ManifestFile, ValidationFailure } from './types.js';

/**
 * Ajv's `message` text is stable per keyword across schema documents, so the
 * keyword is recoverable from it without reaching into Ajv's `ErrorObject`
 * (which `validateManifest` deliberately does not expose — see its own
 * scope note). This keeps the rule id stable and human-legible without a
 * second, competing validator.
 */
function classify(message: string): { ruleId: string; fix: string } {
  if (/must have required property/.test(message)) {
    return {
      ruleId: 'structural.required-field',
      fix: 'Add the missing field named in the message. See the manifest kind\'s schema in core/codegen/schema/*.schema.json for its required shape.',
    };
  }
  if (/must match pattern/.test(message)) {
    return {
      ruleId: 'structural.pattern',
      fix: 'Correct the value to match the required pattern (e.g. the {app}.{module}.{entity}.{verb} id shape, or a secretRef:// URI).',
    };
  }
  if (/must be equal to one of the allowed values/.test(message)) {
    return {
      ruleId: 'structural.enum-membership',
      fix: 'Use one of the allowed values for this field — see the schema\'s enum list.',
    };
  }
  if (/must NOT have additional properties/.test(message)) {
    return {
      ruleId: 'structural.unknown-field',
      fix: 'Remove the field not defined by this manifest kind\'s schema, or check for a typo in its name.',
    };
  }
  if (/must be equal to constant/.test(message)) {
    return {
      ruleId: 'structural.const',
      fix: 'Set the field to the single fixed value the schema requires.',
    };
  }
  if (/^must be (string|number|integer|boolean|object|array|null)/.test(message)) {
    return {
      ruleId: 'structural.type',
      fix: 'Change the value to the required type.',
    };
  }
  if (/must NOT have (fewer|more) than|must NOT have fewer|must NOT have more/.test(message)) {
    return {
      ruleId: 'structural.array-length',
      fix: 'Adjust the number of entries to satisfy the schema\'s minItems/maxItems.',
    };
  }
  if (/must match "?exactly one schema/.test(message) || /must match a schema in "?oneOf/.test(message)) {
    return {
      ruleId: 'structural.one-of',
      fix: 'Make the value match exactly one of the schema\'s alternative shapes (e.g. supply either `enum` or `enumRef`, never both).',
    };
  }
  return {
    ruleId: 'structural.schema',
    fix: 'Correct the field to satisfy the manifest kind\'s JSON Schema (core/codegen/schema/*.schema.json).',
  };
}

/** Run the structural (schema) pass on one loaded manifest file. */
export function structuralFailures(file: ManifestFile): ValidationFailure[] {
  if (file.parseError !== undefined) {
    return [
      {
        ruleId: 'structural.yaml-parse-error',
        file: file.file,
        path: '/',
        message: `This file is not valid YAML: ${file.parseError}`,
        fix: 'Fix the YAML syntax error and re-run forge validate.',
      },
    ];
  }

  const result = validateManifest(file.doc);
  if (result.ok) return [];

  return result.issues.map((issue) => {
    const { ruleId, fix } = classify(issue.message);
    return {
      ruleId,
      file: file.file,
      path: issue.path,
      message: issue.message,
      fix,
    };
  });
}

/**
 * The `kind`/`id` `validateManifest` was able to resolve for this document,
 * even when the document did not fully validate — a Role with an out-of-range
 * `budgetTokens` still IS a Role named `p2p` for referential-integrity
 * purposes (a Package naming it should not also get a "role not found").
 */
export function resolvedKindAndId(
  file: ManifestFile,
): { kind: 'Tool' | 'Server' | 'Role' | 'Package' | 'Consumer'; id: string } | null {
  if (file.parseError !== undefined) return null;
  const result = validateManifest(file.doc);
  const kind = result.kind;
  if (kind === null || kind === undefined) return null;
  const doc = file.doc as { id?: unknown } | null;
  const id = doc?.id;
  if (typeof id !== 'string' || id.length === 0) return null;
  return { kind, id };
}
