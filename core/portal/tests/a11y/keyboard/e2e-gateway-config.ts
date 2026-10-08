// Shared by playwright.config.ts and e2e-gateway.ts: one place for the port and
// the throwaway test humans. Test-only values; the gateway they point at is a
// disposable copy.
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const E2E_GATEWAY_PORT = 3947;
/** Ids the harness seeded, for specs that need to open a specific record. */
export const E2E_IDS_FILE = join(tmpdir(), 'mcpforge-e2e-ids.json');
export const E2E_PASSWORD = 'a-long-enough-e2e-password-1';
export const E2E_SECRETS_PASSPHRASE = 'w0-j21-e2e-only-sealing-passphrase';
export const E2E_VIEWER = { username: 'e2e-viewer', subject: 'local:e2e-viewer' } as const;
export const E2E_REQUESTER = { username: 'e2e-requester', subject: 'local:e2e-requester' } as const;
