'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileUpload } from '@/components/forms/file-upload';
import { SignedImage } from '@/components/forms/signed-image';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import type { ImageView, ProductView } from '@/lib/hooks/use-catalog';

/** Attach, reorder, choose the primary and remove product images (Requirement 6.1). */
export function ImagesPanel({
  product,
  readOnly,
  onChanged,
}: {
  product: ProductView;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations('products.images');
  const message = useErrorMessage();
  const [error, setError] = useState<string | null>(null);
  const images = [...(product.images ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      onChanged();
    } catch (e) {
      setError(message(e));
    }
  }

  const move = (index: number, delta: -1 | 1) => {
    const order = images.map((i) => i.id);
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target] as string, order[index] as string];
    return run(() => api.put(`/catalog/products/${product.id}/images/order`, { imageIds: order }));
  };

  return (
    <section aria-labelledby="images-heading" className="flex flex-col gap-3">
      <h2 id="images-heading" className="font-medium">
        {t('title')}
      </h2>
      {error ? <Alert>{error}</Alert> : null}
      {images.length === 0 ? <p className="text-sm text-neutral-600">{t('empty')}</p> : null}
      <ul className="flex flex-wrap gap-4">
        {images.map((image: ImageView, index) => (
          <li key={image.id} className="flex flex-col gap-1">
            <SignedImage
              fileId={image.fileId}
              alt={t('alt', { name: product.name, n: index + 1 })}
            />
            {image.isPrimary ? <span className="text-xs font-medium">{t('primary')}</span> : null}
            {readOnly ? null : (
              <div className="flex flex-wrap gap-1">
                {image.isPrimary ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void run(() => api.post(`/catalog/images/${image.id}/primary`))}
                  >
                    {t('makePrimary')}
                    <span className="sr-only"> {index + 1}</span>
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={index === 0}
                  onClick={() => void move(index, -1)}
                >
                  {t('moveEarlier')}
                  <span className="sr-only"> {index + 1}</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={index === images.length - 1}
                  onClick={() => void move(index, 1)}
                >
                  {t('moveLater')}
                  <span className="sr-only"> {index + 1}</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void run(() => api.delete(`/catalog/images/${image.id}`))}
                >
                  {t('remove')}
                  <span className="sr-only"> {index + 1}</span>
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {readOnly ? null : (
        <FileUpload
          label={t('add')}
          accept="image/jpeg,image/png,image/webp"
          entityType="PRODUCT"
          entityId={product.id}
          purpose="image"
          onUploaded={(file) =>
            void run(() => api.post(`/catalog/products/${product.id}/images`, { fileId: file.id }))
          }
        />
      )}
    </section>
  );
}
