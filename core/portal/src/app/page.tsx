// MCPForge — W0-J19: `/` renders Home (03 §5.3 "Home"). The three-column
// worklist itself lives in `home/page.tsx` — see that file's header for why
// it is sourced from the real approvals/build/activity/catalog domains
// rather than invented content.
//
// W0-P5b (03 §2, W0-P4 §6): "it changes where you land". A signed-in viewer
// with a lens lands on that lens's page; everyone else lands on Home. This is
// a landing choice only: every page, Home included, stays reachable by
// everyone at its own URL.
import { redirect } from 'next/navigation';

import { PERSONA_LANDING } from '@/lib/viewer/personas';
import { getViewer } from '@/lib/viewer/session';

import HomePage from './home/page';

export const dynamic = 'force-dynamic';

export default async function RootPage() {
  const viewer = await getViewer();
  if (viewer?.persona != null) redirect(PERSONA_LANDING[viewer.persona]);
  return HomePage();
}
