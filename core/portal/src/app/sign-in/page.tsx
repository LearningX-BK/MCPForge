// MCPForge — W0-P5b / W0-P23: `/sign-in` (W0-P4 §2).
//
// Signing in is optional for reading: every page renders for everyone,
// signed in or not (03 §2: persona "never hides a page"). It is needed for the
// acts that carry an identity (Save draft, Propose, Discard) and for the
// admin-only portal actions.
//
// W0-P23: the deployment may configure several providers at once. With one, the
// page is what it was; with more than one it offers a chooser. A local provider
// shows the credentials form, and each OIDC provider is a link that starts
// authorization code + PKCE at the provider (the portal never sees that password).

import { Button } from '@/components/ui/button';
import { safeReturnTo } from '@/lib/viewer/actions';
import { fetchProviders, ViewerAuthError, type PublicProvider } from '@/lib/viewer/gateway-auth';

import { SignInForm } from './sign-in-form';

interface Search {
  returnTo?: string | string[];
  error?: string | string[];
  next?: string | string[];
}

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

async function loadProviders(): Promise<{
  readonly providers: readonly PublicProvider[];
  readonly problem?: { readonly message: string; readonly next: string };
}> {
  try {
    return { providers: (await fetchProviders()).providers };
  } catch (error) {
    // The local form still works when the gateway is back; say why nothing else is offered.
    const problem =
      error instanceof ViewerAuthError
        ? { message: error.message, next: error.next }
        : {
            message: 'The portal could not read the sign-in providers.',
            next: 'Check the portal server log, then reload this page.',
          };
    return {
      providers: [{ id: 'local', kind: 'local', displayName: 'MCPForge account' }],
      problem,
    };
  }
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const returnTo = await safeReturnTo(first(search.returnTo));
  const { providers, problem } = await loadProviders();
  const local = providers.find((p) => p.kind === 'local');
  const oidc = providers.filter((p) => p.kind === 'oidc');
  const refusal =
    first(search.error) !== undefined
      ? { message: first(search.error)!, next: first(search.next) ?? 'Sign in again.' }
      : problem;
  const chooser = providers.length > 1;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-lg text-text-1">Sign in to MCPForge</h1>
        <p id="sign-in-help" className="text-[12.5px] text-text-2">
          The gateway checks who you are; the portal never holds a token in the browser. Signing in
          lets you save drafts, propose changes and use the actions your persona allows. Every page
          is readable without signing in.
        </p>
      </div>

      {refusal !== undefined && (
        <div
          role="alert"
          data-testid="sign-in-notice"
          className="rounded-lg border border-status-danger-border bg-status-danger-bg p-3"
        >
          <p className="text-[12.5px] font-semibold text-status-danger-strong">{refusal.message}</p>
          <p className="mt-1 text-[12px] text-text-1">{refusal.next}</p>
        </div>
      )}

      {oidc.length > 0 && (
        <section aria-labelledby="sign-in-providers" className="flex flex-col gap-2">
          {chooser && (
            <h2 id="sign-in-providers" className="text-[12.5px] font-semibold text-text-1">
              Choose how to sign in
            </h2>
          )}
          {oidc.map((p) => (
            <Button key={p.id} asChild variant="outline">
              <a
                data-testid={`sign-in-provider-${p.id}`}
                href={`/sign-in/oidc/start?provider=${encodeURIComponent(p.id)}&returnTo=${encodeURIComponent(returnTo)}`}
              >
                Continue with {p.displayName}
              </a>
            </Button>
          ))}
        </section>
      )}

      {local !== undefined && (
        <section aria-labelledby="sign-in-local" className="flex flex-col gap-3">
          {chooser && (
            <h2 id="sign-in-local" className="text-[12.5px] font-semibold text-text-1">
              {local.displayName}
            </h2>
          )}
          <SignInForm returnTo={returnTo} />
        </section>
      )}
    </main>
  );
}
