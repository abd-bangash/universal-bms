'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { AccountsManager } from './accounts-manager';

export default function AccountsPage() {
  return (
    <PageGuard permission="account:view">
      <AccountsManager />
    </PageGuard>
  );
}
