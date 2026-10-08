'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { AdjustForm, OpeningStockForm } from './adjust-forms';

export default function AdjustPage() {
  return (
    <PageGuard permission="inventory:adjust">
      <div className="flex flex-col gap-10">
        <AdjustForm />
        <OpeningStockForm />
      </div>
    </PageGuard>
  );
}
