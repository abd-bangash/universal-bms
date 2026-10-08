'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { ExpenseList } from './expense-list';

export default function ExpensesPage() {
  return (
    <PageGuard permission="expense:view">
      <ExpenseList />
    </PageGuard>
  );
}
