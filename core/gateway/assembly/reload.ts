// MCPForge — W0-P33c. Gateway catalogue reload: swap in a new catalogue only if
// it loads cleanly. docs/build-plan/w0-p33-portal-merge.md §2.4, decision C
// ("Reload endpoint (Recommended)", owner, 30 Sep 2026).
//
// A DEFINITIONS GENERATION is everything the gateway derives from the
// definitions root (the VM's git clone, W0-P33a): the runtime catalogue, the
// session assembly (role scopes, packages, deployment, group mapping, consumer
// authorizations, the probe report), the served surface's discovery artefacts
// and the policy seams built over that catalogue. The launch assembly builds
// generation 1 at startup; a reload builds generation N+1 from disk, from
// scratch, with the same builders.
//
// THE RULE: all or nothing. The new generation is built completely, and
// checked, BEFORE anything served changes. Any failure (`forge validate`, a
// drifted or missing generated artefact, a malformed role scope, a broken
// mapping, a tool changed without a version bump) leaves the old generation
// serving, untouched, and the outcome says why, with each failure's own fix
// and an overall `next`.
//
// EVIDENCE BEFORE EFFECT. The caller's `record` (the audit append) runs with
// the outcome BEFORE the swap. If it throws, nothing is swapped: a reload the
// audit trail does not record does not happen. Only then does `commit` swap
// every served reference in one synchronous step, and `notify` tell live
// sessions (`notifications/tools/list_changed`).
//
// PLAN BINDING (§2.4 first bullet). A confirm token binds the tool VERSION it
// was minted for (`policy/confirm/token.ts`), so a plan minted before a change
// fails its confirm with PLAN_ARGUMENT_MISMATCH ("a different version of …")
// after it. That guarantee holds only if every change to a tool changes its
// version. CLAUDE.md §5 already requires that (patch = copy at least); this
// module makes it true rather than hoped for: a reload in which a tool's
// manifest bytes changed but its version did not is REFUSED, because swapping
// it in would let a plan the human read against the old manifest be confirmed
// against the new one. A tool removed by the change is not in the catalogue,
// so its confirm is refused before the write gate.
//
// Reloads are serialised: a second request waits for the first to finish and
// then loads from disk again, so two reloads never interleave their swaps.

import {
  CatalogueLoadRefused,
  type CatalogueLoadFailure,
  type RuntimeCatalogue,
} from './catalogue.js';
import { SessionAssemblyUnavailable } from './session.js';
import { SurfaceArtefactsUnavailable } from './surface-artefacts.js';

/** What every generation carries; the launch assembly adds its own parts. */
export interface DefinitionsGenerationBase {
  readonly catalogue: RuntimeCatalogue;
}

export interface ReloadSuccess {
  readonly ok: true;
  /** 1 at startup; +1 per successful reload. */
  readonly generation: number;
  readonly previousGeneration: number;
  readonly loadedAt: string;
  /** The catalogue that is (or, inside `record`, is about to be) serving. */
  readonly catalogue: RuntimeCatalogue;
  readonly toolCount: number;
  /** Tool ids, sorted. */
  readonly added: readonly string[];
  readonly removed: readonly string[];
  /** Tools present in both whose manifest changed (and whose version therefore changed). */
  readonly changed: readonly string[];
  readonly next: string;
}

export interface ReloadRefusal {
  readonly ok: false;
  /** The generation still serving. */
  readonly generation: number;
  readonly failures: readonly CatalogueLoadFailure[];
  readonly next: string;
}

export type ReloadOutcome = ReloadSuccess | ReloadRefusal;

export interface CatalogueReloader<G extends DefinitionsGenerationBase> {
  /** The generation serving now. */
  current(): G;
  /** Its number. */
  readonly generation: number;
  /**
   * Build, check, `record`, and only then swap. If `record` throws, nothing
   * is swapped and the error propagates.
   */
  reload<R>(record: (outcome: ReloadOutcome) => Promise<R>): Promise<{
    readonly outcome: ReloadOutcome;
    readonly recorded: R;
  }>;
}

export interface CatalogueReloaderOptions<G extends DefinitionsGenerationBase> {
  readonly initial: G;
  /**
   * Build a complete generation from the definitions root, throwing on any
   * problem. MUST NOT change anything served: it is called while the old
   * generation is still serving and its result may be thrown away.
   */
  build(): Promise<G>;
  /**
   * Swap `next` in. Called only after `build` succeeded, every check passed
   * and the outcome was recorded. Synchronous and assignment-only, so no
   * request can observe a half-swapped gateway.
   */
  commit(next: G, previous: G): void;
  /** After the swap: tell live sessions (`notifications/tools/list_changed`). */
  notify(next: G): Promise<void>;
  now?(): Date;
}

/**
 * A tool in both catalogues whose manifest bytes changed while its version did
 * not. Exported for the unit test; the reloader is the only production caller.
 */
export function unversionedChanges(
  previous: RuntimeCatalogue,
  incoming: RuntimeCatalogue,
): CatalogueLoadFailure[] {
  const out: CatalogueLoadFailure[] = [];
  for (const id of incoming.toolIds) {
    const before = previous.tools.get(id);
    const after = incoming.tools.get(id);
    if (before === undefined || after === undefined) continue;
    if (before.manifestSha256 === after.manifestSha256) continue;
    if (before.view.version !== after.view.version) continue;
    out.push({
      ruleId: 'reload.version-unchanged',
      file: after.manifestFile,
      message: `${id} changed but is still version ${after.view.version}. A plan minted against the served ${id} binds that version, so swapping this in would let it be confirmed against a tool the human never read.`,
      fix: `Bump version in ${after.manifestFile} (patch for copy, minor for a new optional input or result key, major for anything that can break a caller; CLAUDE.md §5), run forge codegen, propose and merge that change, then reload again.`,
    });
  }
  return out;
}

/** Any build failure, as the refusal's list. Never loses the original reason. */
function failuresOf(error: unknown): CatalogueLoadFailure[] {
  if (error instanceof CatalogueLoadRefused) return [...error.failures];
  if (error instanceof SurfaceArtefactsUnavailable) {
    return error.problems.map((message) => ({
      ruleId: 'reload.surface-artefacts',
      file: 'generated/',
      message,
      fix: 'Run forge codegen on the definitions clone and commit the generated tree through a change proposal, then reload again.',
    }));
  }
  if (error instanceof SessionAssemblyUnavailable) {
    return error.problems.map((message) => ({
      ruleId: 'reload.session-artefacts',
      file: 'overlays/ or generated/',
      message,
      fix: 'Fix the named overlay or compiled artefact through a change proposal (run forge codegen for generated/), merge it, then reload again.',
    }));
  }
  return [
    {
      ruleId: 'reload.build',
      file: '(definitions root)',
      message: error instanceof Error ? error.message : String(error),
      fix: 'Run forge validate and forge codegen on the definitions clone to find the cause, fix it through a change proposal, then reload again.',
    },
  ];
}

function sortedDiff(a: readonly string[], b: ReadonlySet<string>): string[] {
  return a.filter((id) => !b.has(id));
}

export function createCatalogueReloader<G extends DefinitionsGenerationBase>(
  options: CatalogueReloaderOptions<G>,
): CatalogueReloader<G> {
  const now = options.now ?? (() => new Date());
  let current = options.initial;
  let generation = 1;
  let queue: Promise<unknown> = Promise.resolve();

  function refusal(stillServing: number, failures: CatalogueLoadFailure[]): ReloadRefusal {
    const first = failures[0];
    return {
      ok: false,
      generation: stillServing,
      failures,
      next: `Nothing changed: catalogue generation ${stillServing} is still serving. ${first === undefined ? 'Run forge validate on the definitions clone.' : first.fix}`,
    };
  }

  /** Build and check; decide the outcome. Changes nothing served. */
  async function attempt(
    previous: G,
    previousGeneration: number,
  ): Promise<
    | { readonly next: G; readonly outcome: ReloadSuccess }
    | { readonly next: undefined; readonly outcome: ReloadRefusal }
  > {
    let next: G;
    try {
      next = await options.build();
    } catch (error) {
      return { next: undefined, outcome: refusal(previousGeneration, failuresOf(error)) };
    }
    const unversioned = unversionedChanges(previous.catalogue, next.catalogue);
    if (unversioned.length > 0) {
      return { next: undefined, outcome: refusal(previousGeneration, unversioned) };
    }
    const nextCatalogue = next.catalogue;
    const before = new Set(previous.catalogue.toolIds);
    const after = new Set(nextCatalogue.toolIds);
    const added = sortedDiff(nextCatalogue.toolIds, before);
    const changed = nextCatalogue.toolIds.filter(
      (id) =>
        before.has(id) &&
        previous.catalogue.tools.get(id)?.manifestSha256 !==
          nextCatalogue.tools.get(id)?.manifestSha256,
    );
    const nextGeneration = previousGeneration + 1;
    return {
      next,
      outcome: {
        ok: true,
        generation: nextGeneration,
        previousGeneration,
        loadedAt: now().toISOString(),
        catalogue: nextCatalogue,
        toolCount: nextCatalogue.toolIds.length,
        added,
        removed: sortedDiff(previous.catalogue.toolIds, after),
        changed,
        next:
          added.length > 0 || changed.length > 0
            ? `Catalogue generation ${nextGeneration} is serving and every live session was sent tools/list_changed. A new or changed tool reads "Not probed" and cannot execute until a capability probe enables it: run forge probe for this deployment.`
            : `Catalogue generation ${nextGeneration} is serving and every live session was sent tools/list_changed. No tool was added or changed, so no probe is needed.`,
      },
    };
  }

  async function reloadOnce<R>(
    record: (outcome: ReloadOutcome) => Promise<R>,
  ): Promise<{ outcome: ReloadOutcome; recorded: R }> {
    const previous = current;
    const attempted = await attempt(previous, generation);

    // Evidence first. A throw here leaves the old generation serving.
    const recorded = await record(attempted.outcome);

    if (attempted.next !== undefined) {
      options.commit(attempted.next, previous);
      current = attempted.next;
      generation = attempted.outcome.generation;
      // The swap has happened; a session whose transport is gone is not a
      // reason to report it as anything else.
      await options.notify(attempted.next).catch(() => undefined);
    }
    return { outcome: attempted.outcome, recorded };
  }

  return {
    current: () => current,
    get generation() {
      return generation;
    },
    reload(record) {
      const run = queue.then(
        () => reloadOnce(record),
        () => reloadOnce(record),
      );
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
