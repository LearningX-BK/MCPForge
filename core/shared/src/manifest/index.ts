// MCPForge — the manifest type model. 02 §2.2, §4.3, §6.1, §11.2.

export * from './common.js';
export * from './tool.js';
export * from './server.js';
export * from './role.js';
export * from './package.js';
export * from './consumer.js';

import type { ToolManifest } from './tool.js';
import type { ServerManifest } from './server.js';
import type { RoleManifest } from './role.js';
import type { PackageManifest } from './package.js';
import type { ConsumerManifest } from './consumer.js';

/** Every artefact `forge validate` and `forge codegen` read from git. */
export type Manifest =
  ToolManifest | ServerManifest | RoleManifest | PackageManifest | ConsumerManifest;

export const isTool = (m: Manifest): m is ToolManifest => m.kind === 'Tool';
export const isServer = (m: Manifest): m is ServerManifest => m.kind === 'Server';
export const isRole = (m: Manifest): m is RoleManifest => m.kind === 'Role';
export const isPackage = (m: Manifest): m is PackageManifest => m.kind === 'Package';
export const isConsumer = (m: Manifest): m is ConsumerManifest => m.kind === 'Consumer';
