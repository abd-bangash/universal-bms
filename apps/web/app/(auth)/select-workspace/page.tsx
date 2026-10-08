import { Suspense } from 'react';
import { WorkspacePicker } from './workspace-picker';

export default function SelectWorkspacePage() {
  return (
    <Suspense>
      <WorkspacePicker />
    </Suspense>
  );
}
