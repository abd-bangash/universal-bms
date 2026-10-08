'use client';

import { useParams } from 'next/navigation';
import { PageGuard } from '@/components/layout/page-guard';
import { SupplierDetail } from '../supplier-detail';

export default function SupplierPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PageGuard permission="supplier:view">
      <SupplierDetail supplierId={id} />
    </PageGuard>
  );
}
