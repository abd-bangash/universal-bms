import type { DemoStep } from '../demo-seed';
import { catalogStep } from './catalog.step';
import { crmStep } from './crm.step';
import { financeStep } from './finance.step';
import { inventoryStep } from './inventory.step';
import { salesStep } from './sales.step';
import { staffStep } from './staff.step';
import { workspaceStep } from './workspace.step';

/** Order matters: later steps work inside the workspace the first one provides. */
export const DEMO_STEPS: readonly DemoStep[] = [
  workspaceStep,
  staffStep,
  catalogStep,
  crmStep,
  inventoryStep,
  salesStep,
  financeStep,
];
