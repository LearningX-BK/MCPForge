// MCPForge — the consumer registry module. W0-N1, 02 §11.2 / 05 §1.3.
//
// A Consumer is the software holding the session. Every call needs BOTH a
// registered consumer and a resolved human identity, and authorization is the
// INTERSECTION (CLAUDE.md #6). This module is the record model, the read-side
// registry, the lifecycle-as-change-proposal path and credential issuance.
// It resolves no human identity and stands in for none.
//
// Transport-boundary consumer authentication is W0-N2; the binding
// authorization stage 6e' is W0-N3; the real SecretStore is W0-N5.

export * from './types.js';
export * from './registry.js';
export * from './approval.js';
export * from './proposal.js';
export * from './lifecycle.js';
export * from './credential.js';
