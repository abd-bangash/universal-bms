import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { BrandsService } from './brands.service';
import { CategoriesService } from './categories.service';
import {
  ArchiveProductDto,
  AttachImageDto,
  CreateBrandDto,
  CreateCategoryDto,
  CreateProductDto,
  GenerateVariantsDto,
  ListProductsQuery,
  LookupQuery,
  ReorderImagesDto,
  SearchVariantsQuery,
  UpdateBrandDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateVariantDto,
  VariantInputDto,
} from './dto/catalog.dto';
import { ProductImagesService } from './product-images.service';
import { ProductsService } from './products.service';
import { VariantLookupService } from './variant-lookup.service';

class IdParam {
  @IsString() id!: string;
}
class ListInactiveQuery {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  includeInactive?: boolean;
}

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
    private readonly brands: BrandsService,
    private readonly images: ProductImagesService,
    private readonly lookup: VariantLookupService,
  ) {}

  // ── products ──
  @Get('products')
  @RequirePermission('product:view')
  list(@CurrentUser() user: AuthUser, @Query() query: ListProductsQuery, @Req() req: Request) {
    return this.products.list(user, query, req.query as Record<string, unknown>);
  }

  @Post('products')
  @RequirePermission('product:create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProductDto) {
    return this.products.create(user, dto);
  }

  @Get('products/:id')
  @RequirePermission('product:view')
  get(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.products.get(user, p.id);
  }

  @Patch('products/:id')
  @RequirePermission('product:edit')
  update(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: UpdateProductDto) {
    return this.products.update(user, p.id, dto);
  }

  @Post('products/:id/archive')
  @RequirePermission('product:archive')
  @HttpCode(200)
  archive(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: ArchiveProductDto) {
    return this.products.archive(user, p.id, dto.version);
  }

  // ── variants ──
  @Post('products/:id/variants')
  @RequirePermission('product:edit')
  addVariant(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: VariantInputDto) {
    return this.products.addVariant(user, p.id, dto);
  }

  @Patch('variants/:id')
  @RequirePermission('product:edit')
  updateVariant(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: UpdateVariantDto) {
    return this.products.updateVariant(user, p.id, dto);
  }

  @Post('products/:id/generate-variants')
  @RequirePermission('product:edit')
  @HttpCode(200)
  generate(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: GenerateVariantsDto) {
    return this.products.generateVariants(user, p.id, dto);
  }

  @Get('variants/lookup')
  @RequirePermission('product:view')
  findByCode(@Query() query: LookupQuery) {
    return this.lookup.lookup(query.code);
  }

  @Get('variants/search')
  @RequirePermission('product:view')
  search(@Query() query: SearchVariantsQuery) {
    return this.lookup.search(query.q, query.limit, query.channel);
  }

  // ── images ──
  @Get('products/:id/images')
  @RequirePermission('product:view')
  listImages(@Param() p: IdParam) {
    return this.images.list(p.id);
  }

  @Post('products/:id/images')
  @RequirePermission('product:edit')
  attachImage(@CurrentUser() user: AuthUser, @Param() p: IdParam, @Body() dto: AttachImageDto) {
    return this.images.attach(user, p.id, dto);
  }

  @Put('products/:id/images/order')
  @RequirePermission('product:edit')
  reorderImages(@Param() p: IdParam, @Body() dto: ReorderImagesDto) {
    return this.images.reorder(p.id, dto);
  }

  @Post('images/:id/primary')
  @RequirePermission('product:edit')
  @HttpCode(200)
  primaryImage(@Param() p: IdParam) {
    return this.images.setPrimary(p.id);
  }

  @Delete('images/:id')
  @RequirePermission('product:edit')
  @HttpCode(204)
  async removeImage(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    await this.images.remove(user, p.id);
  }

  // ── categories and brands ──
  @Get('categories')
  @RequirePermission('product:view')
  categoryTree(@Query() query: ListInactiveQuery) {
    return this.categories.tree(query.includeInactive);
  }

  @Post('categories')
  @RequirePermission('product:edit')
  createCategory(@CurrentUser() user: AuthUser, @Body() dto: CreateCategoryDto) {
    return this.categories.create(user, dto);
  }

  @Patch('categories/:id')
  @RequirePermission('product:edit')
  updateCategory(@Param() p: IdParam, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(p.id, dto);
  }

  @Get('brands')
  @RequirePermission('product:view')
  listBrands(@Query() query: ListInactiveQuery) {
    return this.brands.list(query.includeInactive);
  }

  @Post('brands')
  @RequirePermission('product:edit')
  createBrand(@CurrentUser() user: AuthUser, @Body() dto: CreateBrandDto) {
    return this.brands.create(user, dto);
  }

  @Patch('brands/:id')
  @RequirePermission('product:edit')
  updateBrand(@Param() p: IdParam, @Body() dto: UpdateBrandDto) {
    return this.brands.update(p.id, dto);
  }
}
