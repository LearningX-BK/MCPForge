'use server';
// MCPForge — W0-P25: the portal forwards a human's decision on a runtime
// approval to the gateway, and decides nothing itself.
//
// W0-P4 §3: for a runtime write "whoever the gateway's approval gate accepts;
// the portal only forwards the decision ... the gateway's own error, rendered
// verbatim, `next` included". So there is no portal-side approver check here:
// self-approval, the approver's own grants and expiry are all the gateway's
// (`POST /api/v1/approvals/{id}/decision`). A server action, so the viewer's
// token and the portal's consumer assertion never reach the browser, and the
// approver is never a form field: the gateway takes it from the token.

import { revalidatePath } from 'next/cache';

import { decideApproval } from '@/lib/gateway-client/read-client';

export type DecisionState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'decided';
      readonly decision: 'approved' | 'rejected';
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

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export async function decideApprovalAction(
  _prev: DecisionState,
  form: FormData,
): Promise<DecisionState> {
  const approvalId = field(form, 'approvalId');
  const decision = field(form, 'decision');
  const reason = field(form, 'reason').trim();

  if (decision !== 'approved' && decision !== 'rejected') {
    return {
      status: 'refused',
      message: 'No decision was chosen.',
      next: 'Choose Approve or Decline.',
    };
  }
  if (decision === 'rejected' && reason.length === 0) {
    return {
      status: 'refused',
      message: 'A decline needs a reason.',
      next: 'Write why you are declining. The requester’s agent is shown your reason, so make it something they can act on.',
    };
  }

  const result = await decideApproval(approvalId, {
    decision,
    ...(reason.length === 0 ? {} : { reason }),
  });

  switch (result.kind) {
    case 'ok':
      revalidatePath(`/approvals/${encodeURIComponent(approvalId)}`);
      revalidatePath('/approvals');
      return {
        status: 'decided',
        decision: result.data.approval.status === 'rejected' ? 'rejected' : 'approved',
        auditCallId: result.data.auditCallId,
        next: result.data.next,
      };
    case 'signed-out':
      return {
        status: 'refused',
        message: 'You are not signed in, so this decision cannot carry your name.',
        next: result.next,
      };
    case 'gateway-down':
      return {
        status: 'refused',
        message: `The portal could not reach the gateway at ${result.endpoint}. Nothing was decided.`,
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
