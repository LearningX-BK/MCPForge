// MCPForge — W0-N12: `/governance/consumers` — Governance tab 5 (03 §16.2).
//
// A server component, for the same reason `../page.tsx` is one: the consumer
// records and their compiled authorization artefacts are definitional data
// read from the repo, and turning that into a client fetch would be a
// round-trip for something the server already knows. The live compile below it
// is a Server Action (`_lib/compile-consumer.ts`), called by `ConsumerEditor`.
//
// 03 §16.1's IA decision, restated because this page is where it lands:
// **Governance is where a consumer's authorization is decided. Activity is
// where its behaviour is observed.** Usage, quota headroom and anomaly events
// are `/activity/consumers` (W0-N13) and deliberately absent here.
import * as React from 'react';

import { GovNav } from '../_components/gov-nav';
import { ConsumersTab } from './_components/consumers-tab';
import { compileConsumerDraft } from './_lib/compile-consumer';
import { scaffoldConsumerAction } from './_lib/register-action';
import { loadConsumerFailures, loadConsumerSources } from './_lib/repo-consumers';

export default function GovernanceConsumersPage(): React.ReactElement {
  const sources = loadConsumerSources();
  const failures = loadConsumerFailures();

  return (
    <main className="flex flex-col gap-6 px-6 py-6">
      <div>
        <h1 className="mb-1 font-display text-xl text-text-1">Governance</h1>
        <p className="max-w-[80ch] text-[13px] text-text-2">
          A consumer is the software holding the session. Every call needs both a registered
          consumer and a resolved human identity, and authorization is the intersection of what the
          consumer may do and what the human may do — never the union, never a substitute. Its
          record compiles to an explicit authorization artefact, and that artefact is what a
          reviewer approves.
        </p>
      </div>

      <GovNav />

      <ConsumersTab
        sources={sources}
        failures={failures}
        compile={compileConsumerDraft}
        scaffold={scaffoldConsumerAction}
        deploymentId="local"
        envClass="local"
      />
    </main>
  );
}
