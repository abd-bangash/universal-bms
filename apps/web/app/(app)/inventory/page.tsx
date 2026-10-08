'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { StockTable } from './stock-table';

export default function InventoryPage() {
  return (
    <PageGuard permission="inventory:view">
      <StockTable />
    </PageGuard>
  );
}
