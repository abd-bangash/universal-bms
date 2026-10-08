import { Module, type OnModuleInit } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SearchService } from '../search/search.service';
import { productSearch } from './catalog-search';
import { ProfileSectionRegistry } from '../tenants/registries';
import { BrandsService } from './brands.service';
import { applyProfileCategories } from './catalog-profile.section';
import { CatalogController } from './catalog.controller';
import { CategoriesService } from './categories.service';
import { ProductImagesService } from './product-images.service';
import { ProductsService } from './products.service';
import { VariantLookupService } from './variant-lookup.service';

@Module({
  controllers: [CatalogController],
  providers: [
    ProductsService,
    CategoriesService,
    BrandsService,
    ProductImagesService,
    VariantLookupService,
  ],
  exports: [ProductsService, CategoriesService, VariantLookupService, ProductImagesService],
})
export class CatalogModule implements OnModuleInit {
  constructor(
    private readonly sections: ProfileSectionRegistry,
    private readonly search: SearchService,
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  onModuleInit(): void {
    this.sections.register('categories', applyProfileCategories);
    this.search.register(productSearch(this.prisma, this.cls));
  }
}
