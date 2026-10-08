'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { CategoryManager } from '../category-manager';

export default function CategoriesPage() {
  return (
    <PageGuard permission="product:view">
      <CategoryManager />
    </PageGuard>
  );
}
