import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AppException } from '../../common/errors/app.exception';
import {
  CreateExpenseCategoryDto,
  CreateExpenseDto,
  ListExpenseCategoriesQuery,
  ListExpensesQuery,
  UpdateExpenseCategoryDto,
  VoidExpenseDto,
} from './dto/expenses.dto';
import { ExpensesService } from './expenses.service';

class IdParam {
  @IsString() id!: string;
}

@ApiTags('expenses')
@ApiBearerAuth()
@Controller()
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  // Whoever records or reads expenses picks a category, so the list is open to them
  @Get('settings/expense-categories')
  @Authenticated()
  categories(@CurrentUser() user: AuthUser, @Query() query: ListExpenseCategoriesQuery) {
    if (
      !['expense:view', 'expense:create', 'workspace:configure'].some((p) =>
        user.permissions.includes(p),
      )
    ) {
      throw new AppException('PERMISSION_DENIED', 403, 'You do not have permission to do this');
    }
    return this.expenses.listCategories(query.includeInactive);
  }

  @Post('settings/expense-categories')
  @RequirePermission('workspace:configure')
  createCategory(@CurrentUser() user: AuthUser, @Body() dto: CreateExpenseCategoryDto) {
    return this.expenses.createCategory(user, dto);
  }

  @Patch('settings/expense-categories/:id')
  @RequirePermission('workspace:configure')
  updateCategory(@Param() p: IdParam, @Body() dto: UpdateExpenseCategoryDto) {
    return this.expenses.updateCategory(p.id, dto);
  }

  @Get('expenses')
  @RequirePermission('expense:view')
  list(@Query() query: ListExpensesQuery) {
    return this.expenses.list(query);
  }

  @Post('expenses')
  @RequirePermission('expense:create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateExpenseDto) {
    return this.expenses.create(user, dto);
  }

  @Get('expenses/:id')
  @RequirePermission('expense:view')
  get(@Param() p: IdParam) {
    return this.expenses.get(p.id);
  }

  @Post('expenses/:id/void')
  @RequirePermission('expense:void')
  @HttpCode(200)
  void(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: VoidExpenseDto) {
    return this.expenses.void(user, p.id, dto.reason);
  }
}
