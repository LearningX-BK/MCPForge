// MCPForge — the gateway's runtime-info payload. 02 §10.5: "Phase 3 is
// unaffected and was already correct. §11.2's data-class chip, its
// `SQLite · local file` label, its ephemerality tooltip and its
// `runtime.store.kind` API field were written against this decision."
//
// This is that field. The portal's data-class chip reads `runtime.store.kind`
// and renders the label; the tooltip reads `runtime.store.ephemeral` and the
// note, which says out loud that on a local SQLite instance the audit records
// start empty on a fresh checkout (02 §10.3).

import type { RuntimeStore } from '../store/index.js';
import { WAVE_0_SINGLE_INSTANCE, type StoreDescriptor } from '../store/index.js';

export interface RuntimeStoreInfo extends StoreDescriptor {
  /** The honest empty-state line for the chip's tooltip (02 §10.3). */
  readonly note: string;
}

export interface RuntimeInfo {
  readonly store: RuntimeStoreInfo;
  /**
   * 02 §10.4 item 6 — the Wave 0 gateway runs as one instance. Surfaced so no
   * screen and no exit-criterion evidence can imply multi-replica.
   */
  readonly singleInstance: boolean;
}

const EPHEMERAL_NOTE =
  'This local instance stores audit records in SQLite; they start empty on a fresh checkout.';
const DURABLE_NOTE = 'Runtime state is held in a managed PostgreSQL database.';

export function runtimeInfo(store: RuntimeStore): RuntimeInfo {
  return {
    store: {
      ...store.descriptor,
      note: store.descriptor.ephemeral ? EPHEMERAL_NOTE : DURABLE_NOTE,
    },
    singleInstance: WAVE_0_SINGLE_INSTANCE,
  };
}
