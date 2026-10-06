// MCPForge — W0-Q5: `/requests/[requestId]` — one request and its lifecycle,
// derived from real linked artefacts (w0-q4-intake-requests.md §3).

import * as React from 'react';
import { notFound } from 'next/navigation';

import { loadRequest } from '../_lib/load-requests';
import { REQUEST_ID_PATTERN } from '../_lib/request-file';
import { RequestDetailView } from './request-detail-view';

export const dynamic = 'force-dynamic';

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}): Promise<React.ReactElement> {
  const { requestId } = await params;
  if (!REQUEST_ID_PATTERN.test(requestId)) notFound();
  const tracked = await loadRequest(requestId);
  if (tracked === undefined) notFound();
  return <RequestDetailView tracked={tracked} />;
}
