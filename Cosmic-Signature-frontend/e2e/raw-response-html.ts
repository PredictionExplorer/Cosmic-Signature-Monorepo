import { JSDOM } from 'jsdom';

/** Read the server response as inert HTML, before the application hydrates it. */
export function firstHeadingText(html: string): string {
  const heading = JSDOM.fragment(html).querySelector('h1');
  return heading?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}
