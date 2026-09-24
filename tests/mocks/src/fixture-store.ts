// MCPForge — W0-H6: the versioned, on-disk fixture format and its I/O.
//
// A "fixture set" is one JSON file under `fixtures/<setName>/<caseId>.json`,
// checked into git like any other test data. Its shape is deliberately target
// -agnostic (it does not know about AIS, HTTP, or JDE) so the same store can
// back a `function`-binding client today and a `database`/`plsql` recorder
// later without a format change — only the request/response payload shapes
// inside `requestKey`/`response` are target-specific, and those are opaque
// JSON as far as this file is concerned.
//
// A fixture is looked up by a REQUEST KEY: a caller-supplied string built
// deterministically from the request (see `keyFromAisRequest` in
// `ais-fixture-client.ts` for the `function`-binding instance of this). Two
// recordings can share a key with different responses — `sequence` lets a
// fixture reply differently on the 1st, 2nd, ... call with the same key,
// which is what lets a single fixture set cover a "call it twice" contract
// test without inventing two near-identical keys.

export interface FixtureResponse {
  readonly status: number;
  readonly body: string;
  readonly targetError?: { readonly message: string; readonly precondition?: boolean };
}

export interface FixtureCase {
  readonly requestKey: string;
  /**
   * One response per call to this key, in order. The last entry repeats for
   * any call beyond the recorded count — most fixtures have exactly one.
   */
  readonly sequence: readonly FixtureResponse[];
}

export interface FixtureSet {
  readonly $schema?: string;
  /** Name of the set — matches the containing directory, restated for humans grepping the file. */
  readonly name: string;
  /**
   * SYNTHETIC fixtures are hand-authored or generated, standing in for a real
   * target because no live JDE instance exists in this environment. `source`
   * makes that provenance explicit in every fixture file rather than leaving
   * it to be assumed. A fixture recorded by `refresh:fixtures` against a real
   * target is written with `source: "recorded"` and a `capturedAt` timestamp.
   */
  readonly source: 'synthetic' | 'recorded';
  readonly capturedAt?: string;
  readonly targetDescription: string;
  readonly cases: readonly FixtureCase[];
}

export const FIXTURE_SCHEMA_VERSION = 1;

/** Thrown when a replaying client is asked for a request key no fixture covers. */
export class FixtureMissError extends Error {
  constructor(
    readonly setName: string,
    readonly requestKey: string,
  ) {
    super(
      `No fixture case for key "${requestKey}" in fixture set "${setName}". ` +
        `Record it (see tests/mocks/scripts/refresh-fixtures.ts) or add a synthetic case by hand.`,
    );
    this.name = 'FixtureMissError';
  }
}

/** In-memory index over a `FixtureSet`, with per-key call counters for `sequence` playback. */
export class FixtureIndex {
  private readonly cases = new Map<string, FixtureCase>();
  private readonly callCounts = new Map<string, number>();

  constructor(readonly set: FixtureSet) {
    for (const c of set.cases) {
      if (this.cases.has(c.requestKey)) {
        throw new Error(
          `Fixture set "${set.name}" has a duplicate requestKey "${c.requestKey}" — each key must be unique within a set.`,
        );
      }
      this.cases.set(c.requestKey, c);
    }
  }

  /** Returns the next response for `requestKey`, advancing that key's call counter. Throws `FixtureMissError` if unknown. */
  next(requestKey: string): FixtureResponse {
    const found = this.cases.get(requestKey);
    if (found === undefined) throw new FixtureMissError(this.set.name, requestKey);
    const n = this.callCounts.get(requestKey) ?? 0;
    this.callCounts.set(requestKey, n + 1);
    const idx = Math.min(n, found.sequence.length - 1);
    const response = found.sequence[idx];
    if (response === undefined) {
      throw new Error(`Fixture case "${requestKey}" in set "${this.set.name}" has an empty sequence.`);
    }
    return response;
  }

  has(requestKey: string): boolean {
    return this.cases.has(requestKey);
  }

  callCountFor(requestKey: string): number {
    return this.callCounts.get(requestKey) ?? 0;
  }

  reset(): void {
    this.callCounts.clear();
  }
}
