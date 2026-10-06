// MCPForge — W0-Q5: the intake form's seam to the ChangeHost.
//
// Plain glue, like `default-host.ts`: it lives inside `lib/change-host/` so the
// route above it never imports the implementation module by name
// (`vocabulary.test.tsx`, 02 §10.1 item 1). The server action stamps
// `requestedBy` from the signed-in viewer; nothing here supplies it.
export { changeHostSubmitRequest as submitRequest } from './local-git-actions';
