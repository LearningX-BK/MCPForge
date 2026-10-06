// MCPForge — W0-Q5: build the request file from the form. Pure.
// `requestedBy` and the date are NOT in the input: the server action stamps
// them (a client cannot file a request in someone else's name).

import { z } from 'zod';

import { newRequestId, type RequestFile } from './request-file';

export const submitRequestInputSchema = z.object({
  ask: z.string().trim().min(1, 'is required'),
  business: z.object({
    does: z.string().trim().min(1, 'is required'),
    app: z.string().trim().min(1, 'is required'),
    module: z.string().trim().min(1, 'is required'),
    access: z.enum(['read', 'write']),
    inputs: z.array(z.string().trim().min(1)).default([]),
    goodAnswer: z.string().default(''),
    whoMayRun: z.string().default(''),
  }),
  verdict: z.object({
    tier: z.enum(['exists', 'near_miss', 'new']),
    matches: z.array(z.object({ toolId: z.string().min(1), score: z.number() })).default([]),
  }),
  indexDigest: z.string().min(1),
  /** Merge-or-justify (G4 M1): displayed in Wave 0, required by the Wave 1 gate. */
  justification: z.string().trim().optional(),
});
export type SubmitRequestInput = z.input<typeof submitRequestInputSchema>;
type ParsedInput = z.output<typeof submitRequestInputSchema>;

export function buildRequestFile(input: ParsedInput, requestedBy: string, now: Date): RequestFile {
  const justification = input.justification;
  return {
    apiVersion: 'mcpforge/v1',
    kind: 'Request',
    id: newRequestId(input.ask, now),
    requestedBy,
    requestedAt: now.toISOString(),
    ask: input.ask,
    business: input.business,
    verdictAtSubmit: {
      tier: input.verdict.tier,
      indexDigest: input.indexDigest,
      matches: input.verdict.matches,
      ...(justification !== undefined && justification.length > 0
        ? { decision: { kind: 'justify' as const, text: justification } }
        : {}),
    },
  };
}
