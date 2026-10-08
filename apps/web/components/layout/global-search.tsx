'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { useTerminology } from '@/lib/terminology';
import { cn } from '@/lib/utils';

interface Hit {
  id: string;
  type: string;
  title: string;
  subtitle: string | null;
  href: string;
}
interface Group {
  type: string;
  hits: Hit[];
}

const DELAY_MS = 250;
const MIN_LENGTH = 2;

/**
 * The header search box (Requirement 31): results grouped by type, reachable by keyboard.
 * Arrow keys move through the results, Enter opens one, Escape closes the list, "/" focuses the box.
 */
export function GlobalSearch() {
  const t = useTranslations('shell.search');
  const term = useTerminology();
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  // "/" jumps to the search box from anywhere that is not a text field.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const enabled = query.length >= MIN_LENGTH;
  const results = useQuery({
    queryKey: ['search', query],
    queryFn: ({ signal }) =>
      api.get<{ query: string; groups: Group[] }>('/search', { q: query }, signal),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
  const groups = useMemo(
    () => (enabled ? (results.data?.groups ?? []) : []),
    [enabled, results.data],
  );
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);

  useEffect(() => setActive(-1), [query]);

  const label = (type: string): string =>
    type === 'CUSTOMER'
      ? term('customer', 'plural')
      : type === 'LEAD'
        ? term('lead', 'plural')
        : type === 'PRODUCT'
          ? term('product', 'plural')
          : t(`types.${type}` as never);

  function go(hit: Hit) {
    setOpen(false);
    setText('');
    setQuery('');
    router.push(hit.href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (flat.length === 0 ? -1 : (i + 1) % flat.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (flat.length === 0 ? -1 : i <= 0 ? flat.length - 1 : i - 1));
    } else if (event.key === 'Enter') {
      const hit = flat[active];
      if (hit) {
        event.preventDefault();
        go(hit);
      }
    } else if (event.key === 'Escape') {
      if (open) event.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  const showPanel = open && enabled;
  const status = results.isFetching
    ? t('searching')
    : results.isError
      ? t('failed')
      : groups.length === 0
        ? t('none', { query })
        : t('count', { count: flat.length });

  let index = -1;
  return (
    <div className="relative w-full">
      <label htmlFor={`${listId}-input`} className="sr-only">
        {t('label')}
      </label>
      <Input
        ref={inputRef}
        id={`${listId}-input`}
        type="search"
        role="combobox"
        autoComplete="off"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        placeholder={t('placeholder')}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      <div
        id={listId}
        role="listbox"
        aria-label={t('results')}
        hidden={!showPanel}
        className="absolute left-0 right-0 top-full z-40 mt-1 max-h-96 overflow-y-auto rounded-md border border-neutral-200 bg-white p-1 shadow-lg"
      >
        <p role="status" className="px-2 py-1 text-xs text-neutral-600">
          {showPanel ? status : ''}
        </p>
        {groups.map((group) => (
          <div key={group.type} role="group" aria-label={label(group.type)}>
            <p
              className="px-2 pt-2 text-xs font-semibold uppercase tracking-wide text-neutral-600"
              aria-hidden="true"
            >
              {label(group.type)}
            </p>
            {group.hits.map((hit) => {
              index += 1;
              const position = index;
              return (
                <div
                  key={hit.id}
                  id={`${listId}-${position}`}
                  role="option"
                  aria-selected={active === position}
                  className={cn(
                    'cursor-pointer rounded px-2 py-1.5 text-sm',
                    active === position ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-100',
                  )}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    go(hit);
                  }}
                  onMouseEnter={() => setActive(position)}
                >
                  <span className="block truncate font-medium">{hit.title}</span>
                  {hit.subtitle ? (
                    <span
                      className={cn(
                        'block truncate text-xs',
                        active === position ? 'text-neutral-200' : 'text-neutral-600',
                      )}
                    >
                      {hit.subtitle}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
