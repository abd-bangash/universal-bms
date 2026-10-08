'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { PosScreen } from './pos-screen';

export default function PosPage() {
  return (
    <PageGuard permission="pos:sell">
      <PosScreen />
    </PageGuard>
  );
}
