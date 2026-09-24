// MCPForge — the OS keychain backend. W0-N5, 02 §11.5 / 05 §4.3.1.
//
// 05 §4.3.1 names the three platforms exactly: "a key held in the OS keychain
// (DPAPI on Windows — which is where this builds — Keychain on macOS, libsecret
// on Linux), with an environment-variable key for CI only."
//
// WHY NO npm KEYCHAIN LIBRARY. CLAUDE.md §3.1 requires everything to build and
// run on one developer machine with no toolchain prerequisite — the same
// constraint that sent `W0-D2` to hash-wasm for Argon2id instead of a native
// Argon2 binding. Every maintained cross-platform keychain package is a native
// addon: `keytar` is deprecated and needs libsecret headers to build from
// source, and `@napi-rs/keyring` ships prebuilds but falls back to a Rust
// toolchain on any platform/libc combination without one. Neither is pure JS or
// WASM, because a keychain is by definition an OS API and there is nothing for
// WASM to bind to.
//
// So this reaches the OS through the tool the OS already ships, with no
// dependency at all:
//
//   Windows   advapi32 CredWrite/CredRead/CredDelete (Windows Credential
//             Manager) via PowerShell `Add-Type`, which compiles the P/Invoke
//             shim with the in-box Roslyn compiler — no Visual Studio, no
//             node-gyp. VERIFIED WORKING on the build machine.
//   macOS     `security add-generic-password` / `find-generic-password` /
//             `delete-generic-password` — in-box since forever.
//   Linux     `secret-tool store` / `lookup` / `clear` from libsecret-tools.
//
// SECRET VALUES NEVER APPEAR ON A COMMAND LINE. An argv is world-readable on
// every one of these platforms (`ps`, `wmic process get commandline`, /proc) —
// putting a credential there would defeat the entire point of a keychain. Every
// write pipes the value through STDIN and every read takes it from STDOUT. The
// only things on the command line are the item name (a `secretRef://`, safe by
// definition) and flags.
//
// AVAILABILITY IS PROVEN, NOT ASSUMED. `probe()` performs a real
// write→read→delete round trip on a throwaway item and compares the bytes. A
// backend that cannot round-trip reports itself unavailable, so the contract
// suite's `OsKeychainStore` leg SKIPS VISIBLY rather than passing vacuously —
// the `W0-D3` discipline where the Keycloak leg reports "not run here" instead
// of silently vanishing.

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { platform } from 'node:process';

/** The Credential Manager / Keychain / libsecret item name for a stored entry. */
export type KeychainItem = string;

export interface KeychainBackend {
  readonly kind: 'windows-credential-manager' | 'macos-keychain' | 'linux-libsecret' | 'env-var';
  /** Real write→read→delete round trip. Never throws; returns false when unusable. */
  probe(): Promise<boolean>;
  set(item: KeychainItem, value: string): Promise<void>;
  /** `undefined` when the item does not exist — absence is not an error. */
  get(item: KeychainItem): Promise<string | undefined>;
  delete(item: KeychainItem): Promise<void>;
}

export class KeychainError extends Error {
  override readonly name = 'KeychainError';
  readonly next: string;

  constructor(message: string, next: string) {
    super(message);
    this.next = next;
  }
}

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run a command with an argv array — never a shell string, so nothing here is
 * quote-injectable — piping `stdin` in and capturing stdout as raw bytes.
 */
function run(
  file: string,
  args: readonly string[],
  stdin?: string,
  encoding: BufferEncoding | 'buffer' = 'utf8',
): Promise<RunResult & { readonly stdoutBytes: Buffer }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      [...args],
      { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const out = Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout));
        const err = Buffer.isBuffer(stderr) ? stderr : Buffer.from(String(stderr));
        // A non-zero exit is a RESULT here, not a throw: "item not found" is a
        // normal outcome for every one of these tools.
        const code =
          error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === 'number'
            ? Number((error as unknown as { code: number }).code)
            : error
              ? 1
              : 0;
        if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(
            new KeychainError(
              `The keychain helper "${file}" is not installed.`,
              file === 'secret-tool'
                ? 'Install libsecret-tools (apt install libsecret-tools / dnf install libsecret) or use EncryptedFileStore with MCPFORGE_SECRETS_KEY.'
                : `Install or repair "${file}", or use EncryptedFileStore with MCPFORGE_SECRETS_KEY (02 §11.5).`,
            ),
          );
          return;
        }
        resolve({
          code,
          stdout: encoding === 'buffer' ? '' : out.toString(encoding),
          stdoutBytes: out,
          stderr: err.toString('utf8'),
        });
      },
    );
    if (child.stdin) {
      // Values go in HERE, never on argv.
      if (stdin !== undefined) child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

// ---------------------------------------------------------------------------
// Windows — advapi32 Cred* via PowerShell Add-Type
// ---------------------------------------------------------------------------

// The P/Invoke shim. Values cross as base64 over stdin/stdout so that no
// encoding, newline or code-page translation can corrupt a binary credential.
const WINDOWS_SHIM = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -Language CSharp -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class ForgeCred {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags; public uint Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
    public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredWriteW(ref CREDENTIAL c, uint f);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredReadW(string t, uint ty, uint f, out IntPtr c);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredDeleteW(string t, uint ty, uint f);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr b);
}
"@
$op = $env:FORGE_KC_OP
$target = $env:FORGE_KC_TARGET
if ($op -eq 'set') {
  $b64 = [Console]::In.ReadToEnd().Trim()
  $bytes = [Convert]::FromBase64String($b64)
  $p = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
  try {
    [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $p, $bytes.Length)
    $c = New-Object ForgeCred+CREDENTIAL
    $c.Type = 1; $c.TargetName = $target; $c.Persist = 2; $c.UserName = 'mcpforge'
    $c.CredentialBlobSize = $bytes.Length; $c.CredentialBlob = $p
    if (-not [ForgeCred]::CredWriteW([ref]$c, 0)) { throw "CredWriteW failed" }
  } finally {
    # Zero the full blob length explicitly before freeing. ZeroFreeGlobalAlloc*
    # stops at a NUL, which for binary credential bytes can leave the tail of
    # the value in the freed heap block.
    for ($i = 0; $i -lt $bytes.Length; $i++) { [Runtime.InteropServices.Marshal]::WriteByte($p, $i, 0) }
    [Runtime.InteropServices.Marshal]::FreeHGlobal($p)
  }
  Write-Output 'OK'
} elseif ($op -eq 'get') {
  $out = [IntPtr]::Zero
  if (-not [ForgeCred]::CredReadW($target, 1, 0, [ref]$out)) { Write-Output 'ABSENT'; exit 0 }
  try {
    $c = [Runtime.InteropServices.Marshal]::PtrToStructure($out, [Type][ForgeCred+CREDENTIAL])
    $b = New-Object byte[] $c.CredentialBlobSize
    [Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob, $b, 0, $c.CredentialBlobSize)
    Write-Output ('VALUE ' + [Convert]::ToBase64String($b))
  } finally { [ForgeCred]::CredFree($out) }
} elseif ($op -eq 'delete') {
  [void][ForgeCred]::CredDeleteW($target, 1, 0); Write-Output 'OK'
}
`;

function powershellArgs(): readonly string[] {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_SHIM];
}

async function windowsRun(
  op: 'set' | 'get' | 'delete',
  target: string,
  stdin?: string,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'powershell.exe',
      [...powershellArgs()],
      {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        // The op and the ITEM NAME travel as environment variables rather than
        // being interpolated into the script — no injection surface, and the
        // item name never has to be PowerShell-escaped. The VALUE still goes
        // over stdin; an env var is readable from the process table on Windows.
        env: { ...process.env, FORGE_KC_OP: op, FORGE_KC_TARGET: target },
      },
      (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(
            new KeychainError(
              'powershell.exe was not found on PATH.',
              'Windows Credential Manager access needs PowerShell. Use EncryptedFileStore with MCPFORGE_SECRETS_KEY instead (02 §11.5).',
            ),
          );
          return;
        }
        resolve({ code: error ? 1 : 0, stdout: String(stdout), stderr: String(stderr) });
      },
    );
    if (child.stdin) {
      if (stdin !== undefined) child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

const windowsBackend: KeychainBackend = {
  kind: 'windows-credential-manager',
  async set(item, value) {
    const b64 = Buffer.from(value, 'utf8').toString('base64');
    const r = await windowsRun('set', item, `${b64}\n`);
    if (r.code !== 0 || !r.stdout.includes('OK')) {
      throw new KeychainError(
        `Windows Credential Manager refused to store "${item}".`,
        'Check that the account running MCPForge has a user profile loaded (a bare service context has no credential store). Otherwise use EncryptedFileStore with MCPFORGE_SECRETS_KEY.',
      );
    }
  },
  async get(item) {
    const r = await windowsRun('get', item);
    if (r.code !== 0) return undefined;
    const line = r.stdout.split(/\r?\n/).find((l) => l.startsWith('VALUE ') || l === 'ABSENT');
    if (line === undefined || line === 'ABSENT') return undefined;
    return Buffer.from(line.slice('VALUE '.length).trim(), 'base64').toString('utf8');
  },
  async delete(item) {
    await windowsRun('delete', item);
  },
  probe: () => roundTrip(windowsBackend),
};

// ---------------------------------------------------------------------------
// macOS — /usr/bin/security
// ---------------------------------------------------------------------------

const MACOS_SERVICE = 'mcpforge';

const macosBackend: KeychainBackend = {
  kind: 'macos-keychain',
  async set(item, value) {
    // `-w` with NO argument makes `security` read the password from stdin —
    // which is the whole reason it is spelled this way. Passing the value as
    // `-w <value>` would put the credential in the process table.
    const r = await run(
      'security',
      ['add-generic-password', '-U', '-a', item, '-s', MACOS_SERVICE, '-w'],
      `${value}\n`,
    );
    if (r.code !== 0) {
      throw new KeychainError(
        // NO stderr HERE. This is the one code path that is holding the plaintext
        // value when it fails, and a helper's diagnostic output is not something
        // this module controls or can promise is value-free. The item name is a
        // secretRef:// and is safe; the tool's own chatter is not. (The read and
        // delete paths below never hold a value, so they may quote stderr.)
        `macOS Keychain refused to store "${item}" (security exited ${r.code}).`,
        'Unlock the login keychain (security unlock-keychain) and retry, or use EncryptedFileStore with MCPFORGE_SECRETS_KEY.',
      );
    }
  },
  async get(item) {
    const r = await run('security', [
      'find-generic-password',
      '-a',
      item,
      '-s',
      MACOS_SERVICE,
      '-w',
    ]);
    if (r.code !== 0) return undefined;
    return r.stdout.replace(/\r?\n$/, '');
  },
  async delete(item) {
    await run('security', ['delete-generic-password', '-a', item, '-s', MACOS_SERVICE]);
  },
  probe: () => roundTrip(macosBackend),
};

// ---------------------------------------------------------------------------
// Linux — secret-tool (libsecret)
// ---------------------------------------------------------------------------

const linuxBackend: KeychainBackend = {
  kind: 'linux-libsecret',
  async set(item, value) {
    // `secret-tool store` reads the secret from stdin by design.
    const r = await run(
      'secret-tool',
      ['store', '--label', `MCPForge ${item}`, 'service', 'mcpforge', 'item', item],
      `${value}\n`,
    );
    if (r.code !== 0) {
      throw new KeychainError(
        // No stderr — same reason as the macOS store path above: this is the
        // call that is holding the value when it fails.
        `libsecret refused to store "${item}" (secret-tool exited ${r.code}).`,
        'Ensure a running D-Bus session and an unlocked keyring (gnome-keyring / KWallet), or use EncryptedFileStore with MCPFORGE_SECRETS_KEY.',
      );
    }
  },
  async get(item) {
    const r = await run('secret-tool', ['lookup', 'service', 'mcpforge', 'item', item]);
    if (r.code !== 0 || r.stdout.length === 0) return undefined;
    return r.stdout.replace(/\r?\n$/, '');
  },
  async delete(item) {
    await run('secret-tool', ['clear', 'service', 'mcpforge', 'item', item]);
  },
  probe: () => roundTrip(linuxBackend),
};

// ---------------------------------------------------------------------------
// The round trip that decides "available"
// ---------------------------------------------------------------------------

/**
 * Write a random canary, read it back, compare, delete. Only an exact byte
 * match counts as available — a backend that stores nothing and returns
 * nothing fails here, which is the point: the contract suite must never pass
 * against a store that is quietly a no-op.
 */
async function roundTrip(backend: KeychainBackend): Promise<boolean> {
  const item = `mcpforge-probe-${randomBytes(8).toString('hex')}`;
  const canary = randomBytes(24).toString('base64url');
  try {
    await backend.set(item, canary);
    const read = await backend.get(item);
    return read === canary;
  } catch {
    return false;
  } finally {
    try {
      await backend.delete(item);
    } catch {
      // Best effort — a leftover probe item is untidy, not unsafe.
    }
  }
}

/** The backend for the current platform. Not yet probed — call `probe()`. */
export function osKeychainBackend(): KeychainBackend {
  switch (platform) {
    case 'win32':
      return windowsBackend;
    case 'darwin':
      return macosBackend;
    default:
      return linuxBackend;
  }
}

/**
 * 05 §4.3.1's "environment-variable key for CI only".
 *
 * This is NOT a general keychain — it holds exactly one value, the file-sealing
 * key, and only for `EncryptedFileStore`. It deliberately cannot store per-ref
 * secrets, so it can never become the backing store for `OsKeychainStore` and
 * quietly turn a keychain into an env var.
 */
export const CI_KEY_ENV_VAR = 'MCPFORGE_SECRETS_KEY';

export function envVarKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[CI_KEY_ENV_VAR];
  return value !== undefined && value.length > 0 ? value : undefined;
}
