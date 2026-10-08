import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PageQueryDto } from '../../common/pagination/pagination';
import { CreateSupplierDto, ListSuppliersQuery, UpdateSupplierDto } from './dto/purchasing.dto';
import { SuppliersService } from './suppliers.service';

class IdParam {
  @IsString() id!: string;
}

@ApiTags('suppliers')
@ApiBearerAuth()
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermission('supplier:view')
  list(@Query() query: ListSuppliersQuery, @Req() req: Request) {
    return this.suppliers.list(query, req.query as Record<string, unknown>);
  }

  @Post()
  @RequirePermission('supplier:create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSupplierDto) {
    return this.suppliers.create(user, dto);
  }

  @Get(':id')
  @RequirePermission('supplier:view')
  get(@Param() p: IdParam) {
    return this.suppliers.get(p.id);
  }

  @Patch(':id')
  @RequirePermission('supplier:edit')
  update(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: UpdateSupplierDto) {
    return this.suppliers.update(user, p.id, dto);
  }

  @Post(':id/archive')
  @RequirePermission('supplier:archive')
  @HttpCode(200)
  archive(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.suppliers.archive(user, p.id);
  }

  @Post(':id/restore')
  @RequirePermission('supplier:archive')
  @HttpCode(200)
  restore(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.suppliers.restore(user, p.id);
  }

  @Get(':id/purchases')
  @RequirePermission('purchase:view')
  purchases(@Param() p: IdParam, @Query() query: PageQueryDto) {
    return this.suppliers.purchases(p.id, query.limit, query.cursor);
  }
}
