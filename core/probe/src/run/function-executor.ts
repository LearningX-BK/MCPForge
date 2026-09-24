// MCPForge — the `function` binding's probe executor. 02 §4.5's `function`
// row. W0-H4.
//
// Wave 0's ONLY live-capable executor, because Wave 0's bindings are all
// `function` (02 §11.4.4). It speaks `AisClient` — the same seam
// `adapters/function` dispatches through — so it runs unchanged against the
// in-process fake at `@mcpforge/adapter-function/testing` today and against a
// real AIS server when one exists. There is no live JDE instance in this
// environment, so every assertion about this executor in this repository is
// made against that fake.
//
// READ-ONLY BY CONSTRUCTION, at this layer too: the orchestration names this
// executor dispatches are derived from `binding.ref` plus the two fixed probe
// suffixes below. It never dispatches `ref` itself for a write tool, so no code
// path here can invoke the business orchestration.

import type { AisClient } from '@mcpforge/adapter-function';
import type { BindingType } from '@mcpforge/shared/manifest';
import {
  compareWhoami,
  readWhoamiIdentity,
  PROBE_WHOAMI_ORCHESTRATION,
  type WhoamiOutcome,
} from '../identity/whoami.js';
import type { ProbeCheckContext, ProbeCheckExecutor, ProbeCheckResult } from '../plan/types.js';

/**
 * 02 §3.5 / §4.5. Re-exported under the name this module already published;
 * the single literal now lives in `identity/whoami.ts`, which owns the check.
 */
export { PROBE_WHOAMI_ORCHESTRATION };
/** 02 §3.5 — the dry-run sibling naming convention. */
export const VALIDATE_SUFFIX = '_VALIDATE';
/**
 * The version check reads metadata THROUGH a probe-owned orchestration rather
 * than by invoking `binding.ref` itself. Invoking `ref` would mean the probe
 * dispatching a business orchestration — for a write tool, the actual write —
 * which is precisely what "read-only or validate-only by construction" forbids.
 * The orchestration name travels as an INPUT here, and that is safe for the
 * same reason it is unsafe in `adapters/function`: the value is manifest-derived
 * (`binding.ref`), never caller-derived, and the dispatched name is this fixed
 * constant.
 */
export const PROBE_ORCHESTRATION_INFO = 'MCPFORGE_PROBE_ORCHESTRATION_INFO';

/**
 * The complete set of orchestration names this executor is capable of
 * dispatching, as a function of a tool's `binding.ref`. Asserted by the
 * structural test — `ref` itself is deliberately not a member.
 */
export function dispatchableOrchestrations(ref: string): readonly string[] {
  return [PROBE_WHOAMI_ORCHESTRATION, `${ref}${VALIDATE_SUFFIX}`, PROBE_ORCHESTRATION_INFO];
}

const PROBE_TIMEOUT_MS = 10_000;

export interface FunctionProbeOptions {
  readonly client: AisClient;
  /**
   * The designated test user the probe authenticates as. Required — there is no
   * default identity anywhere in this codebase (non-negotiable #1).
   */
  readonly testIdentity: string;
  /**
   * Acquires a token for `testIdentity`. Returning `null` (or being absent) is
   * a FAILED check, never an assumed pass.
   */
  readonly acquireToken?: () => Promise<string | null>;
}

function parseBody(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function dispatch(
  client: AisClient,
  orchestration: string,
  ctx: ProbeCheckContext,
  inputs: Readonly<Record<string, unknown>> = {},
): Promise<{ status: number; body: string } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await client.call({
      orchestration,
      orchestrationVersion: ctx.refVersion,
      inputs,
      signal: controller.signal,
      correlationId: ctx.correlationId,
    });
    if (res.targetError) return { error: res.targetError.message };
    return { status: res.status, body: res.body };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export function createFunctionProbeExecutor(options: FunctionProbeOptions): ProbeCheckExecutor {
  const bindingType: BindingType = 'function';

  async function run(ctx: ProbeCheckContext): Promise<ProbeCheckResult> {
    const name = ctx.check.name;

    if (name === 'auth_token_for_test_identity') {
      const token = options.acquireToken ? await options.acquireToken() : null;
      return token === null || token.length === 0
        ? {
            name,
            result: 'fail',
            detail: `no token could be acquired for the designated probe test identity "${options.testIdentity}"`,
          }
        : {
            name,
            result: 'pass',
            detail: `a token was acquired for the designated probe test identity "${options.testIdentity}"`,
          };
    }

    if (name === 'whoami') {
      // W0-H5. The dispatch is here (this is the transport seam); the VERDICT
      // is `core/probe/identity`'s and is not re-derived at this layer. That
      // split is deliberate: `verified` is producible from exactly one function
      // in the repository, and it is not this one.
      const res = await dispatch(options.client, PROBE_WHOAMI_ORCHESTRATION, ctx);
      let outcome: WhoamiOutcome;
      if ('error' in res) {
        outcome = { kind: 'error', reason: res.error };
      } else {
        const observed = readWhoamiIdentity(parseBody(res.body));
        outcome =
          observed === null
            ? {
                kind: 'unnamed',
                reason: `HTTP ${res.status} response carried no known identity key`,
              }
            : { kind: 'observed', observed };
      }
      const comparison = compareWhoami({
        toolId: ctx.toolId,
        testIdentity: options.testIdentity,
        outcome,
      });
      return {
        name,
        result: comparison.carries === 'verified' ? 'pass' : 'fail',
        detail: comparison.detail,
        identityCarriage: comparison.carries,
        observedIdentity: comparison.observed,
      };
    }

    if (name === 'validate_sibling') {
      const sibling = `${ctx.ref}${VALIDATE_SUFFIX}`;
      const res = await dispatch(options.client, sibling, ctx);
      if ('error' in res) {
        return {
          name,
          result: 'fail',
          detail: `the dry-run sibling ${sibling} is missing or errored: ${res.error}`,
        };
      }
      const body = parseBody(res.body);
      return body !== null && 'validated' in body
        ? {
            name,
            result: 'pass',
            detail: `the dry-run sibling ${sibling} responded with the expected validation structure`,
          }
        : {
            name,
            result: 'fail',
            detail: `the dry-run sibling ${sibling} responded without the expected "validated" structure`,
          };
    }

    if (name === 'orchestration_version') {
      if (ctx.refVersion === null) {
        return {
          name,
          result: 'not_applicable',
          detail: 'the manifest declares no binding.refVersion, so there is no version to compare',
        };
      }
      const res = await dispatch(options.client, PROBE_ORCHESTRATION_INFO, ctx, {
        orchestration: ctx.ref,
      });
      if ('error' in res) {
        return { name, result: 'fail', detail: `version could not be read: ${res.error}` };
      }
      const body = parseBody(res.body);
      const observed = typeof body?.['version'] === 'string' ? (body['version'] as string) : null;
      if (observed === null) {
        return {
          name,
          result: 'fail',
          detail: `${PROBE_ORCHESTRATION_INFO} reported no version for ${ctx.ref}, so drift against binding.refVersion ${ctx.refVersion} cannot be ruled out`,
        };
      }
      return observed === ctx.refVersion
        ? { name, result: 'pass', detail: `orchestration version ${observed} matches refVersion` }
        : {
            name,
            result: 'fail',
            detail: `orchestration version ${observed} does not match binding.refVersion ${ctx.refVersion}`,
          };
    }

    /* An unknown check name is a FAILURE, not a pass and not a skip — the
       catalogue and the executor drifting apart must be visible. */
    return {
      name,
      result: 'fail',
      detail: `the function probe executor has no implementation for check "${name}"; the check catalogue and this executor have drifted`,
    };
  }

  return { bindingType, run };
}
