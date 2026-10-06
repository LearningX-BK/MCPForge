// MCPForge — W0-Q5b: `forge validate` rules for the `Request` artefact,
// `requests/<id>.request.yaml` (docs/build-plan/w0-q4-intake-requests.md §1, §7
// step 1).
//
//   request.shape          — the file parses and matches `requestSchema`
//                            (core/shared/src/request — the SAME zod schema the
//                            portal parses with; there is no second definition)
//   request.unknown-field  — a key the schema does not declare (zod would strip
//                            it silently, so the portal would never show it)
//   request.file-name      — the file sits at exactly requests/<id>.request.yaml
//   request.requested-by   — requestedBy is present and non-blank (never
//                            defaulted, non-negotiable 1)
//   request.secret-content — no secret value, no secretRef://, no credential-
//                            named key, anywhere in the file (non-negotiable 8)
//   request.calls-field    — no `calls` field anywhere (CLAUDE.md §4)
//   request.duplicate-id   — request ids are unique
//   request.tool-id        — every referenced tool id follows the CLOSED
//                            {app}.{module}.{entity}.{verb} convention (§5)
//   request.stored-state   — only `declined`/`withdrawn` may be stored; every
//                            other state is derived (note §1, §3, D3)
//
// A request grants nothing, so there is deliberately no grant/approval policy
// here (note §7 step 1). The duplicate-detection gate is G4 M1 (01 §2), a Wave 1
// gate over `verdictAtSubmit`, and is NOT implemented by these rules.
//
// Like the manifest policy rules (./helpers.ts), every rule except
// `request.shape`/`request.unknown-field` reads the RAW parsed document, so a
// file that also fails the schema still gets its policy verdict: a secret in a
// malformed request is still reported as a secret.
//
// Requests are loaded by their own loader (`loadRequestFiles`), never through
// `loadManifestFiles`, so no existing caller of that function sees a new kind.

import { TOOL_ID_PATTERN, VERBS } from '@mcpforge/shared/manifest';
import { STORED_REQUEST_STATES, requestSchema } from '@mcpforge/shared/request';
import { loadRequestFiles } from '../validate/loader.js';
import type {
  ManifestFile,
  RepoContext,
  ValidationFailure,
  ValidationRule,
} from '../validate/types.js';
import { fail, isRecord } from './helpers.js';

const SHAPE_DOC =
  'core/shared/src/request/index.ts (requestSchema) and docs/build-plan/w0-q4-intake-requests.md §1';
const VIA_CHANGE =
  'Edit the file through a change proposal (the portal writes git, never main directly)';

/** One load per validate run, shared by every request rule. */
const cache = new WeakMap<RepoContext, readonly ManifestFile[]>();
function requestFiles(ctx: RepoContext): readonly ManifestFile[] {
  let files = cache.get(ctx);
  if (files === undefined) {
    files = loadRequestFiles(ctx.repoRoot);
    cache.set(ctx, files);
  }
  return files;
}

function pointerSegment(key: string | number): string {
  return String(key).replace(/~/g, '~0').replace(/\//g, '~1');
}

function docOf(f: ManifestFile): Record<string, unknown> | undefined {
  return isRecord(f.doc) ? f.doc : undefined;
}

// --- request.shape -----------------------------------------------------------

const requestShape: ValidationRule = {
  id: 'request.shape',
  check(ctx) {
    const out: ValidationFailure[] = [];
    for (const f of requestFiles(ctx)) {
      if (f.parseError !== undefined) {
        out.push(
          fail(
            this.id,
            f.file,
            '',
            `${f.file} is not valid YAML: ${f.parseError}`,
            `Fix the YAML syntax in ${f.file}. ${VIA_CHANGE}; the expected shape is in ${SHAPE_DOC}.`,
          ),
        );
        continue;
      }
      const r = requestSchema.safeParse(f.doc);
      if (r.success) continue;
      for (const issue of r.error.issues) {
        const path = issue.path.map((p) => `/${pointerSegment(p)}`).join('');
        out.push(
          fail(
            this.id,
            f.file,
            path,
            `${f.file} is not a valid Request at ${path || '/'}: ${issue.message}.`,
            `Correct ${path || 'the document'} in ${f.file} to the Request shape in ${SHAPE_DOC}. ${VIA_CHANGE}.`,
          ),
        );
      }
    }
    return out;
  },
};

// --- request.unknown-field ---------------------------------------------------

/** Keys reported by a dedicated rule with a more specific fix. */
const DEDICATED_KEYS = new Set(['calls']);
const STORED_STATE_KEYS = new Set(['status', 'state', 'derivedState', 'lifecycle', 'stage']);

/** Keys present in `raw` but absent from zod's parsed (stripped) output. */
function strippedKeys(raw: unknown, parsed: unknown, pointer: string, out: string[]): void {
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    raw.forEach((item, i) => strippedKeys(item, parsed[i], `${pointer}/${i}`, out));
    return;
  }
  if (!isRecord(raw) || !isRecord(parsed)) return;
  for (const [key, value] of Object.entries(raw)) {
    const child = `${pointer}/${pointerSegment(key)}`;
    if (!(key in parsed)) {
      if (DEDICATED_KEYS.has(key)) continue;
      if (pointer === '' && STORED_STATE_KEYS.has(key)) continue;
      out.push(child);
      continue;
    }
    strippedKeys(value, parsed[key], child, out);
  }
}

const requestUnknownField: ValidationRule = {
  id: 'request.unknown-field',
  check(ctx) {
    const out: ValidationFailure[] = [];
    for (const f of requestFiles(ctx)) {
      const r = requestSchema.safeParse(f.doc);
      if (!r.success) continue; // request.shape already fails it, closed.
      const pointers: string[] = [];
      strippedKeys(f.doc, r.data, '', pointers);
      for (const pointer of pointers) {
        out.push(
          fail(
            this.id,
            f.file,
            pointer,
            `${pointer} is not a field of a Request. The portal parses requests with the same schema and would silently drop it, so the file says something nobody sees.`,
            `Delete ${pointer} from ${f.file}, or move its content into a declared field (business.does, governance.*) — see ${SHAPE_DOC}. A new field is a schema change and needs its own decision.`,
          ),
        );
      }
    }
    return out;
  },
};

// --- request.file-name -------------------------------------------------------

const requestFileName: ValidationRule = {
  id: 'request.file-name',
  check(ctx) {
    const out: ValidationFailure[] = [];
    for (const f of requestFiles(ctx)) {
      if (f.parseError !== undefined) continue; // request.shape reports it.
      const id = docOf(f)?.['id'];
      if (typeof id !== 'string' || id.length === 0) {
        out.push(
          fail(
            this.id,
            f.file,
            '/id',
            `${f.file} has no string id, so its file name cannot be checked against it.`,
            `Set id: req-<YYYYMMDD>-<slug> in ${f.file} and name the file requests/<id>.request.yaml. ${VIA_CHANGE}.`,
          ),
        );
        continue;
      }
      const expected = `requests/${id}.request.yaml`;
      if (f.file !== expected) {
        out.push(
          fail(
            this.id,
            f.file,
            '/id',
            `${f.file} declares id "${id}" but a request must live at exactly ${expected} (the portal reads that path, and the id is immutable).`,
            `Rename ${f.file} to ${expected} (flat under requests/, no subdirectory). Do NOT change the id to match the file name if the request was already submitted: request ids are immutable.`,
          ),
        );
      }
    }
    return out;
  },
};

// --- request.requested-by ----------------------------------------------------

const requestRequestedBy: ValidationRule = {
  id: 'request.requested-by',
  check(ctx) {
    const out: ValidationFailure[] = [];
    for (const f of requestFiles(ctx)) {
      const doc = docOf(f);
      if (doc === undefined) continue; // request.shape reports a non-object.
      const by = doc['requestedBy'];
      if (typeof by === 'string' && by.trim().length > 0) continue;
      out.push(
        fail(
          this.id,
          f.file,
          '/requestedBy',
          `${f.file} has no requestedBy. A request must name the human who filed it (Principal.subject); it is never defaulted or inferred (non-negotiable 1).`,
          `Submit the request from the portal's /requests page signed in as the requester (the server stamps requestedBy), or set requestedBy to the requester's Principal.subject. ${VIA_CHANGE}.`,
        ),
      );
    }
    return out;
  },
};

// --- request.secret-content --------------------------------------------------

/** Key names that only ever hold a credential. Compared lower-case with `_`/`-` removed. */
const SECRET_KEY_NAMES = new Set([
  'password',
  'passwd',
  'pwd',
  'secret',
  'clientsecret',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'apikey',
  'key',
  'privatekey',
  'credential',
  'credentials',
  'credentialref',
  'secretref',
  'bearer',
  'authorization',
  'cookie',
]);

const SECRET_REF = /secretref:\/\//i;
const PEM_HEADER = /-----BEGIN [A-Z0-9 ]+-----/;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./;
const URL_USERINFO = /[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i;
const VENDOR_TOKEN =
  /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,})/;
/** Same alphabet, length and entropy threshold as the overlay-purity content scan. */
const HIGH_ENTROPY_CANDIDATE = /[A-Za-z0-9+/=]{32,}/g;

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Why a string looks like credential material, or undefined. Never echoes the value. */
function secretReason(value: string): string | undefined {
  if (SECRET_REF.test(value)) return 'contains a secretRef:// reference';
  if (PEM_HEADER.test(value)) return 'contains a PEM header (key or certificate material)';
  if (JWT.test(value)) return 'contains what looks like a JWT';
  if (URL_USERINFO.test(value)) return 'contains a URL with embedded credentials';
  if (VENDOR_TOKEN.test(value)) return 'contains what looks like a vendor API token';
  for (const m of value.matchAll(HIGH_ENTROPY_CANDIDATE)) {
    if (shannonEntropy(m[0]) > 4.0) {
      return `contains a high-entropy string (${m[0].length} chars) that looks like a credential`;
    }
  }
  return undefined;
}

function findSecrets(
  node: unknown,
  pointer: string,
  out: { pointer: string; reason: string }[],
): void {
  if (typeof node === 'string') {
    const reason = secretReason(node);
    if (reason !== undefined) out.push({ pointer, reason });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => findSecrets(item, `${pointer}/${i}`, out));
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const child = `${pointer}/${pointerSegment(key)}`;
    if (SECRET_KEY_NAMES.has(key.toLowerCase().replace(/[_-]/g, ''))) {
      out.push({ pointer: child, reason: `has a credential-named key "${key}"` });
    } else {
      const keyReason = secretReason(key);
      if (keyReason !== undefined) out.push({ pointer: child, reason: `key ${keyReason}` });
    }
    findSecrets(value, child, out);
  }
}

const requestSecretContent: ValidationRule = {
  id: 'request.secret-content',
  check(ctx) {
    const out: ValidationFailure[] = [];
    for (const f of requestFiles(ctx)) {
      const hits: { pointer: string; reason: string }[] = [];
      findSecrets(f.doc, '', hits);
      for (const hit of hits) {
        out.push(
          fail(
            this.id,
            f.file,
            hit.pointer,
            `${hit.pointer || '/'} ${hit.reason}. A request never carries a credential or a credential reference: it grants nothing and binds nothing, and no secret value may appear in git (non-negotiable 8).`,
            `Remove it from ${f.file} through a change proposal. If it was a real credential, treat it as leaked (it is in git history): rotate it at its source, or run forge secrets revoke <ref> --reason "…" for a managed one. Describe the access need in words in business.does instead.`,
          ),
        );
      }
    }
    return out;
  },
};

// --- request.calls-field -----------------------------------------------------

function findCallsKeys(node: unknown, pointer: string, out: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => findCallsKeys(item, `${pointer}/${i}`, out));
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const child = `${pointer}/${pointerSegment(key)}`;
    if (key === 'calls') out.push(child);
    findCallsKeys(value, child, out);
  }
}

const requestCallsField: ValidationRule = {
  id: 'request.calls-field',
  check(ctx) {
    const out: ValidationFailure[] = [];
    for (const f of requestFiles(ctx)) {
      const pointers: string[] = [];
      findCallsKeys(f.doc, '', pointers);
      for (const pointer of pointers) {
        out.push(
          fail(
            this.id,
            f.file,
            pointer,
            'A "calls" field is present. `calls` is the concept console\'s illustrative demo data; real consumption is counted by the gateway from audit rows (02 §2.7), and a request has no consumption at all.',
            `Delete the "calls" field from ${f.file}. If the request was drafted from a seed/ entry, drop calls, agentName and agentPlatform: seed entries are authoring input, not records.`,
          ),
        );
      }
    }
    return out;
  },
};

// --- request.duplicate-id ----------------------------------------------------

const requestDuplicateId: ValidationRule = {
  id: 'request.duplicate-id',
  check(ctx) {
    const byId = new Map<string, string[]>();
    for (const f of requestFiles(ctx)) {
      const id = docOf(f)?.['id'];
      if (typeof id !== 'string' || id.length === 0) continue;
      byId.set(id, [...(byId.get(id) ?? []), f.file]);
    }
    const out: ValidationFailure[] = [];
    for (const [id, files] of byId) {
      if (files.length < 2) continue;
      for (const file of files) {
        const others = files.filter((x) => x !== file).join(', ');
        out.push(
          fail(
            this.id,
            file,
            '/id',
            `request id "${id}" is declared by more than one file (also ${others}). Request ids are unique and immutable; derived state joins on them.`,
            `Keep the file at requests/${id}.request.yaml and give the other request a new id (req-<YYYYMMDD>-<slug>), or delete the copy. A withdrawn request's id is never reused.`,
          ),
        );
      }
    }
    return out;
  },
};

// --- request.tool-id ---------------------------------------------------------

function toolIdRefs(doc: Record<string, unknown>): { pointer: string; value: unknown }[] {
  const refs: { pointer: string; value: unknown }[] = [];
  const governance = doc['governance'];
  if (isRecord(governance) && 'intendedToolId' in governance) {
    refs.push({ pointer: '/governance/intendedToolId', value: governance['intendedToolId'] });
  }
  const verdict = doc['verdictAtSubmit'];
  if (isRecord(verdict)) {
    const matches = verdict['matches'];
    if (Array.isArray(matches)) {
      matches.forEach((m, i) => {
        if (isRecord(m) && 'toolId' in m) {
          refs.push({ pointer: `/verdictAtSubmit/matches/${i}/toolId`, value: m['toolId'] });
        }
      });
    }
    const decision = verdict['decision'];
    if (isRecord(decision) && 'into' in decision) {
      refs.push({ pointer: '/verdictAtSubmit/decision/into', value: decision['into'] });
    }
  }
  return refs;
}

const requestToolId: ValidationRule = {
  id: 'request.tool-id',
  check(ctx) {
    const out: ValidationFailure[] = [];
    for (const f of requestFiles(ctx)) {
      const doc = docOf(f);
      if (doc === undefined) continue;
      for (const ref of toolIdRefs(doc)) {
        if (typeof ref.value === 'string' && TOOL_ID_PATTERN.test(ref.value)) continue;
        out.push(
          fail(
            this.id,
            f.file,
            ref.pointer,
            `${ref.pointer} is ${JSON.stringify(ref.value)}, not a well-formed tool id. Tool ids are {app}.{module}.{entity}.{verb}, lower snake, with the verb from the closed list (CLAUDE.md §5).`,
            `Set ${ref.pointer} to a tool id ending in one of: ${VERBS.join(', ')} — e.g. jde.ap.voucher.search. Put a qualifier in the entity segment, never the verb (jde.ap.voucher_by_amount.search, not jde.ap.voucher.search_by_amount). ${VIA_CHANGE}.`,
          ),
        );
      }
    }
    return out;
  },
};

// --- request.stored-state ----------------------------------------------------

const requestStoredState: ValidationRule = {
  id: 'request.stored-state',
  check(ctx) {
    const out: ValidationFailure[] = [];
    for (const f of requestFiles(ctx)) {
      const doc = docOf(f);
      if (doc === undefined) continue;
      for (const key of Object.keys(doc)) {
        if (!STORED_STATE_KEYS.has(key)) continue;
        out.push(
          fail(
            this.id,
            f.file,
            `/${pointerSegment(key)}`,
            `${f.file} stores a lifecycle state in "${key}". Request status is DERIVED from the change proposal, manifest, approval, index and probe report; storing it a second time lets the two disagree (w0-q4 note §1, §3).`,
            `Delete "${key}" from ${f.file}. To close a request, write closed: { state: declined | withdrawn, by, at, reason } — the only two states a request stores. ${VIA_CHANGE}.`,
          ),
        );
      }
      const closed = doc['closed'];
      if (closed === undefined) continue;
      const state = isRecord(closed) ? closed['state'] : undefined;
      if (
        typeof state === 'string' &&
        (STORED_REQUEST_STATES as readonly string[]).includes(state)
      ) {
        continue;
      }
      out.push(
        fail(
          this.id,
          f.file,
          '/closed/state',
          `closed.state is ${JSON.stringify(state)}. Only ${STORED_REQUEST_STATES.join(' and ')} may be stored; submitted, triaged, drafted, in_review, merged and enabled are derived (w0-q4 note §1, §3, D3).`,
          `Set closed.state to declined (triager, with a reason) or withdrawn (the original requester only), or delete the closed block and let the state be derived. ${VIA_CHANGE}.`,
        ),
      );
    }
    return out;
  },
};

export const REQUEST_RULES: readonly ValidationRule[] = [
  requestShape,
  requestUnknownField,
  requestFileName,
  requestRequestedBy,
  requestSecretContent,
  requestCallsField,
  requestDuplicateId,
  requestToolId,
  requestStoredState,
];
