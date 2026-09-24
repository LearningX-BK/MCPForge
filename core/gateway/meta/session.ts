// MCPForge — the live session the four meta-tools share. W0-G4.
//
// `forge.activate` sets "this session's working scope" (02 §5.2). It mutates
// exactly one field — `ScopeContext.session.activation`, 02 §5.1's axis 3 —
// and rebuilds the surrounding contexts around it rather than writing through
// a readonly type. Every authority-bearing input (deployment, role scopes,
// consumer authorizations, probe status, flags) is carried across unchanged,
// so an activation cannot widen anything: `Activated` is a lens, and the other
// five predicates still run over whatever it selects.

import type { SessionActivation } from '../scope/index.js';
import type { MetaContext, MetaSession } from './types.js';

export function createMetaSession(initial: MetaContext): MetaSession {
  let current = initial;

  return {
    context: () => current,
    setActivation(activation: SessionActivation): void {
      const scope = current.policy.scope;
      current = {
        ...current,
        policy: {
          ...current.policy,
          scope: {
            ...scope,
            session: { ...scope.session, activation },
          },
        },
      };
    },
  };
}
