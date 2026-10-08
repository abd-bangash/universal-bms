'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { MovementList } from './movement-list';

export default function MovementsPage() {
  return (
    <PageGuard permission="inventory:view">
      <MovementList />
    </PageGuard>
  );
}
