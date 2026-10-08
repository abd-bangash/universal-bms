import { Injectable } from '@nestjs/common';
import type { ReportDefinition } from './reporting.types';
import { FINANCE_REPORTS } from './reports/finance.reports';
import { INVENTORY_REPORTS } from './reports/inventory.reports';
import { LEAD_REPORTS } from './reports/lead.reports';
import { SALES_REPORTS } from './reports/sales.reports';

/** Every report the system can run. Later releases add definitions here; the controller and page stay the same. */
@Injectable()
export class ReportRegistry {
  private readonly definitions = new Map<string, ReportDefinition>();

  constructor() {
    for (const def of [
      ...SALES_REPORTS,
      ...LEAD_REPORTS,
      ...INVENTORY_REPORTS,
      ...FINANCE_REPORTS,
    ]) {
      this.register(def);
    }
  }

  register(def: ReportDefinition): void {
    if (this.definitions.has(def.key)) throw new Error(`Duplicate report ${def.key}`);
    this.definitions.set(def.key, def);
  }

  get(key: string): ReportDefinition | undefined {
    return this.definitions.get(key);
  }

  all(): ReportDefinition[] {
    return [...this.definitions.values()];
  }
}
