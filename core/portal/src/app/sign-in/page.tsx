// MCPForge — W0-P5b: `/sign-in` (W0-P4 §2).
//
// Signing in is optional for reading: every page renders for everyone,
// signed in or not (03 §2: persona "never hides a page"). It is needed for the
// acts that carry an identity (Save draft, Propose, Discard) and for the
// admin-only portal actions.

import { safeReturnTo } from '@/lib/viewer/actions';

import { SignInForm } from './sign-in-form';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const raw = (await searchParams).returnTo;
  const returnTo = await safeReturnTo(Array.isArray(raw) ? raw[0] : raw);
  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-lg text-text-1">Sign in to MCPForge</h1>
        <p id="sign-in-help" className="text-[12.5px] text-text-2">
          The gateway checks your credentials; the portal never sees your password again and never
          holds a token in the browser. Signing in lets you save drafts, propose changes and use the
          actions your persona allows. Every page is readable without signing in.
        </p>
      </div>
      <SignInForm returnTo={returnTo} />
    </main>
  );
}
