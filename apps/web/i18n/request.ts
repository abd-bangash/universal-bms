import { getRequestConfig } from 'next-intl/server';

/** English at launch; further languages add a messages file and a locale switch (Requirement 49.7). */
export default getRequestConfig(async () => {
  const locale = 'en';
  return { locale, messages: (await import(`../messages/${locale}.json`)).default };
});
