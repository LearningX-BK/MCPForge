// MCPForge — the `manifest-sha256` computer. W0-B4.
//
// The hash that appears in every generated file's provenance header (02
// §2.3) and, later, feeds the W0-B5 `contract-hash` (a hash of a *subset* of
// manifest fields — a different, narrower computation that task builds).
// This one is simple and total: the sha256 of the manifest's exact source
// bytes, as read from disk, so the header always names precisely the file
// content that produced the artefact next to it.

import { createHash } from 'node:crypto';

/**
 * Canonical sha256 of a manifest's raw source content, lower-case hex.
 * Deliberately hashes the literal file bytes (via the string passed in,
 * `utf8`-encoded) — no re-serialization, no key sorting, no normalisation.
 * Two byte-identical files always hash identically; two files that differ
 * only in comment text or key order still hash differently, because the
 * header's job is "this exact file produced this exact artefact", not
 * "this semantically-equivalent manifest produced this artefact".
 */
export function manifestSha256(sourceContent: string): string {
  return createHash('sha256').update(sourceContent, 'utf8').digest('hex');
}
