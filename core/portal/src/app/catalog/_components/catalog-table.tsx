// MCPForge — W0-J13: the Table view (the default), built on `DataTable` (W0-J10).
'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';

import { DataTable } from '@/components/data';
import { BindingChip, ChangeStateChip, ProbeStatusChip, VerbChip, WriteChip } from '@/components/chips';
import type { CatalogTool } from '../types';

export interface CatalogTableProps {
  rows: readonly CatalogTool[];
  onOpen: (toolId: string) => void;
}

const columns: ColumnDef<CatalogTool, unknown>[] = [
  {
    id: 'id',
    header: 'Tool',
    accessorFn: (r) => r.manifest.id,
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium text-text-1">{row.original.manifest.title}</span>
        <span className="font-mono text-[11px] text-text-2">{row.original.manifest.id}</span>
      </div>
    ),
  },
  {
    id: 'verb',
    header: 'Verb',
    accessorFn: (r) => r.manifest.verb,
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        <VerbChip verb={row.original.manifest.verb} />
        {row.original.manifest.write ? <WriteChip /> : null}
      </div>
    ),
  },
  {
    id: 'binding',
    header: 'Binding',
    accessorFn: (r) => r.manifest.binding.type,
    cell: ({ row }) => <BindingChip type={row.original.manifest.binding.type} />,
  },
  {
    id: 'sensitivity',
    header: 'Sensitivity',
    accessorFn: (r) => r.manifest.sensitivity,
    cell: ({ row }) => <span className="text-[12.5px] text-text-2">{row.original.manifest.sensitivity}</span>,
  },
  {
    id: 'status',
    header: 'Probe status',
    accessorFn: (r) => r.probeStatus,
    cell: ({ row }) => <ProbeStatusChip status={row.original.probeStatus} owningTeam={row.original.manifest.governance.owner} />,
  },
  {
    id: 'change',
    header: 'Change state',
    accessorFn: (r) => r.changeState,
    cell: ({ row }) => <ChangeStateChip state={row.original.changeState} />,
  },
];

export function CatalogTable({ rows, onOpen }: CatalogTableProps) {
  return (
    <DataTable
      columns={columns}
      data={rows as CatalogTool[]}
      caption="Catalog — tools matching the current facets"
      onRowOpen={(row) => onOpen(row.manifest.id)}
      getRowId={(r) => r.manifest.id}
    />
  );
}
