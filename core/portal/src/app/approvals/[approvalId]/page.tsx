// MCPForge — `/approvals/[approvalId]`. W0-P5b: a server component, so the
// decision can carry the signed-in viewer (resolved from the portal-server
// session) instead of a hard-coded approver. The decision UI and its state are
// ./approval-decision.tsx.

import { getViewer } from '@/lib/viewer/session';
import { toViewerSummary } from '@/lib/viewer/summary';

import { ApprovalDecision } from './approval-decision';

export default async function ApprovalDecisionPage({
  params,
}: {
  params: Promise<{ approvalId: string }>;
}) {
  const { approvalId } = await params;
  const viewer = toViewerSummary(await getViewer());
  return <ApprovalDecision approvalId={approvalId} viewer={viewer} />;
}
