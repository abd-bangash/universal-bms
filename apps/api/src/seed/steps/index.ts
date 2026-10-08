import type { DemoStep } from '../demo-seed';
import { staffStep } from './staff.step';
import { workspaceStep } from './workspace.step';

/** Order matters: later steps work inside the workspace the first one provides. */
export const DEMO_STEPS: readonly DemoStep[] = [workspaceStep, staffStep];
