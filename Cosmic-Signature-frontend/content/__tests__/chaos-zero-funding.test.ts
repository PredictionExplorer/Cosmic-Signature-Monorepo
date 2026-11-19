import { routing } from '@/i18n/routing';
import { formatCount } from '@/utils/format/numbers';

describe('Chaos Zero funding copy at cutover', () => {
  const originalVersion = process.env.NEXT_PUBLIC_CONTRACT_MECHANICS_VERSION;

  afterEach(() => {
    if (originalVersion === undefined) delete process.env.NEXT_PUBLIC_CONTRACT_MECHANICS_VERSION;
    else process.env.NEXT_PUBLIC_CONTRACT_MECHANICS_VERSION = originalVersion;
    jest.resetModules();
  });

  it.each(['3', '4'])('serves mechanics version %s across all locales', async (version) => {
    process.env.NEXT_PUBLIC_CONTRACT_MECHANICS_VERSION = version;
    jest.resetModules();
    const { getFaqContent } = await import('@/content/faq');
    const { getLearnArticle } = await import('@/content/learn');
    const { getLandingContent } = await import('@/content/landing');
    const { getTermsCopy } = await import('@/content/legal');
    for (const locale of routing.locales) {
      const items = getFaqContent(locale).categories.flatMap((category) => category.items);
      const faq = items.find(({ id }) => id === 'cosmic-signature-prediction-market');
      const distribution = getTermsCopy(locale)
        .sections.flatMap((section) => section.content)
        .find((clause) => clause.id === 'distribution');
      const issuanceCopy = [
        items.map(({ answer }) => answer).join(' '),
        getLandingContent(locale).tracks.description,
        distribution?.text,
      ];
      for (const text of issuanceCopy) {
        expect(text).toBeDefined();
        if (version === '4') {
          expect(text).toContain(formatCount(35_000, locale));
          expect(text).toContain('34');
          expect(text).toContain('Chaos Zero');
        } else {
          expect(text).not.toContain(formatCount(35_000, locale));
        }
      }
      const guide = getLearnArticle('collecting-and-trading-cosmic-signature', locale);
      const paragraphs = guide?.sections.flatMap(({ body }) => body).join(' ');
      for (const text of [faq?.answer, paragraphs]) {
        expect(text).toContain('Chaos Zero');
        if (version === '4') {
          expect(text).toContain(formatCount(8000, locale));
          expect(text).toContain(formatCount(1000, locale));
        } else {
          expect(text).not.toContain(formatCount(8000, locale));
        }
      }
    }
  });
});
