// MCPForge — W0-J14 / W0-P3c: the starter a new Build draft opens with.
//
// Not a fixture: it is the template `/build/new` and Requests' `new` verdict
// hand a developer. It lived in `fixtures.ts` until W0-P3c, which moved it
// here so no page reaches a fixture through it.
//
// The binding type defaults to `rest` so the guided form opens in the
// unblocked review-path state: `plsql`/`function` force standard review, and
// the starter should not assert an elevated binding nobody chose.

import type { BuildDraft } from './types';

/** The minimal starter handed to "New draft". */
export const NEW_DRAFT_TEMPLATE_YAML = `apiVersion: mcpforge/v1
kind: Tool
id: app.module.entity.verb
version: 1.0.0
server: REPLACE_ME
title: REPLACE ME

purpose: REPLACE — what this tool does, verb-first, at most 14 words.
archetype: transactional
verb: get
entity: entity
app: app
module: module
functionalArea: REPLACE ME
sensitivity: internal
write: false

binding:
  type: rest
  technology: REPLACE ME
  ref: REPLACE_ME
  identity:
    carries: unverified
    probe: MCPFORGE_PROBE_WHOAMI
    onServiceAccount: block
    echoOn: never

input: []

output:
  summaryTemplate: "REPLACE ME"
  resultKeys: []

governance:
  reviewPath: standard
  owner: REPLACE ME
  steward: <named person, filled at intake>

eval:
  intentsFile: evals/REPLACE_ME/intents.yaml
  minIntents: 10
`;

/**
 * A fresh, unsaved draft. `branch` is empty: a real branch is assigned only
 * when `DraftEditor`'s Save draft calls `ChangeHost.saveDraft`, and the
 * returned `ChangeProposal` then replaces this placeholder in the editor.
 */
export function newBuildDraft(yaml: string = NEW_DRAFT_TEMPLATE_YAML, toolId?: string): BuildDraft {
  return {
    id: 'new',
    title: toolId === undefined ? 'New tool draft' : `Change ${toolId}`,
    branch: '',
    state: 'draft',
    toolId: toolId ?? 'app.module.entity.verb',
    yaml,
  };
}
