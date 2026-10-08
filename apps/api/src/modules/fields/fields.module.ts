import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FieldUsageRegistry } from './field-usage.registry';
import { FieldsController } from './fields.controller';
import { FieldsService } from './fields.service';

@Global()
@Module({
  controllers: [FieldsController],
  providers: [FieldsService, FieldUsageRegistry],
  exports: [FieldsService, FieldUsageRegistry],
})
export class FieldsModule implements OnModuleInit {
  constructor(
    private readonly usage: FieldUsageRegistry,
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  private workspaceId(): string {
    const id = this.cls.get('workspaceId');
    if (!id) throw new Error('No workspace in context');
    return id;
  }

  /** Whether any record of the workspace carries a value for the key. Table names are fixed here. */
  private usedIn(table: 'products' | 'product_variants' | 'customers' | 'leads') {
    return async (key: string): Promise<boolean> => {
      const rows = await this.prisma.scoped.$queryRaw<Array<{ one: number }>>`
        SELECT 1 AS one FROM ${Prisma.raw(table)}
        WHERE workspace_id = ${this.workspaceId()} AND jsonb_exists(custom_fields, ${key}) LIMIT 1`;
      return rows.length > 0;
    };
  }

  onModuleInit(): void {
    // Modules that store custom field values register their entity type here; the other types
    // (orders, quotations, suppliers ...) are added by the tasks that create their tables.
    this.usage.register('PRODUCT', this.usedIn('products'));
    this.usage.register('VARIANT', this.usedIn('product_variants'));
    this.usage.register('CUSTOMER', this.usedIn('customers'));
    this.usage.register('LEAD', this.usedIn('leads'));
  }
}
