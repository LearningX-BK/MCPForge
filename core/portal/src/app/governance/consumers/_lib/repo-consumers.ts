// MCPForge — W0-N12: loading the consumer records the editor opens with.
//
// Server-only (`node:fs`), read-only, and read through the SAME reader the
// gateway and the CLI use — `loadConsumerRegistry` (W0-N1,
// `core/gateway/consumer/registry.ts`). The portal does not parse
// `consumers/**` itself: a second parser is a second opinion about which
// registrations are live, and 02 §11.2 makes that opinion load-bearing (an
// `active` record past its `expiresAt` is `expired`, and a record that cannot
// be read is a load FAILURE, never a silently dropped row).
//
// The compiled artefact on disk is read, never re-derived, for the reason
// `../../_lib/repo-roles.ts` states in full: re-deriving it would give the
// portal a second opinion about what is already granted, and two opinions is
// how a widening goes unseen.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_REGISTRATION_DAYS,
  addDays,
  effectiveStatus,
  isoToday,
  loadConsumerRegistry,
  renderConsumerRecord,
  scaffoldConsumerRecord,
  type ConsumerRecord,
} from '@mcpforge/gateway/consumer/records';

import { resolveRepoRoot } from '../../../build/_lib/repo-root';
import { daysBetween } from './authorization-view';
import type { ConsumerRowView, ConsumerSource } from '../types';

export function artefactPathFor(consumerId: string): string {
  return `generated/consumers/${consumerId}.authorization.json`;
}

function readMergedArtefact(repoRoot: string, consumerId: string): string {
  const abs = join(repoRoot, 'generated', 'consumers', `${consumerId}.authorization.json`);
  if (!existsSync(abs)) return '';
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return '';
  }
}

function rowFor(record: ConsumerRecord, today: string): ConsumerRowView {
  const lastRotated = record.credential.rotation.lastRotatedAt;
  const intervalDays = record.credential.rotation.intervalDays;
  const credentialAgeDays = daysBetween(lastRotated, today);
  const nextRotationDue =
    credentialAgeDays === null ? null : addDays(lastRotated, intervalDays);
  return {
    consumerId: record.id,
    label: record.label,
    consumerClass: record.class,
    owner: record.owner,
    steward: record.steward,
    status: record.status,
    effectiveStatus: effectiveStatus(record, today),
    expiresAt: record.expiresAt,
    credentialAgeDays,
    nextRotationDue,
    rotationDueInDays: nextRotationDue === null ? null : daysBetween(today, nextRotationDue),
  };
}

/**
 * Every readable consumer record, with its merged compiled artefact — plus, at
 * the end, every file under `consumers/` that could NOT be read, as a row
 * carrying its load error. An unreadable registration is a governance fact
 * worth showing: `loadConsumerRegistry` refuses to authenticate it, so the
 * registry table must not present the directory as though it held one record
 * fewer than it does.
 */
export function loadConsumerSources(
  repoRoot: string = resolveRepoRoot(),
  today: string = isoToday(),
): readonly ConsumerSource[] {
  const registry = loadConsumerRegistry(repoRoot, today);
  const out: ConsumerSource[] = registry.consumers.map((loaded) => ({
    consumerId: loaded.record.id,
    label: loaded.record.label,
    path: loaded.file,
    yamlText: readFileSync(join(repoRoot, loaded.file), 'utf8'),
    artefactPath: artefactPathFor(loaded.record.id),
    mergedArtefactJson: readMergedArtefact(repoRoot, loaded.record.id),
    isNew: false,
    row: rowFor(loaded.record, today),
  }));
  return out.sort((a, b) => a.consumerId.localeCompare(b.consumerId));
}

/** The unreadable files under `consumers/`, for the table's own honesty row. */
export function loadConsumerFailures(
  repoRoot: string = resolveRepoRoot(),
  today: string = isoToday(),
): readonly ConsumerRowView[] {
  return loadConsumerRegistry(repoRoot, today).failures.map((f) => ({
    consumerId: f.file,
    label: f.file,
    consumerClass: '',
    owner: '',
    steward: '',
    status: '',
    effectiveStatus: '',
    expiresAt: '',
    credentialAgeDays: null,
    nextRotationDue: null,
    rotationDueInDays: null,
    loadError: f.message,
  }));
}

/**
 * 03 §16.2's **Register** action, as a source the editor can open.
 *
 * The record is produced by the REAL `scaffoldConsumerRecord` (W0-N1), which
 * is the same function `forge consumer new` calls — so a registration drafted
 * in the portal and one drafted at the CLI are the same bytes, and both start
 * from the same closed position: no binding types, no roles, no packages,
 * `writeAllowed: false`. Nothing is written to `consumers/` here; this is the
 * left pane's starting text and it reaches git only as a change proposal.
 */
export function scaffoldConsumerSource(
  consumerId: string,
  today: string = isoToday(),
): ConsumerSource {
  const record = scaffoldConsumerRecord({
    id: consumerId,
    label: consumerId,
    consumerClass: 'interactive-client',
    owner: 'unassigned-team',
    steward: 'unassigned-steward',
    humanInTheLoop: true,
    today,
  });
  return {
    consumerId,
    label: record.label,
    path: `consumers/${consumerId}.consumer.yaml`,
    yamlText: renderConsumerRecord(record),
    artefactPath: artefactPathFor(consumerId),
    mergedArtefactJson: '',
    isNew: true,
    row: {
      ...rowFor(record, today),
      effectiveStatus: effectiveStatus(record, today),
    },
  };
}

/** Exported so the page can name the default registration window in copy. */
export const REGISTRATION_DAYS = DEFAULT_REGISTRATION_DAYS;
