// MCPForge — W0-P23: the portal's own origin, for the OIDC redirect URI.
//
// `MCPFORGE_PORTAL_ORIGIN` wins when set (a deployment behind a proxy). Otherwise
// it is rebuilt from the request's `host`, with `http` only for loopback, the same
// rule the session cookie's `Secure` flag follows. `x-forwarded-*` are not
// trusted: a header the client can set must not choose where a provider sends a code.

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function portalOrigin(
  headers: Pick<Headers, 'get'>,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configured = env['MCPFORGE_PORTAL_ORIGIN'];
  if (configured !== undefined && configured.length > 0) return configured.replace(/\/+$/, '');
  const host = headers.get('host') ?? 'localhost:3000';
  return `${LOOPBACK.test(host) ? 'http' : 'https'}://${host}`;
}
