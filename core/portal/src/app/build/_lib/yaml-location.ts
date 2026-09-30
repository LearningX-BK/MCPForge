// MCPForge — W0-J14: map a JSON Pointer (the shape every `ValidationFailure`
// and `ManifestValidationIssue` in this codebase already carries — see
// `core/codegen/src/schema/index.ts`'s `ManifestValidationIssue.path` and
// `core/codegen/src/validate/types.ts`'s `ValidationFailure.path`) to a
// 1-based line number in the draft's YAML source text, for the CodeMirror
// gutter markers.
//
// This is new code (no existing JSON-Pointer -> YAML-line locator exists
// anywhere in the repo), kept deliberately small: it walks the `yaml`
// package's own parsed AST (the same library codegen already depends on,
// `core/codegen/package.json`) rather than re-parsing or guessing from text.
// A pointer segment that does not resolve (e.g. it names a field the draft
// does not have yet) falls back to line 1 — the diagnostic is still shown,
// just not pinpointed, which is better than dropping it silently.
import { Document, LineCounter, parseDocument, isMap, isSeq } from 'yaml';

export interface YamlLocation {
  /** 1-based line number. */
  readonly line: number;
}

/** `/a/b/0` -> `['a', 'b', '0']`. `/` or `''` -> `[]` (the document root). */
function pointerSegments(pointer: string): readonly string[] {
  if (pointer === '' || pointer === '/') return [];
  return pointer
    .replace(/^\//, '')
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/**
 * Locate one JSON Pointer inside YAML source text. Returns line 1 (the
 * document start) when the source fails to parse at all or the pointer's
 * first segment does not resolve — never throws.
 */
export function locateYamlPointer(yamlText: string, pointer: string): YamlLocation {
  const lineCounter = new LineCounter();
  let doc: Document.Parsed;
  try {
    doc = parseDocument(yamlText, { lineCounter, keepSourceTokens: true });
  } catch {
    return { line: 1 };
  }

  let node: unknown = doc.contents;
  let lastRange: readonly [number, number, number] | undefined = nodeRange(node);

  for (const segment of pointerSegments(pointer)) {
    if (isMap(node)) {
      const pair = node.items.find((p) => {
        const key = p.key as { value?: unknown } | null;
        const keyValue = key && typeof key === 'object' && 'value' in key ? key.value : key;
        return String(keyValue) === segment;
      });
      if (!pair) break;
      lastRange = nodeRange(pair.key) ?? lastRange;
      node = pair.value;
      lastRange = nodeRange(node) ?? lastRange;
    } else if (isSeq(node)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index) || index < 0 || index >= node.items.length) break;
      node = node.items[index];
      lastRange = nodeRange(node) ?? lastRange;
    } else {
      break;
    }
  }

  if (!lastRange) return { line: 1 };
  const pos = lineCounter.linePos(lastRange[0]);
  return { line: pos.line };
}

function nodeRange(node: unknown): readonly [number, number, number] | undefined {
  if (node !== null && typeof node === 'object' && 'range' in node) {
    const range = (node as { range?: unknown }).range;
    if (Array.isArray(range) && range.length === 3) {
      return range as [number, number, number];
    }
  }
  return undefined;
}
