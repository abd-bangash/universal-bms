'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { ProductForm } from '../product-form';

export default function NewProductPage() {
  return (
    <PageGuard permission="product:create">
      <ProductForm product={null} />
    </PageGuard>
  );
}
