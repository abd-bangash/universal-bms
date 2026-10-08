import { Global, Module, type OnModuleInit } from '@nestjs/common';
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

  onModuleInit(): void {
    // Catalog records exist from task 17; later modules register their own entity types.
    this.usage.register('PRODUCT', async (key) => {
      const rows = await this.prisma.scoped.$queryRaw<Array<{ one: number }>>`
        SELECT 1 AS one FROM products WHERE workspace_id = ${this.workspaceId()} AND jsonb_exists(custom_fields, ${key}) LIMIT 1`;
      return rows.length > 0;
    });
    this.usage.register('VARIANT', async (key) => {
      const rows = await this.prisma.scoped.$queryRaw<Array<{ one: number }>>`
        SELECT 1 AS one FROM product_variants WHERE workspace_id = ${this.workspaceId()} AND jsonb_exists(custom_fields, ${key}) LIMIT 1`;
      return rows.length > 0;
    });
  }
}
