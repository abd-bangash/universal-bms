'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

/** A stored picture, shown through a short-lived signed URL (files are never public). */
export function SignedImage({
  fileId,
  alt,
  className = 'h-28 w-28',
}: {
  fileId: string;
  alt: string;
  className?: string;
}) {
  const url = useQuery({
    queryKey: ['file-url', fileId],
    queryFn: ({ signal }) =>
      api.get<{ url: string; thumbnailUrl: string | null }>(
        `/files/${fileId}/url`,
        undefined,
        signal,
      ),
    staleTime: 4 * 60_000,
  });
  const src = url.data?.thumbnailUrl ?? url.data?.url;
  if (!src) return <div className={`${className} rounded-md bg-neutral-100`} aria-hidden="true" />;
  // Signed storage URLs cannot go through next/image's optimiser.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={`${className} rounded-md object-cover`} />;
}
