'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import type { ProductView } from '@/lib/hooks/use-catalog';
import { ProductForm } from './product-form';

export const productKey = (id: string) => ['catalog', 'product', id] as const;

/** Loads one product and shows the editor with its variants and images. */
export function ProductEditor({ productId }: { productId: string }) {
  const t = useTranslations('products');
  const message = useErrorMessage();
  const product = useQuery({
    queryKey: productKey(productId),
    queryFn: ({ signal }) =>
      api.get<ProductView>(`/catalog/products/${productId}`, undefined, signal),
  });

  if (product.isPending) return <p role="status">{t('loading')}</p>;
  if (product.isError) return <Alert>{message(product.error)}</Alert>;
  return <ProductForm key={product.data.id} product={product.data} />;
}
