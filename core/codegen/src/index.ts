// MCPForge — codegen. Manifests are the sole source of truth (02 §2.1).
// Wave 0, W0-B1: the mcpforge/v1 manifest JSON Schema and its compiled Ajv
// validator. The emit pipeline is W0-B4, the validate engine W0-B2, the ~40
// policy rules W0-B3.

export * from './schema/index.js';
export * from './validate/index.js';
