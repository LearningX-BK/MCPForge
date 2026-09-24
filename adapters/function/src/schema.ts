// MCPForge — compiling the GENERATED tool schema. 02 §3.5 requires inputs to be
// validated against the generated JSON Schema before dispatch, and CLAUDE.md §5
// requires compiled Ajv over that same generated schema — "never a second
// hand-written validator". This file is therefore the only validation code in
// this package: it compiles, it does not describe.

import { Ajv2020 } from 'ajv/dist/2020.js';
import * as ajvFormats from 'ajv-formats';
import type { CompiledSchemaValidator } from './types.js';

const addFormats =
  (ajvFormats as unknown as { default?: (a: Ajv2020) => void }).default ??
  (ajvFormats as unknown as (a: Ajv2020) => void);

/**
 * Compile `generated/tools/<id>/schema.json`. `allErrors` is on so
 * `INPUT_INVALID` can name every offending field at once rather than making an
 * agent iterate one error per call.
 */
export function compileGeneratedSchema(schema: unknown): CompiledSchemaValidator {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema as object) as unknown as CompiledSchemaValidator;
}
