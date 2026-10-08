'use client';

import { useParams } from 'next/navigation';
import { PageGuard } from '@/components/layout/page-guard';
import { ProductEditor } from '../product-editor';

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <PageGuard permission="product:view">
      <ProductEditor productId={id} />
    </PageGuard>
  );
}
