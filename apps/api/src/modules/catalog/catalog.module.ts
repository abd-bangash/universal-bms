import { Module } from '@nestjs/common';
import { BrandsService } from './brands.service';
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
  exports: [ProductsService, CategoriesService, VariantLookupService],
})
export class CatalogModule {}
