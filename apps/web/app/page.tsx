import { useTranslations } from 'next-intl';

export default function HomePage() {
  const t = useTranslations('home');
  return <main className="p-6 text-xl">{t('title')}</main>;
}
