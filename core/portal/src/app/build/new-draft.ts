// MCPForge — W0-J14 / W0-P3c: the starter a new Build draft opens with.
//
// Not a fixture: it is the template `/build/new` and Requests' `new` verdict
// hand a developer. It lived in `fixtures.ts` until W0-P3c, which moved it
// here so no page reaches a fixture through it.
//
// The binding type defaults to `rest` so the guided form opens in the
// unblocked review-path state: `plsql`/`function` force standard review, and
// the starter should not assert an elevated binding nobody chose.

import { scaffoldTool } from '@mcpforge/cli/commands/new-tool-scaffold';
import type { BuildDraft } from './types';

/**
 * The minimal starter handed to "New draft" — the CLI's scaffolder with default answers
 * (W0-Q6), so `forge new tool` and `/build/new` share ONE template.
 */
const starter = scaffoldTool();
if (!starter.ok) throw new Error(starter.message);
export const NEW_DRAFT_TEMPLATE_YAML: string = starter.yaml;

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
