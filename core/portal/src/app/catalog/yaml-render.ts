// MCPForge — W0-J13: a minimal, read-only YAML renderer for the manifest
// section of tool detail (03 §5.3 item 4: "Manifest YAML, syntax-highlighted,
// read-only").
//
// JUDGMENT CALL: no YAML/CodeMirror dependency is added here. `forge codegen`
// already round-trips the real YAML on disk; the portal has no file-system
// read of `manifests/**` at Wave 0 (same "no live wiring yet" seam as every
// other Catalog data source — see `types.ts`'s header), so this renders the
// in-memory `ToolManifest` object back to YAML-shaped text for legibility
// only. Schema-aware editing, inline `forge validate` diagnostics and a real
// syntax-highlighting editor are W0-J14's (Build's) job, explicitly named
// there ("CodeMirror 6 ... Monaco is explicitly rejected") — this function
// does not anticipate or duplicate that decision, it only renders.
function scalar(value: unknown): string {
  if (typeof value === 'string') {
    return /^[\w.@/-]+$/.test(value) && value.length > 0 ? value : JSON.stringify(value);
  }
  return String(value);
}

function render(value: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) return `${pad}null\n`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]\n`;
    return value
      .map((item) => {
        if (item !== null && typeof item === 'object') {
          const inner = render(item, indent + 1).replace(new RegExp(`^${'  '.repeat(indent + 1)}`), `${pad}- `);
          return inner;
        }
        return `${pad}- ${scalar(item)}\n`;
      })
      .join('');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return `${pad}{}\n`;
    return entries
      .map(([key, v]) => {
        if (v !== null && typeof v === 'object' && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0)) {
          return `${pad}${key}:\n${render(v, indent + 1)}`;
        }
        if (Array.isArray(v) && v.length === 0) return `${pad}${key}: []\n`;
        if (v !== null && typeof v === 'object') return `${pad}${key}: {}\n`;
        return `${pad}${key}: ${scalar(v)}\n`;
      })
      .join('');
  }
  return `${pad}${scalar(value)}\n`;
}

export function toYamlText(manifest: unknown): string {
  return render(manifest, 0);
}
