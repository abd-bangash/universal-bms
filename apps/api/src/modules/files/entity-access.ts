import type { Permission } from '@bms/types';

export const FILE_ENTITY_TYPES = [
  'PRODUCT',
  'ORDER',
  'ORDER_ITEM',
  'QUOTATION',
  'LEAD',
  'CUSTOMER',
  'EXPENSE',
  'PAYMENT',
  'MESSAGE',
  'IMPORT',
] as const;
export type FileEntityType = (typeof FILE_ENTITY_TYPES)[number];

export const FILE_PURPOSES = ['image', 'reference', 'proof', 'attachment', 'media'] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

/** Permission needed to attach/remove a file on, and to see a file of, each kind of record. */
export const FILE_ENTITY_ACCESS: Record<FileEntityType, { write: Permission; read: Permission }> = {
  PRODUCT: { write: 'product:edit', read: 'product:view' },
  ORDER: { write: 'order:edit', read: 'order:view' },
  ORDER_ITEM: { write: 'order:edit', read: 'order:view' },
  QUOTATION: { write: 'quotation:edit', read: 'quotation:view' },
  LEAD: { write: 'lead:edit', read: 'lead:view' },
  CUSTOMER: { write: 'customer:edit', read: 'customer:view' },
  EXPENSE: { write: 'expense:create', read: 'expense:view' },
  PAYMENT: { write: 'payment:create', read: 'payment:view' },
  MESSAGE: { write: 'conversation:reply', read: 'conversation:view' },
  IMPORT: { write: 'import:run', read: 'import:run' },
};
