'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { RolesManager } from './roles-manager';

export default function RolesPage() {
  return (
    <PageGuard permission="role:view">
      <RolesManager />
    </PageGuard>
  );
}
