# W0-Q10 — Harvest and Normalize: application surface → capability inventory: design note

**Status: DRAFT for the Wave 1 checkpoint. No code until it is reviewed there.** Wave 1 candidate.
Drafted 8 Oct 2026 on a Sonnet session although the task is routed to Opus (it fixes a file format and touches the intake path). Recommendations are proposals.

Reads: 01 §4 · 02 §2.7, §3 · `w0-q4-intake-requests.md` · `w0-q8-assisted-authoring.md` · CLAUDE.md §2, §3.1, §5, §8.

## 0. The problem, sized

`seed/` was a one-time manual extraction from the console, and the probe verifies bindings that already exist. Neither **discovers** what an application exposes. Roadmap Waves 1–5 add 139 tools to reach the 150-tool design target (01 §4.2, with W2's `plsql` and W3's ASF/OpenAPI harvest path named explicitly). At that scale, hand-authoring is the bottleneck, and the question the Wave 1 checkpoint has to answer is whether a harvester earns its keep before Wave 2 starts.

Two constraints from the settled architecture bound the design before any source is considered:

1. **A harvest result is not a manifest and grants nothing.** Same status as `seed/` entries and `requests/` (Q4 §1): authoring input. It never enters `manifests/` except through the human-reviewed `forge new tool` path.
2. **Harvest must not be able to widen anything.** Harvest never sets `identity.carries`, `write`, `sensitivity`, `binding.identity`, a role or a package. Those are human or probe acts (non-negotiables 2, 3, 4, 7).

## 1. (a) Sources, per application

Only read-only metadata endpoints. Harvest **calls no business operation** and needs no business credential.

| Application | Source | What it yields | Reliability | Wave |
|---|---|---|---|---|
| JD Edwards | AIS Orchestrator listing (`/jderest/v3/orchestrator` and the Orchestrator Studio export) | orchestration names, inputs and outputs, and the `_EXECUTE`/`_VALIDATE` pairing | High for shape, **but** the pair convention (HG2) is a naming convention to be checked, not trusted | W1 on (W0 is hand-authored and stays so) |
| Oracle EBS | Integration Repository (IREP) annotations and ISG service WSDL/REST | PL/SQL APIs, ISG services, parameters, `@rep:` lifecycle (`active`/`deprecated`) | Medium: IREP coverage is uneven and lifecycle tags are sometimes wrong | W2 |
| Fusion / SaaS | REST catalogue (`/describe`, OpenAPI per resource), OAC/FDI/OIC admin APIs | resources, verbs, field metadata | High; machine-readable OpenAPI | W1 |
| PeopleSoft | PS Query list; ASF and Component Interface metadata | queries (named, parameterised), CIs | PS Query high; CI/ASF medium | W2 / W3 |
| Siebel, Field Service, Hyperion, EPM | REST/Swagger where present; MaxL/LCM have **no catalogue** | partial | Low | W3–W4, hand-authored where nothing is harvestable |

**Credentials.** Harvest runs with a *harvest credential* per application, a `secretRef://harvest/<app>/<purpose>`. It is read-only in the target (a metadata-only role), scoped to one environment (non-negotiable 8(d)), and dereferenced only inside `adapters/**`. A harvest never runs under a human's identity because it reads no business data; it still records **who ran it** (the `Principal.subject` of the human who started it). There is no unattended harvest that has no named human.

**Not harvested:** anything that needs executing an operation to learn its shape; vendor servers' own `tools/list` for `wrapped-vendor` (that is a different, already-designed path, 02 §3.6); the concept console (CLAUDE.md §4).

## 2. (b) The inventory file format

One YAML file per application per run, written to `harvest/<app>/<runId>.inventory.yaml`, committed (a harvest is an input to a reviewable decision, and a diff between two runs is the "what changed in the application" signal). New top-level directory beside `seed/` and `requests/`. `forge validate` gains an `Inventory` kind; codegen never reads it.

```yaml
apiVersion: mcpforge/v1
kind: Inventory
runId: harvest-20261101-jde-prod-a
app: jde
source: { kind: ais-orchestrator, target: jde-dev, version: "9.2.8", fetchedAt: 2026-11-01T09:00:00Z }
ranBy: <Principal.subject>             # never defaulted
credentialRef: secretRef://harvest/jde/orchestrator-listing
contentSha: sha256:...                  # of the raw payload, so a re-run is comparable
operations:
  - opId: GL_JE_CREATE                  # the application's own name, immutable key
    raw: { kind: orchestration, inputs: [...], outputs: [...], lifecycle: active }
    pairedWith: GL_JE_CREATE_VALIDATE   # if detected
    normalized:                         # §3; absent if unmapped
      app: jde
      module: gl
      entity: journal
      verb: create                      # from the CLOSED 19-verb list, or absent
      confidence: high | medium | low
      reasons: ["name starts with GL_", "verb token CREATE"]
    status: candidate | unmapped | excluded | already-in-catalogue
    existingToolId: null                # filled when status is already-in-catalogue
```

- `raw` is stored verbatim and bounded (size cap) so normalisation can be re-run without re-harvesting.
- Raw payloads may contain customer-specific names. The inventory is therefore committed only in the **customer's** repo or an overlay-owned location if the content is not shareable; for the shared repo it stays a local, uncommitted artefact (open question D3).

## 3. (c) Normalization and the closed 19-verb list

Normalization maps an operation to `{app}.{module}.{entity}.{verb}`. It is **deterministic first, model-assisted second**, matching Q8's rule that a model suggests and never authors.

1. **Rule pass (deterministic, always on).** Token rules per application: strip application prefixes, split on `_`/camelCase, match a verb token against a synonym table that maps **into** the 19 verbs (`CREATE|ADD|INSERT|NEW → create`, `GET|FETCH|READ → get`, `QUERY|FIND|SEARCH|LOOKUP → search`, `LIST → list`, `CANCEL|VOID → cancel`, `APPROVE → approve`, `RELEASE|POST → release`, `RUN_*REPORT → run_report`, and so on). The table is a reviewed file in git.
2. **Model-suggested pass (optional, Q8 provider seam).** Only for operations the rules left `unmapped` or `low`. The model returns a *proposed* `entity` and `verb` as text. It goes through the same allow-list/gate discipline as Q8: shown beside the raw operation, accepted by a human, with provenance. Off by default; the feature works without it.
3. **Never decided by normalization:** `write`, `sensitivity`, `identity`, binding type. `raw` metadata gives *hints* (an HTTP `GET` is a read hint; a `_VALIDATE` pair is a write hint) that go in `reasons` and nothing else. A human sets them in the manifest.

**Operations that do not map to a verb are not forced.** This is the point of the closed list: widening it requires an explicit owner decision (CLAUDE.md §5). They land as `status: unmapped` with the raw operation and a `next` such as *"No closed verb fits. Either decompose it into allowed verbs, decline it, or ask the owner whether the verb list should widen."* The report counts them as the signal for that decision; it never invents a 20th verb.

Other statuses: `excluded` (deprecated lifecycle, internal, or explicitly declined, with a reason), `already-in-catalogue` (matched to a manifest by `binding.ref`).

## 4. (d) How candidates enter intake rather than bypass it

A candidate becomes a **Request** (Q4), not a manifest.

- `forge harvest promote <runId> <opId>…` (human action) writes `requests/req-<date>-<slug>.request.yaml` with `origin: harvest`, `harvestRef: {runId, opId}`, `requestedBy: <the human who ran promote>`, and the business half pre-filled from the inventory (`app`, `module`, guessed `access`, `inputs` names). The business questions that cannot be known from an API listing (*what a good answer looks like, who may run it*) are left blank for the requester or triager.
- It goes through the normal intake path: the **G4 M1 dedupe gate** (merge-or-justify against the real ranker), triage assigning owner, steward, sensitivity and server, and a human `forge new tool` run (W0-Q6) producing the manifest draft and a change proposal with an approval record. Nothing about harvest shortens review.
- Bulk is allowed, auto is not: `promote` caps one run to N candidates per invocation (suggest 25) so a reviewer is not handed 300 requests; each is a separate request artefact.
- Unmapped operations can be promoted too, as requests flagged `needsVerbDecision: true`, which routes them to the owner rather than pretending.

## 5. (e) Relation to the probe and to W0-Q8

| Neighbour | Relation |
|---|---|
| **Probe** (02 §4.5) | Complementary, different question. Harvest: *what exists?* Probe: *does the binding resolve and as whom?* A harvested `opId` becomes a tool's `binding.ref`; the probe then verifies it. Harvest **never writes `identity.carries`**; the probe alone writes `verified`. A re-harvest diff that shows an orchestration removed or changed signature feeds the probe's `refVersion` check as an early warning, not a replacement. |
| **W0-Q8** | Normalization step 2 reuses the `AuthoringModel` seam and its gate. Harvest adds no new provider or credential type except the harvest credential in §1. Q8 drafts text for fields; Q10 proposes a *name*. Same rule: suggestion with provenance, human accepts |
| **W0-Q4** | §4: Q10 is a new *origin* for requests, using the existing schema plus `origin` and `harvestRef` |
| **`seed/`** | Q10 is the repeatable successor to a one-time extraction. `seed/` stays as is |

## 6. What this note does not cover

- Building any harvester. This is a design note for the Wave 1 checkpoint.
- Auto-generating manifests. Explicitly rejected: the manifest is the sole source of truth and a human owns it.
- Wrapped-vendor `tools/list` ingestion.
- Customer-specific data inside inventories beyond the D3 question.

## 7. Decisions for the Wave 1 checkpoint

| # | Decision | Recommendation |
|---|---|---|
| D1 | Build a harvester in Wave 1 at all, or keep hand-authoring? | Build **one source first**: Fusion/OpenAPI (highest reliability, W1's `saas-fin`). Defer JDE and EBS sources until that proves the format |
| D2 | `harvest/` committed, or local-only? | Committed for catalogues that are Oracle-standard (Fusion REST); local-only (git-ignored) where operation names are customer-specific |
| D3 | The synonym table: owned by whom? | The module steward, reviewed like a role file |
| D4 | Do unmapped operations widen the verb list? | Not decided here; report the count after the first run and take it to the owner |
| D5 | Who funds the harvest credentials (a metadata-only role per application)? | Human-produced; I will not stub one (CLAUDE.md §8). Needs a named owner per application before any source is built |
