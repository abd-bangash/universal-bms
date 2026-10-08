'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { ProductList } from './product-list';

export default function ProductsPage() {
  return (
    <PageGuard permission="product:view">
      <ProductList />
    </PageGuard>
  );
}
