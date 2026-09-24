// MCPForge — the SYNTHETIC labelled intent set the currently committed score
// floor was calibrated against. W0-G3.
//
// ############################################################################
// #  THIS IS NOT STEWARD DATA.                                               #
// #                                                                          #
// #  02 §5.4.4's procedure calibrates the floor over "the benchmark's        #
// #  negative set". That benchmark is W0-HG7 — ≥30 eval intents authored by  #
// #  module STEWARDS (CLAUDE.md §4: `evals/` is "authored by module          #
// #  STEWARDS, not tool authors"). At the time this file was written         #
// #  `evals/` contains only `.gitkeep`, so no real intent set exists to      #
// #  sweep over.                                                             #
// #                                                                          #
// #  Rather than guess a constant — the exact failure 02 §5.4.4 names — the  #
// #  sweep machinery is built for real and run against the hand-written      #
// #  world below, and its output is committed as a PLACEHOLDER. W0-HG5 is    #
// #  the human gate that replaces it: "A human signs off the chosen value    #
// #  and the run that produced it." Until then the committed floor is a      #
// #  fixture-derived number and `floor.config.ts` says so at its definition. #
// ############################################################################
//
// The world is shaped to exercise the three things the sweep must separate:
// near-miss sibling pairs (`voucher.get` / `voucher.search`), positives that
// name a verb and an entity the catalogue holds, and negatives naming a
// business capability that is genuinely absent (payroll, treasury, HR).

import { indexOf, toolInput } from './rank.fixtures.js';
import type { CatalogueIndex } from '../index/types.js';
import type { LabelledIntent } from './calibrate.js';

/** The synthetic catalogue: AP, GL and SCM tools. No payroll, no HR, no treasury — that absence is what the negatives probe. */
export function calibrationIndex(): CatalogueIndex {
  return indexOf(
    toolInput({
      id: 'jde.ap.voucher.create',
      title: 'Create a voucher',
      purpose: 'Create an AP voucher against a supplier.',
      entity: 'voucher',
      verb: 'create',
      write: true,
      disambiguation:
        'voucher.create makes a NEW voucher. voucher.search finds existing ones when you do not know the number.',
    }),
    toolInput({
      id: 'jde.ap.voucher.get',
      title: 'Get a voucher',
      purpose: 'Return one voucher by document number.',
      entity: 'voucher',
      verb: 'get',
      write: false,
      disambiguation:
        'voucher.get returns one voucher by document number. voucher.search finds vouchers by supplier, date or amount when you do not know the number.',
    }),
    toolInput({
      id: 'jde.ap.voucher.search',
      title: 'Search vouchers',
      purpose: 'Find vouchers by supplier, date or amount.',
      entity: 'voucher',
      verb: 'search',
      write: false,
      disambiguation:
        'voucher.search finds vouchers by supplier, date or amount. voucher.get returns one voucher when you already have its document number.',
    }),
    toolInput({
      id: 'jde.ap.supplier.get',
      title: 'Get a supplier',
      purpose: 'Return one supplier master record.',
      entity: 'supplier',
      verb: 'get',
      write: false,
    }),
    toolInput({
      id: 'jde.gl.journal.create',
      title: 'Create a journal entry',
      purpose: 'Create a general ledger journal entry batch.',
      module: 'gl',
      moduleLabel: 'JD Edwards General Ledger',
      functionalArea: 'General Ledger',
      entity: 'journal',
      verb: 'create',
      write: true,
      processTags: ['R2R'],
      roles: ['r2r'],
      disambiguation:
        'journal.create drafts a journal batch. journal.submit posts an existing batch to the ledger.',
    }),
    toolInput({
      id: 'jde.gl.journal.submit',
      title: 'Submit a journal batch',
      purpose: 'Post an existing journal batch to the ledger.',
      module: 'gl',
      moduleLabel: 'JD Edwards General Ledger',
      functionalArea: 'General Ledger',
      entity: 'journal',
      verb: 'submit',
      write: true,
      processTags: ['R2R'],
      roles: ['r2r'],
      disambiguation:
        'journal.submit posts a batch that already exists. journal.create drafts a new one.',
    }),
    toolInput({
      id: 'jde.scm.purchase_order.get',
      title: 'Get a purchase order',
      purpose: 'Return one purchase order by order number.',
      module: 'scm',
      moduleLabel: 'JD Edwards Supply Chain',
      functionalArea: 'Procurement',
      entity: 'purchase_order',
      verb: 'get',
      write: false,
      roles: ['p2p'],
    }),
    toolInput({
      id: 'jde.scm.purchase_order.approve',
      title: 'Approve a purchase order',
      purpose: 'Approve a purchase order awaiting release.',
      module: 'scm',
      moduleLabel: 'JD Edwards Supply Chain',
      functionalArea: 'Procurement',
      entity: 'purchase_order',
      verb: 'approve',
      write: true,
      roles: ['p2p'],
    }),
  );
}

/**
 * The labelled set. 8 positives and 4 negatives — a 33% negative share,
 * above 02 §5.4.4's "≥10% of benchmark cases" so the F1 has something to
 * measure, and small enough that every case can be checked by hand.
 */
export const CALIBRATION_INTENTS: readonly LabelledIntent[] = Object.freeze([
  {
    id: 'p1',
    query: { text: 'create a voucher for a supplier' },
    expected: 'jde.ap.voucher.create',
  },
  { id: 'p2', query: { text: 'get voucher by document number' }, expected: 'jde.ap.voucher.get' },
  {
    id: 'p3',
    query: { text: 'search vouchers by supplier and amount' },
    expected: 'jde.ap.voucher.search',
  },
  { id: 'p4', query: { text: 'get the supplier master record' }, expected: 'jde.ap.supplier.get' },
  { id: 'p5', query: { text: 'create a journal entry batch' }, expected: 'jde.gl.journal.create' },
  {
    id: 'p6',
    query: { text: 'submit the journal batch to the ledger' },
    expected: 'jde.gl.journal.submit',
  },
  {
    id: 'p7',
    query: { text: 'get a purchase order by order number' },
    expected: 'jde.scm.purchase_order.get',
  },
  {
    id: 'p8',
    query: { text: 'approve a purchase order' },
    expected: 'jde.scm.purchase_order.approve',
  },
  { id: 'n1', query: { text: 'adjust an employee payroll deduction' }, expected: null },
  { id: 'n2', query: { text: 'book a treasury foreign exchange hedge' }, expected: null },
  { id: 'n3', query: { text: 'enrol a new starter in the benefits plan' }, expected: null },
  { id: 'n4', query: { text: 'schedule a warehouse forklift maintenance visit' }, expected: null },
]);

/** The SA@1 constraint the sweep is run under. 02 §5.4.3's Wave 1 gate is 90%; the Wave 0 lexical channel is held to the same target. */
export const CALIBRATION_SA_AT_1_TARGET = 0.9;

/** Identifier recorded in the run artefact so a number can never be mistaken for one derived from steward intents. */
export const CALIBRATION_DATASET_ID = 'synthetic-fixture/w0-g3' as const;
