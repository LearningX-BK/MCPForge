'use server';
// MCPForge — W0-P33d: the portal forwards a super admin's "run the probe" to
// the gateway, and decides nothing itself.
//
// Decision D of the approved W0-P33 design note (owner, 30 Sep 2026: "Local
// and dev only (Recommended)"). Whether the viewer may run it (a super admin,
// through this portal's consumer) and whether this deployment's environment
// class allows it (`local` only) are both the gateway's call
// (`POST /api/v1/admin/probe`); its refusal is shown verbatim, `next` included.
// A server action, so the viewer's token and the consumer assertion never
// reach the browser. The form carries no field: nothing about the run is the
// browser's to choose.

import { revalidatePath } from 'next/cache';

import { runProbe } from '@/lib/gateway-client/read-client';

export type ProbeRunState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'ran';
      readonly environmentClass: string;
      readonly finishedAt: string;
      readonly toolCount: number;
      readonly byStatus: Readonly<Record<string, number>>;
      readonly served: boolean;
      readonly auditCallId: string;
      readonly next: string;
    }
  | {
      readonly status: 'refused';
      readonly code?: string;
      readonly message: string;
      readonly next: string;
      readonly correlationId?: string;
    };

/** Bound to the panel's form by `useActionState`; it reads neither argument. */
export async function runProbeAction(): Promise<ProbeRunState> {
  const result = await runProbe();
  switch (result.kind) {
    case 'ok':
      revalidatePath('/environments/enablement');
      revalidatePath('/environments');
      return {
        status: 'ran',
        environmentClass: result.data.environmentClass,
        finishedAt: result.data.finishedAt,
        toolCount: result.data.toolCount,
        byStatus: result.data.byStatus,
        served: result.data.enablement.served,
        auditCallId: result.data.auditCallId,
        next: result.data.next,
      };
    case 'signed-out':
      return {
        status: 'refused',
        message: 'You are not signed in, so the probe cannot run under your name.',
        next: result.next,
      };
    case 'gateway-down':
      return {
        status: 'refused',
        message: `The portal could not reach the gateway at ${result.endpoint}. No probe ran.`,
        next: result.next,
      };
    case 'not-found':
      return { status: 'refused', code: 'NOT_FOUND', message: result.message, next: result.next };
    case 'refused':
      return {
        status: 'refused',
        code: result.code,
        message: result.message,
        next: result.next,
        ...(result.correlationId === undefined ? {} : { correlationId: result.correlationId }),
      };
  }
}
