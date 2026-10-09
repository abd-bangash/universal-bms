'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input, Textarea } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { useKnowledge, type KnowledgeItemView } from '@/lib/hooks/use-ai';

/** The business's approved answers and policies; only active ones are given to the assistant. */
export function KnowledgeManager() {
  const t = useTranslations('ai.knowledge');
  const s = useTranslations('ai.settings');
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const items = useKnowledge();
  const [editing, setEditing] = useState<KnowledgeItemView | 'new' | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<KnowledgeItemView | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ai', 'knowledge'] });
  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await refresh();
      setEditing(null);
    } catch (e) {
      setError(message(e));
    }
  }
  function start(item: KnowledgeItemView | 'new') {
    setEditing(item);
    setTitle(item === 'new' ? '' : item.title);
    setBody(item === 'new' ? '' : item.body);
  }

  return (
    <section aria-labelledby="knowledge-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="knowledge-heading" className="font-medium">
          {s('knowledgeTitle')}
        </h2>
        <p className="text-sm text-neutral-600">{s('knowledgeHelp')}</p>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {items.data && items.data.length === 0 ? (
        <p className="text-sm text-neutral-600">{t('none')}</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {(items.data ?? []).map((k) => (
          <li key={k.id} className="rounded-md border border-neutral-200 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{k.title}</span>
              <span className="flex items-center gap-2">
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={k.active}
                    aria-label={`${t('active')}: ${k.title}`}
                    onChange={(e) =>
                      void act(() =>
                        api.patch(`/ai/knowledge/${k.id}`, { active: e.target.checked }),
                      )
                    }
                  />
                  {k.active ? t('active') : t('off')}
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => start(k)}
                  aria-label={`${t('edit')} ${k.title}`}
                >
                  {t('edit')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRemoving(k)}
                  aria-label={`${t('delete')} ${k.title}`}
                >
                  {t('delete')}
                </Button>
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-neutral-700">{k.body}</p>
          </li>
        ))}
      </ul>
      {editing ? (
        <form
          aria-label={editing === 'new' ? t('new') : t('edit')}
          className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() =>
              editing === 'new'
                ? api.post('/ai/knowledge', { title: title.trim(), body: body.trim() })
                : api.patch(`/ai/knowledge/${editing.id}`, {
                    title: title.trim(),
                    body: body.trim(),
                  }),
            );
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            {t('title')}
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t('body')}
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              rows={4}
              maxLength={4000}
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={!title.trim() || !body.trim()}>
              {t('save')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button variant="outline" onClick={() => start('new')}>
            {t('add')}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        title={t('deleteTitle')}
        description={t('deleteBody')}
        confirmLabel={t('delete')}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const item = removing;
          setRemoving(null);
          if (item) void act(() => api.delete(`/ai/knowledge/${item.id}`));
        }}
      />
    </section>
  );
}
