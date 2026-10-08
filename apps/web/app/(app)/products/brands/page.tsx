'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { BrandManager } from '../brand-manager';

export default function BrandsPage() {
  return (
    <PageGuard permission="product:view">
      <BrandManager />
    </PageGuard>
  );
}
