import { Module, type OnModuleInit } from '@nestjs/common';
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
  constructor(private readonly sections: ProfileSectionRegistry) {}

  onModuleInit(): void {
    this.sections.register('categories', applyProfileCategories);
  }
}
