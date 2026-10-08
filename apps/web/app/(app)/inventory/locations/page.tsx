'use client';

import { PageGuard } from '@/components/layout/page-guard';
import { LocationManager } from './location-manager';

export default function LocationsPage() {
  return (
    <PageGuard permission="inventory:view">
      <LocationManager />
    </PageGuard>
  );
}
