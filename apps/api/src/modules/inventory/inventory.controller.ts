import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AppException } from '../../common/errors/app.exception';
import {
  AdjustStockDto,
  CreateLocationDto,
  CreateReasonDto,
  ListFlagQuery,
  ListMovementsQuery,
  ListStockQuery,
  OpeningStockDto,
  UpdateLocationDto,
  UpdateReasonDto,
} from './dto/inventory.dto';
import { StockOperationsService } from './stock-operations.service';

/** Whoever works with stock reads the reasons to choose from. */
const REASON_READERS = ['inventory:view', 'inventory:adjust', 'workspace:configure'];

@ApiTags('inventory')
@ApiBearerAuth()
@Controller()
export class InventoryController {
  constructor(private readonly stock: StockOperationsService) {}

  @Get('inventory/stock')
  @RequirePermission('inventory:view')
  levels(@Query() query: ListStockQuery) {
    return this.stock.stock(query);
  }

  @Get('inventory/movements')
  @RequirePermission('inventory:view')
  movements(@Query() query: ListMovementsQuery) {
    return this.stock.movements(query);
  }

  @Post('inventory/opening-stock')
  @Idempotent()
  @RequirePermission('inventory:adjust')
  openingStock(@CurrentUser() user: AuthUser, @Body() dto: OpeningStockDto) {
    return this.stock.openingStock(user, dto);
  }

  @Post('inventory/movements')
  @Idempotent()
  @RequirePermission('inventory:adjust')
  adjust(@CurrentUser() user: AuthUser, @Body() dto: AdjustStockDto) {
    return this.stock.adjust(user, dto);
  }

  @Get('inventory/locations')
  @RequirePermission('inventory:view')
  locations(@Query() query: ListFlagQuery) {
    return this.stock.locations(query.includeInactive);
  }

  @Post('inventory/locations')
  @RequirePermission('workspace:configure')
  createLocation(@CurrentUser() user: AuthUser, @Body() dto: CreateLocationDto) {
    return this.stock.createLocation(user, dto);
  }

  @Patch('inventory/locations/:id')
  @RequirePermission('workspace:configure')
  updateLocation(@Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.stock.updateLocation(id, dto);
  }

  @Get('settings/adjustment-reasons')
  @Authenticated()
  reasons(@CurrentUser() user: AuthUser, @Query() query: ListFlagQuery) {
    if (!REASON_READERS.some((p) => user.permissions.includes(p))) {
      throw new AppException('PERMISSION_DENIED', 403, 'You do not have permission to do this');
    }
    return this.stock.reasons(query.includeInactive);
  }

  @Post('settings/adjustment-reasons')
  @RequirePermission('workspace:configure')
  createReason(@CurrentUser() user: AuthUser, @Body() dto: CreateReasonDto) {
    return this.stock.createReason(user, dto);
  }

  @Patch('settings/adjustment-reasons/:id')
  @RequirePermission('workspace:configure')
  updateReason(@Param('id') id: string, @Body() dto: UpdateReasonDto) {
    return this.stock.updateReason(id, dto);
  }
}
