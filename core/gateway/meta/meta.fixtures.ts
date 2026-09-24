// MCPForge — fixtures for the W0-G4 meta-tool suites.
//
// Built ON TOP of W0-E2's scope fixtures and W0-E3's policy fixtures, for the
// reason W0-E3 already recorded: the meta layer resolves scope and runs the
// policy chain over the same world, and a second, subtly different catalogue
// would let a meta test pass against a world neither of those ever sees.
//
// The catalogue index is built with the REAL `buildCatalogueIndex` (W0-G1)
// from the same tool ids, so `forge.find` is ranking a real artefact with the
// real ranker rather than a hand-shaped stand-in.

import { buildCatalogueIndex, type CatalogueIndex } from '@mcpforge/registry/index';
import {
  context as policyContext,
  POLICY_CATALOGUE,
  type PolicyContextOverrides,
} from '../policy/policy.fixtures.js';
import { TOOLS } from '../scope/scope.fixtures.js';
import { createMetaSession } from './session.js';
import type { MetaContext, MetaSession, MetaToolCard, MetaToolDetail } from './types.js';

export { TOOLS, POLICY_CATALOGUE };

interface ToolText {
  readonly title: string;
  readonly purpose: string;
  readonly aliases: readonly string[];
  readonly disambiguation: string | null;
}

const TEXT: Readonly<Record<string, ToolText>> = {
  [TOOLS.voucherCreate]: {
    title: 'Create AP voucher',
    purpose: 'Create an AP voucher against a supplier, optionally matched to a PO.',
    aliases: ['book a payable', 'supplier invoice', 'record an invoice', 'three-way match'],
    disambiguation:
      'Use create to book a new supplier invoice; use search to find existing vouchers.',
  },
  [TOOLS.voucherSearch]: {
    title: 'Search AP vouchers',
    purpose: 'Search AP vouchers by supplier, date, amount or status.',
    aliases: ['find vouchers', 'list payables', 'look up supplier invoices'],
    disambiguation: 'Use search to locate vouchers; use create to book a new one.',
  },
  [TOOLS.voucherGet]: {
    title: 'Get AP voucher',
    purpose: 'Get one AP voucher by document number and company.',
    aliases: ['show voucher', 'voucher detail'],
    disambiguation: 'Use get when you already know the document number; use search otherwise.',
  },
  [TOOLS.voucherCancel]: {
    title: 'Cancel AP voucher',
    purpose: 'Cancel an open AP voucher that has not been paid.',
    aliases: ['void a voucher', 'reverse a payable'],
    disambiguation: 'Cancel voids an existing voucher; create books a new one.',
  },
  [TOOLS.voucherUpdate]: {
    title: 'Update AP voucher',
    purpose: 'Update the remark, due date or approver on an open AP voucher.',
    aliases: ['amend a voucher', 'change a payable'],
    disambiguation: 'Update edits an open voucher; cancel voids it.',
  },
  [TOOLS.voucherSubmit]: {
    title: 'Submit AP voucher',
    purpose: 'Submit an AP voucher into the approval workflow.',
    aliases: ['send voucher for approval'],
    disambiguation: 'Submit routes a voucher for approval; create books it first.',
  },
  [TOOLS.voucherDownload]: {
    title: 'Download AP voucher',
    purpose: 'Download the scanned document attached to an AP voucher.',
    aliases: ['voucher attachment', 'invoice image'],
    disambiguation: 'Download returns the attachment; get returns the record.',
  },
  [TOOLS.voucherExplain]: {
    title: 'Explain AP voucher',
    purpose: 'Explain how an AP voucher was matched and posted.',
    aliases: ['why was this voucher posted'],
    disambiguation: 'Explain narrates the posting; get returns the record.',
  },
  [TOOLS.poCreate]: {
    title: 'Create purchase order',
    purpose: 'Create a purchase order for a supplier and one or more lines.',
    aliases: ['raise a PO', 'new purchase order', 'order goods'],
    disambiguation: null,
  },
  [TOOLS.journalCreate]: {
    title: 'Create GL journal',
    purpose: 'Create a general ledger journal entry with balanced lines.',
    aliases: ['post a journal', 'GL entry'],
    disambiguation: null,
  },
  [TOOLS.salesOrderCreate]: {
    title: 'Create sales order',
    purpose: 'Create a sales order for a customer and one or more lines.',
    aliases: ['take an order', 'customer order'],
    disambiguation: null,
  },
};

const MODULE_LABELS: Readonly<Record<string, string>> = {
  ap: 'Accounts Payable',
  scm: 'Supply Chain',
  fin: 'Finance',
  o2c: 'Order to Cash',
  hcm: 'Human Capital',
};

const ROLES_BY_TOOL: Readonly<Record<string, readonly string[]>> = {
  [TOOLS.journalCreate]: ['r2r'],
  [TOOLS.salesOrderCreate]: ['o2c'],
};

export function buildIndex(): CatalogueIndex {
  return buildCatalogueIndex(
    POLICY_CATALOGUE.map((entry) => {
      const [app = '', mod = '', ent = '', verb = ''] = entry.toolId.split('.');
      const text = TEXT[entry.toolId] ?? {
        title: entry.toolId,
        purpose: entry.toolId,
        aliases: [],
        disambiguation: null,
      };
      return {
        id: entry.toolId,
        title: text.title,
        purpose: text.purpose,
        aliases: text.aliases,
        disambiguation: text.disambiguation,
        entity: ent,
        verb,
        app,
        module: mod,
        appLabel: 'JD Edwards',
        moduleLabel: MODULE_LABELS[mod] ?? mod,
        functionalArea: MODULE_LABELS[mod] ?? mod,
        bindingType: entry.bindingType,
        archetype: entry.write ? 'transaction' : 'query',
        sensitivity: entry.sensitivity,
        write: entry.write,
        processTags: ['P2P'],
        packageTags: ['jde-fin'],
        roles: ROLES_BY_TOOL[entry.toolId] ?? ['p2p'],
        status: 'resolved',
      };
    }),
    new Set<string>(),
  );
}

/** Cards, shaped exactly like `cardWireShape(buildDiscoveryCard(...))` (W0-B6). */
export function cardSource(): { cardFor(id: string): MetaToolCard | null } {
  const index = buildIndex();
  const cards = new Map<string, MetaToolCard>(
    index.tools.map((t) => [
      t.id,
      {
        id: t.id,
        purpose: TEXT[t.id]?.purpose ?? t.id,
        verb: t.filters.verb,
        entity: t.filters.entity,
        write: t.filters.write,
        binding: t.filters.bindingType,
        sensitivity: t.filters.sensitivity,
        roles: t.filters.roles,
        status: t.filters.status,
      },
    ]),
  );
  return { cardFor: (id) => cards.get(id) ?? null };
}

export function detailSource(): { detailFor(id: string): MetaToolDetail | null } {
  const index = buildIndex();
  const details = new Map<string, MetaToolDetail>(
    index.tools.map((t) => [
      t.id,
      {
        id: t.id,
        purpose: TEXT[t.id]?.purpose ?? t.id,
        inputSchema: { type: 'object', properties: {} },
        examples: [],
        errors: [],
        writeSafety: { write: t.filters.write },
        sensitivity: t.filters.sensitivity,
      },
    ]),
  );
  return { detailFor: (id) => details.get(id) ?? null };
}

export interface MetaFixtureOverrides extends PolicyContextOverrides {
  readonly agentMessages?: ReadonlyMap<string, string>;
  readonly approvers?: ReadonlyMap<string, string>;
  readonly notifier?: { sendToolListChanged(): void | Promise<void> };
}

export function metaContext(overrides: MetaFixtureOverrides = {}): MetaContext {
  const messages = overrides.agentMessages ?? new Map<string, string>();
  const approvers = overrides.approvers ?? new Map<string, string>();
  return {
    index: buildIndex(),
    policy: policyContext(overrides),
    cards: cardSource(),
    details: detailSource(),
    probeMessages: { agentMessageFor: (id) => messages.get(id) ?? null },
    approvers: { approverFor: (id) => approvers.get(id) ?? null },
    notifier: overrides.notifier ?? { sendToolListChanged: () => undefined },
  };
}

export function metaSession(overrides: MetaFixtureOverrides = {}): MetaSession {
  return createMetaSession(metaContext(overrides));
}

export const CORRELATION_ID = 'req_meta_0001';
