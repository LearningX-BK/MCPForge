// A parallel-route slot must render `null` for any URL it doesn't intercept
// (Next.js App Router requirement) — otherwise `/catalog` alone (no
// `[toolId]`) would 404 on the `@modal` slot.
export default function Default() {
  return null;
}
