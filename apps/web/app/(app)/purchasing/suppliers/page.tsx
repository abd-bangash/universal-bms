'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { SupplierList } from './supplier-list';

export default function SuppliersPage() {
  return (
    <PageGuard permission="supplier:view">
      <SupplierList />
    </PageGuard>
  );
}
