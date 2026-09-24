// MCPForge — scope resolution (02 §4.2 step [4]). W0-E2.
//
// `visible(session)` as a six-way intersection of six independent, named,
// individually-testable predicates. The public surface is deliberately small:
// `resolveScope` for the visible set and `scopeRefusalError` for the refusal a
// caller gets when it names an unlisted tool id.
//
// `applyPredicates` is exported too, and only for the predicate-removal proof
// (./scope.predicates.test.ts). It has no production call site, and adding one
// would be the way this module's central claim quietly stops being true.

export * from './types.js';
export * from './sensitivity.js';
export * from './sources.js';
export * from './predicates.js';
export * from './resolve.js';
export * from './artefacts.js';
