'use client';

// MCPForge — W0-P5b: the sign-in form (W0-P4 §2). A server action posts the
// credentials to the gateway from the portal SERVER; nothing here holds a
// token. A refusal shows the gateway's own message and `next`.

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signInAction, type SignInState } from '@/lib/viewer/actions';

export function SignInForm({ returnTo }: { readonly returnTo: string }): React.ReactElement {
  const [state, formAction, pending] = React.useActionState<SignInState, FormData>(
    signInAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-4" aria-describedby="sign-in-help">
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sign-in-username">Username</Label>
        <Input id="sign-in-username" name="username" autoComplete="username" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sign-in-password">Password</Label>
        <Input
          id="sign-in-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sign-in-totp">6-digit code (only if your account is enrolled)</Label>
        <Input
          id="sign-in-totp"
          name="totpCode"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
        />
      </div>

      {state.error !== undefined && (
        <div
          role="alert"
          data-testid="sign-in-error"
          className="rounded-lg border border-status-danger-border bg-status-danger-bg p-3"
        >
          <p className="text-[12.5px] font-semibold text-status-danger-strong">
            {state.error.message}
          </p>
          <p className="mt-1 text-[12px] text-text-1">{state.error.next}</p>
        </div>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
