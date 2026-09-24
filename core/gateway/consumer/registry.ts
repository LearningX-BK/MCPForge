// MCPForge — reading the consumer registry off disk. W0-N1, 02 §11.2.
//
// READ ONLY, deliberately and structurally: this module has no write path to
// `consumers/**` at all, and `proposal.ts` is the only file in this module
// that writes anything anywhere. A registration is a grant; grants change
// through the change-proposal → approval → merge flow, never through a
// process that happens to hold a file handle (02 §11.2, 05 §1.3.2).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  consumerRecordPath,
  consumerRegistrationSchema,
  effectiveStatus,
  isoToday,
  type ConsumerRecord,
  type EffectiveConsumerStatus,
} from './types.js';

/** One record as it was found on disk, with the two derived facts the gateway and CLI need. */
export interface LoadedConsumer {
  readonly record: ConsumerRecord;
  /** Repo-relative, forward-slash. */
  readonly file: string;
  /**
   * sha256 of the record file's exact bytes. 02 §11.3: `consumer_record_sha`
   * pins WHICH VERSION of the authorizations was in force for a call, so it
   * is taken over the bytes, not over a re-serialisation of the parse.
   */
  readonly recordSha: string;
  readonly effectiveStatus: EffectiveConsumerStatus;
}

/** A file under `consumers/` that could not be read as a Consumer record. */
export interface ConsumerLoadFailure {
  readonly file: string;
  readonly message: string;
}

export interface ConsumerRegistry {
  readonly consumers: readonly LoadedConsumer[];
  readonly failures: readonly ConsumerLoadFailure[];
}

export function consumersDir(repoRoot: string): string {
  return join(repoRoot, 'consumers');
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Load every `consumers/*.consumer.yaml`. A malformed record is reported as a
 * failure and NEVER silently skipped: a registry that quietly drops a record
 * it cannot parse is a registry that can be edited into invisibility.
 */
export function loadConsumerRegistry(
  repoRoot: string,
  today: string = isoToday(),
): ConsumerRegistry {
  const dir = consumersDir(repoRoot);
  if (!existsSync(dir)) return { consumers: [], failures: [] };

  const consumers: LoadedConsumer[] = [];
  const failures: ConsumerLoadFailure[] = [];

  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith('.consumer.yaml') && !entry.endsWith('.consumer.yml')) continue;
    const file = `consumers/${entry}`;
    let text: string;
    try {
      text = readFileSync(join(dir, entry), 'utf8');
    } catch (err) {
      failures.push({ file, message: err instanceof Error ? err.message : String(err) });
      continue;
    }
    let doc: unknown;
    try {
      doc = parseYaml(text);
    } catch (err) {
      failures.push({
        file,
        message: `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    const parsed = consumerRegistrationSchema.safeParse(doc);
    if (!parsed.success) {
      failures.push({
        file,
        message: parsed.error.issues.map((i) => `/${i.path.join('/')}: ${i.message}`).join('; '),
      });
      continue;
    }
    const record = parsed.data;
    if (consumerRecordPath(record.id) !== file) {
      failures.push({
        file,
        message: `record id "${record.id}" does not match its filename; a consumer id is immutable and its record must live at ${consumerRecordPath(record.id)}`,
      });
      continue;
    }
    consumers.push({
      record,
      file,
      recordSha: sha256Hex(text),
      effectiveStatus: effectiveStatus(record, today),
    });
  }

  return { consumers, failures };
}

export function findConsumer(registry: ConsumerRegistry, id: string): LoadedConsumer | undefined {
  return registry.consumers.find((c) => c.record.id === id);
}
