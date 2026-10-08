'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { MyTasks } from './my-tasks';

export default function TasksPage() {
  return (
    <PageGuard permission="task:view">
      <MyTasks />
    </PageGuard>
  );
}
