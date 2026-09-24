// MCPForge — Dynamic Client Registration, structurally absent. W0-N2.
// 02 §11.2, 05 §1.3.3, CLAUDE.md non-negotiable 6.
//
// > "Registration is admin-approved. Self-service registration and RFC 7591
// > Dynamic Client Registration are both disabled. Every other grant in this
// > architecture — a role, a package, a tool — is a reviewed git diff with an
// > approval record; a self-registering client would be the only grant in the
// > system nobody reviews, and it would decide which software may hold a
// > session at all." (02 §11.2)
//
// **Two obligations, and they are different obligations.**
//
// 1. **Absent from the published metadata.** Not "unrouted", not "returns an
//    error" — the `registration_endpoint` key does not appear in the document
//    at all. A client that reads one is entitled to believe the endpoint
//    works. `assertNoRegistrationEndpoint` below is a runtime guard on every
//    publish path, so the key cannot reappear through a future edit to a
//    metadata builder somewhere else in the tree.
//
// 2. **403, never 404.** "MCP clients commonly attempt DCR, and a silent 404
//    turns a governance decision into a debugging session" (05 §1.3.3). A 404
//    says *maybe you have the path wrong*; a 403 with an agent-actionable
//    `next` says *this does not exist here, by policy, and here is what to do
//    instead*. That is CLAUDE.md non-negotiable 5 applied to an HTTP status
//    code.

import { forgeError, type ForgeErrorShape } from '@mcpforge/shared/errors';

/**
 * The paths a spec-conforming client will try. All of them answer 403 — the
 * conventional RFC 7591 path, the OAuth-server-prefixed variants, and the
 * well-known-relative form.
 */
export const DYNAMIC_CLIENT_REGISTRATION_PATHS: readonly string[] = Object.freeze([
  '/register',
  '/oauth/register',
  '/oauth2/register',
  '/connect/register',
  '/.well-known/oauth-authorization-server/register',
]);

/** The metadata key that must never be published (RFC 8414 §2, RFC 9728). */
export const REGISTRATION_ENDPOINT_KEY = 'registration_endpoint';

export function isDynamicClientRegistrationPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '');
  return DYNAMIC_CLIENT_REGISTRATION_PATHS.includes(normalized === '' ? '/' : normalized);
}

/**
 * The refusal body. `CONSUMER_UNREGISTERED` is exactly the right code: the
 * caller is unregistered, and it has just asked to register itself, which is
 * the one route to a registration that does not exist here.
 */
export function dynamicClientRegistrationRefusal(correlationId: string): ForgeErrorShape {
  return forgeError(
    'CONSUMER_UNREGISTERED',
    'Dynamic Client Registration is not available on this gateway. A consumer registration is a reviewed git artefact with an approval record, not a self-service endpoint — this endpoint is absent by policy, which is why this is a 403 and not a 404.',
    correlationId,
    {
      condition:
        'The caller attempted RFC 7591 Dynamic Client Registration. MCPForge does not implement it: every grant in this system is a reviewed change with a named approver, and a self-registering client would be the only grant nobody reviews (02 §11.2).',
      next: "Register this client through the portal's Governance → Consumers registration flow, which raises a change proposal against `consumers/<id>.consumer.yaml` and produces an approval record. On a developer machine, `forge consumer new --id <id> --class <class>` scaffolds the same record. Ask your MCPForge operator to approve it, then connect with `forge connect --consumer <id>`.",
    },
  ).toJSON();
}

/** HTTP status for the DCR refusal. Fixed, and asserted by a test: 403, never 404. */
export const DYNAMIC_CLIENT_REGISTRATION_STATUS = 403;

/**
 * Guard every metadata document on its way out. Throws rather than filtering,
 * because a `registration_endpoint` appearing in a published document is a
 * governance failure, not a formatting one — silently deleting the key would
 * hide whichever builder started emitting it.
 */
export function assertNoRegistrationEndpoint<T extends object>(document: T): T {
  const offending = Object.keys(document).filter(
    (key) => key === REGISTRATION_ENDPOINT_KEY || key.endsWith('_registration_endpoint'),
  );
  if (offending.length > 0) {
    throw new Error(
      `MCPForge publishes no dynamic client registration endpoint (02 §11.2), but this metadata document carries: ${offending.join(', ')}. Remove it at the builder — registration is a reviewed git artefact, and advertising an endpoint for it makes the product's central governance claim false.`,
    );
  }
  return document;
}
