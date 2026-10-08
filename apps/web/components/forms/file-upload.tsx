'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';

export interface UploadedFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  hasThumbnail: boolean;
}

/**
 * Uploads one file through the BFF. The server decides whether the type is allowed (it reads the
 * file's content); the size is pre-checked here only to save the round trip.
 */
export function FileUpload({
  label,
  accept = 'image/jpeg,image/png,image/webp,application/pdf',
  maxMb = 10,
  entityType,
  entityId,
  purpose,
  onUploaded,
}: {
  label?: string;
  accept?: string;
  maxMb?: number;
  entityType?: string;
  entityId?: string;
  purpose?: string;
  onUploaded: (file: UploadedFile) => void;
}) {
  const t = useTranslations('upload');
  const message = useErrorMessage();
  const inputId = useId();
  const [state, setState] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [info, setInfo] = useState<string | null>(null);

  async function handle(file: File) {
    if (file.size > maxMb * 1024 * 1024) {
      setState('error');
      setInfo(t('tooLarge', { max: maxMb }));
      return;
    }
    setState('uploading');
    setInfo(null);
    const form = new FormData();
    form.set('file', file);
    if (entityType && entityId) {
      form.set('entityType', entityType);
      form.set('entityId', entityId);
    }
    if (purpose) form.set('purpose', purpose);
    try {
      const uploaded = await api.upload<UploadedFile>('/files', form);
      setState('done');
      setInfo(t('uploaded', { name: uploaded.name }));
      onUploaded(uploaded);
    } catch (error) {
      setState('error');
      setInfo(message(error));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        id={inputId}
        type="file"
        accept={accept}
        className="sr-only"
        disabled={state === 'uploading'}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handle(file);
          event.target.value = '';
        }}
      />
      <Button type="button" variant="outline" asChild>
        <label htmlFor={inputId} className="cursor-pointer">
          {state === 'uploading' ? t('uploading') : (label ?? t('choose'))}
        </label>
      </Button>
      {info ? <Alert tone={state === 'error' ? 'error' : 'success'}>{info}</Alert> : null}
    </div>
  );
}
