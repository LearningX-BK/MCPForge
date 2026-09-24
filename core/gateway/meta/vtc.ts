// MCPForge — VTC: Visible Tool Count. W0-G4, 02 §5.10.
//
// WHAT "THE VTC HARD CAP" IS, AND WHY THE NUMBERS LIVE HERE. 02 §5.10 is the
// only place in the plan that fixes them, and it fixes them as a correction to
// Phase 1 with a written reason:
//
//   > VTC: tightened from "≤30 default, hard cap 40" to "≤16 default, hard cap
//   > 30." ... 16 resident definitions (4 meta + ≤12 role core) fits the
//   > 2,000-token target with headroom ... The hard cap of 30 preserves an
//   > escape hatch for a genuinely large role, at the cost of that role missing
//   > the TTFC target.
//
// Until this task the two numbers existed only as a benchmark metric to be
// REPORTED (W0-G7). 02 §5.2 makes `forge.activate` the one place a caller can
// push VTC up, and requires it to refuse "any activation that would exceed the
// VTC hard cap" — so this is the first and only place either number is
// ENFORCED at runtime. That is a judgment call about where the check lives,
// not about what it is; the numbers are 02 §5.10's, unaltered.
//
// WHAT IS COUNTED. Resident definitions in `tools/list`: the four
// always-resident meta-tools plus the activated set. §5.10's own arithmetic —
// "4 meta + ≤12 role core" reaching 16 — says the meta-tools are inside the
// count, not beside it.
//
// DEFAULT vs HARD CAP. The default is a target, not a refusal: 02 §5.10 says
// the hard cap "preserves an escape hatch for a genuinely large role, at the
// cost of that role missing the TTFC target", which is only meaningful if such
// a role can actually be activated. So `forge.activate` refuses ABOVE THE HARD
// CAP and reports the overrun of the default in its response, where the agent
// and the per-role TTFC breakdown (W0-G7) can both see it.

/** 02 §5.10 — the default VTC. Exceeding it costs TTFC; it does not refuse. */
export const VTC_DEFAULT = 16;

/** 02 §5.10 — the hard cap. `forge.activate` refuses an activation above it. */
export const VTC_HARD_CAP = 30;

/** The four always-resident meta-tools, counted inside VTC (02 §5.10's "4 meta + ≤12 role core"). */
export const META_TOOL_COUNT = 4;

export interface VtcAssessment {
  /** Resident definitions after this activation: meta-tools + activated tools. */
  readonly count: number;
  readonly activatedCount: number;
  readonly withinDefault: boolean;
  readonly withinHardCap: boolean;
}

export function assessVtc(activatedCount: number): VtcAssessment {
  const count = META_TOOL_COUNT + activatedCount;
  return {
    count,
    activatedCount,
    withinDefault: count <= VTC_DEFAULT,
    withinHardCap: count <= VTC_HARD_CAP,
  };
}
