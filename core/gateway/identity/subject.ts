// MCPForge — issuer-qualified subjects. W0-P23, W0-P4 §2.1 item 2 and §9 decision 1.
//
// "Two providers can mint the same `sub` for different people.
// `Principal.subject`, the only identity value written to audit, role mappings
// and idempotency keys (02 §4.4 item 3), must be unambiguous, so it becomes
// `<providerId>:<sub>`. The local provider already does this (`local:<uuid>`)."
// The owner decided (25 Sep 2026) that subjects are issuer-qualified FROM THE
// FIRST ROW WRITTEN, whether one provider is configured or several.
//
// This file is the one definition of that format. Everything that needs to
// know which provider a subject belongs to (the per-provider group mapping,
// the multi-provider router, `forge identity remap`) asks here rather than
// splitting strings itself.
//
// **Why the provider id is read from the subject, and never from a claim.**
// The subject is minted by the gateway's own verifier (the local issuer, or
// `OidcProvider` prefixing the provider id it was CONFIGURED with). A token
// cannot choose its own prefix: an OIDC token whose `sub` is `local:x` becomes
// `entra:local:x`, which is in the `entra` namespace, not the `local` one.

/**
 * A provider id: lower case, starts with a letter, at most 32 characters, no
 * colon. Deliberately a SUBSET of the prefix `forge validate`'s
 * `policy.approval-not-self-approved` accepts (`[a-z][a-z0-9._-]*`), so every
 * subject this gateway issues is one that rule recognises.
 */
export const PROVIDER_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** True for a string usable as a provider id. */
export function isProviderId(value: unknown): value is string {
  return typeof value === 'string' && PROVIDER_ID_RE.test(value);
}

/**
 * `<providerId>:<sub>`. Throws on a bad provider id or an empty `sub`: both are
 * programming or configuration errors, never something a caller recovers from
 * by trying a different spelling.
 */
export function qualifySubject(providerId: string, sub: string): string {
  if (!isProviderId(providerId)) {
    throw new Error(`"${providerId}" is not a provider id (${PROVIDER_ID_RE.source}).`);
  }
  if (sub.length === 0) throw new Error('A subject needs a non-empty provider-local id.');
  return `${providerId}:${sub}`;
}

/**
 * The provider id a subject is qualified with, or `null` when the subject is
 * not issuer-qualified. `null` is fail-closed everywhere it is used: an
 * unqualified subject belongs to no provider, so it holds no group grant.
 */
export function providerIdOfSubject(subject: string): string | null {
  const colon = subject.indexOf(':');
  if (colon <= 0 || colon === subject.length - 1) return null;
  const providerId = subject.slice(0, colon);
  return isProviderId(providerId) ? providerId : null;
}

/** True for an issuer-qualified subject, `<providerId>:<sub>`. */
export function isQualifiedSubject(subject: unknown): subject is string {
  return typeof subject === 'string' && providerIdOfSubject(subject) !== null;
}

/**
 * Groups qualified with the provider that asserted them: `<providerId>:<group>`.
 * The provider comes from the subject. An unqualified subject yields no groups.
 *
 * A group is a name in ITS provider's namespace (an Entra object id, an OCI IAM
 * group name, a local group), and two providers may use the same name for
 * different things. Comparing qualified strings is what keeps an Entra group
 * called `mcpforge-admins` from being the local one.
 */
export function qualifyGroups(subject: string, groups: readonly string[]): string[] {
  const providerId = providerIdOfSubject(subject);
  if (providerId === null) return [];
  return groups.map((g) => `${providerId}:${g}`);
}

/** True when any of the member's (qualified) groups is in `qualifiedGroups`. */
export function holdsQualifiedGroup(
  member: { readonly subject: string; readonly groups: readonly string[] },
  qualifiedGroups: readonly string[],
): boolean {
  return qualifyGroups(member.subject, member.groups).some((g) => qualifiedGroups.includes(g));
}
