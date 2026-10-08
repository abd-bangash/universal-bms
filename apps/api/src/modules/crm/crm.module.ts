import { Module, type OnModuleInit } from '@nestjs/common';
import { ProfileSectionRegistry, WorkspaceDefaultsRegistry } from '../tenants/registries';
import { applyProfileLostReasons, ensureWalkInCustomer } from './crm-defaults';

/** Customers, Leads, Tasks and the timeline. Services are added by tasks 24, 26 and 27. */
@Module({})
export class CrmModule implements OnModuleInit {
  constructor(
    private readonly defaults: WorkspaceDefaultsRegistry,
    private readonly sections: ProfileSectionRegistry,
  ) {}

  onModuleInit(): void {
    this.defaults.register('walk-in-customer', (tx, ctx) =>
      ensureWalkInCustomer(tx, ctx.workspaceId),
    );
    this.sections.register('lostReasons', applyProfileLostReasons);
  }
}
