// MCPForge — compiling and applying `probe-report.schema.json`. W0-H4.
//
// Same convention W0-B1 set for the manifest schemas: the document is JSON
// Schema **Draft 2020-12**, lives beside the code as data (so `forge probe`,
// the portal and an external reviewer read it without a TypeScript build), and
// Ajv is the one compiler — never a second hand-written validator (CLAUDE.md §5).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import * as ajvFormats from 'ajv-formats';
import type { ProbeReport } from './types.js';

const addFormats = (ajvFormats as unknown as { default: (ajv: Ajv2020) => void }).default;

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema');
const SCHEMA_FILE = 'probe-report.schema.json';

export const PROBE_REPORT_SCHEMA_ID =
  'https://mcpforge.ltm/schema/mcpforge/v1/probe-report.schema.json';

export function probeReportSchema(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, SCHEMA_FILE), 'utf8')) as Record<string, unknown>;
}

function buildValidator(): ValidateFunction {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  addFormats(ajv);
  return ajv.compile(probeReportSchema());
}

// Compiled on first use, not on import. `core/cli`'s program wires every
// command eagerly, so an Ajv compile at module scope would be paid by every
// `forge` invocation — including the ones that never touch a probe report.
let compiled: ValidateFunction | null = null;
function validator(candidate: unknown): boolean {
  compiled ??= buildValidator();
  return compiled(candidate) === true;
}
function lastErrors(): readonly ErrorObject[] {
  return compiled?.errors ?? [];
}

export interface SchemaViolation {
  readonly path: string;
  readonly message: string;
}

export interface ProbeReportValidation {
  readonly valid: boolean;
  readonly violations: readonly SchemaViolation[];
}

function toViolation(e: ErrorObject): SchemaViolation {
  return {
    path: e.instancePath === '' ? '(root)' : e.instancePath,
    message: e.message ?? 'invalid',
  };
}

/** Validate any candidate — parsed JSON from disk included. */
export function validateProbeReport(candidate: unknown): ProbeReportValidation {
  const valid = validator(candidate);
  return {
    valid,
    violations: valid ? [] : lastErrors().map(toViolation),
  };
}

export class ProbeReportInvalid extends Error {
  constructor(public readonly violations: readonly SchemaViolation[]) {
    super(
      `probe-report.json failed schema validation:\n` +
        violations.map((v) => `  ${v.path}: ${v.message}`).join('\n'),
    );
    this.name = 'ProbeReportInvalid';
  }
}

/**
 * Validate and narrow. Throws rather than returning a partial report — a probe
 * report that does not match its schema is not a weaker report, it is an
 * artefact the gateway must not read (`ProbeStatusSource`'s fail-closed rule).
 */
export function assertProbeReport(candidate: unknown): ProbeReport {
  const { valid, violations } = validateProbeReport(candidate);
  if (!valid) throw new ProbeReportInvalid(violations);
  return candidate as ProbeReport;
}
