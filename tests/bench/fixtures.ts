// Synthetic fixture catalogue for the W0-G6 suite. Deliberately NOT the real
// Wave 0 tools (`manifests/jde/**` is empty — Track I has not run) and
// deliberately NOT a copy of `core/gateway/*/[...].fixtures.ts` (those are
// scope/policy fixtures for a different task's suites) — this is its own
// small, synthetic catalogue built with the REAL `buildCatalogueIndex`
// (`@mcpforge/registry/index`), so the generator and the mock gateway are
// exercised against a real artefact shape without needing real manifests.

import { buildCatalogueIndex, type CatalogueIndex, type CatalogueIndexToolInput } from '@mcpforge/registry/index';

const TOOLS: readonly CatalogueIndexToolInput[] = [
  {
    id: 'acme.ap.voucher.create',
    title: 'Create AP voucher',
    purpose: 'Create an AP voucher against a supplier invoice.',
    aliases: ['book a payable', 'record a supplier invoice'],
    disambiguation: 'Use create to book a new voucher; use search to find one.',
    entity: 'voucher',
    verb: 'create',
    app: 'acme',
    module: 'ap',
    appLabel: 'Acme ERP',
    moduleLabel: 'Accounts Payable',
    functionalArea: 'Accounts Payable',
    bindingType: 'function',
    archetype: 'transactional',
    sensitivity: 'financial',
    write: true,
    processTags: ['p2p'],
    packageTags: ['acme-fin'],
    roles: ['p2p'],
    status: 'resolved',
  },
  {
    id: 'acme.ap.voucher.search',
    title: 'Search AP vouchers',
    purpose: 'Search AP vouchers by supplier, date or status.',
    aliases: ['find vouchers', 'list payables'],
    disambiguation: 'Use search to locate vouchers; use create to book a new one.',
    entity: 'voucher',
    verb: 'search',
    app: 'acme',
    module: 'ap',
    appLabel: 'Acme ERP',
    moduleLabel: 'Accounts Payable',
    functionalArea: 'Accounts Payable',
    bindingType: 'rest',
    archetype: 'analytical',
    sensitivity: 'internal',
    write: false,
    processTags: ['p2p'],
    packageTags: ['acme-fin'],
    roles: ['p2p'],
    status: 'resolved',
  },
  {
    id: 'acme.ap.voucher.get',
    title: 'Get AP voucher',
    purpose: 'Get one AP voucher by document number.',
    aliases: ['show voucher', 'voucher detail'],
    disambiguation: 'Use get when you already know the document number.',
    entity: 'voucher',
    verb: 'get',
    app: 'acme',
    module: 'ap',
    appLabel: 'Acme ERP',
    moduleLabel: 'Accounts Payable',
    functionalArea: 'Accounts Payable',
    bindingType: 'rest',
    archetype: 'analytical',
    sensitivity: 'internal',
    write: false,
    processTags: ['p2p'],
    packageTags: ['acme-fin'],
    roles: ['p2p'],
    status: 'resolved',
  },
  {
    id: 'acme.fin.journal.create',
    title: 'Create GL journal',
    purpose: 'Create a balanced general ledger journal entry.',
    aliases: ['post a journal', 'GL entry'],
    disambiguation: null,
    entity: 'journal',
    verb: 'create',
    app: 'acme',
    module: 'fin',
    appLabel: 'Acme ERP',
    moduleLabel: 'Finance',
    functionalArea: 'Finance',
    bindingType: 'function',
    archetype: 'transactional',
    sensitivity: 'financial',
    write: true,
    processTags: ['r2r'],
    packageTags: ['acme-fin'],
    roles: ['r2r'],
    status: 'resolved',
  },
];

export function buildFixtureIndex(): CatalogueIndex {
  return buildCatalogueIndex(TOOLS, new Set<string>());
}

export const FIXTURE_TOOL_IDS = TOOLS.map((t) => t.id);
