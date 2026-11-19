import { expect, test, type Page } from '@playwright/test';

import { mockZhQualityApi } from './zh-quality-mocks';
import { ZH_ROUTE_FIXTURES } from './zh-route-inventory';

declare global {
  interface Window {
    __sprint8Performance?: {
      cls: number;
      initialCls: number;
      fontWidthShift: number;
      longTasks: number;
    };
  }
}

const VIEWPORTS = [
  { name: 'mobile-320', width: 320, height: 800 },
  { name: 'desktop-1440', width: 1_440, height: 1_000 },
] as const;

const HAN_PROBE = '中文字体锚定落笔演绎周期';
const PROBE_ID = 'sprint8-cjk-font-probe';

async function renderedFonts(page: Page) {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    const { root } = await client.send('DOM.getDocument');
    const { nodeId } = await client.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '#' + PROBE_ID,
    });
    const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId });
    return fonts;
  } finally {
    await client.detach();
  }
}

// font-display:optional keeps the platform fallback for the lifetime of a slow
// document. Use the Chinese page's own stylesheet in a fresh same-origin
// document to verify the shipped SC face when it is ready before first paint.
async function checkWarmFace(page: Page) {
  const stylesheets = await page.evaluate(() =>
    [...document.styleSheets]
      .filter((sheet) => sheet.href && new URL(sheet.href).origin === location.origin)
      .filter((sheet) =>
        [...sheet.cssRules].some(
          (rule) =>
            rule instanceof CSSFontFaceRule && rule.style.fontFamily.includes('Noto Sans SC'),
        ),
      )
      .map((sheet) => sheet.href!),
  );
  expect(stylesheets.length, 'SC font declarations linked by the Chinese route').toBeGreaterThan(0);
  const warm = await page.context().newPage();
  try {
    const url = new URL('/__e2e__/cjk-font-probe', page.url()).href;
    await warm.route(url, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html lang="zh"><body></body></html>',
      }),
    );
    await warm.goto(url);
    for (const url of stylesheets) await warm.addStyleTag({ url });
    await warm.evaluate(
      async ({ id, text }) => {
        const font = '700 32px "Noto Sans SC"';
        await document.fonts.load(font, text);
        const probe = document.createElement('span');
        probe.id = id;
        probe.style.font = font;
        probe.textContent = text;
        document.body.append(probe);
      },
      { id: PROBE_ID, text: HAN_PROBE },
    );
    const fonts = await renderedFonts(warm);
    const scGlyphs = fonts
      .filter((font) => font.isCustomFont && /^Noto Sans SC(?:$| )/i.test(font.familyName))
      .reduce((total, font) => total + font.glyphCount, 0);
    expect(scGlyphs, 'every Han glyph must be painted by the self-hosted SC face').toBe(
      HAN_PROBE.length,
    );
  } finally {
    await warm.close();
  }
}

test.describe('Sprint 8 Chinese font and performance guard', () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} uses the approved CJK stack without unstable layout`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(() => {
        window.__sprint8Performance = {
          cls: 0,
          initialCls: 0,
          fontWidthShift: 0,
          longTasks: 0,
        };

        if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const shift = entry as PerformanceEntry & {
                hadRecentInput?: boolean;
                value?: number;
              };
              if (!shift.hadRecentInput) {
                window.__sprint8Performance!.cls += shift.value ?? 0;
              }
            }
          }).observe({ type: 'layout-shift', buffered: true });
        }

        if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
          new PerformanceObserver((list) => {
            window.__sprint8Performance!.longTasks += list.getEntries().length;
          }).observe({ type: 'longtask', buffered: true });
        }
      });

      const fontResponses: Array<{ url: string; status: number }> = [];
      await page.route(/\.(?:woff2?|ttf)(?:\?|$)/i, async (route) => {
        // Make the fallback frame observable without introducing a heavy
        // synthetic throttling dependency.
        await new Promise((resolve) => setTimeout(resolve, 250));
        await route.continue();
      });
      page.on('response', (response) => {
        if (/\.(?:woff2?|ttf)(?:\?|$)/i.test(response.url())) {
          fontResponses.push({ url: response.url(), status: response.status() });
        }
      });

      await mockZhQualityApi(page);
      const response = await page.goto('/zh', { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBe(200);

      const coldText = 'Noto' + HAN_PROBE;
      await page.evaluate(
        async ({ id, text }) => {
          const probe = document.createElement('span');
          probe.id = id;
          probe.textContent = text;
          probe.style.cssText =
            "position:fixed;left:0;top:0;opacity:0;pointer-events:none;font-family:var(--font-noto-sc),'PingFang SC','Microsoft YaHei',sans-serif;font-size:32px;font-weight:700;line-height:1.4";
          document.body.appendChild(probe);
          const fallbackWidth = probe.getBoundingClientRect().width;
          await document.fonts.ready;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          const loadedWidth = probe.getBoundingClientRect().width;
          window.__sprint8Performance!.fontWidthShift =
            fallbackWidth === 0 ? 0 : Math.abs(loadedWidth - fallbackWidth) / fallbackWidth;
        },
        { id: PROBE_ID, text: coldText },
      );
      // The home is ISR: its HTML carries the live backend's seed, which the
      // mocked cycle then replaces on hydration (a different phase and
      // gesture count, so a different header). That swap is data, not type,
      // so the settled window opens once the mocked cycle is on screen.
      await expect(page.getByTestId('home-deck-header')).toContainText(
        `第 ${ZH_ROUTE_FIXTURES.cycle} 个周期`,
      );
      await page.evaluate(async () => {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        window.__sprint8Performance!.initialCls = window.__sprint8Performance!.cls;
        window.__sprint8Performance!.cls = 0;
      });
      await page.waitForTimeout(500);

      const coldFonts = await renderedFonts(page);

      const metrics = await page.evaluate(() => {
        const navigation = performance.getEntriesByType(
          'navigation',
        )[0] as PerformanceNavigationTiming;
        const bodyStyle = getComputedStyle(document.body);
        const heading = [...document.querySelectorAll<HTMLElement>('h1, h2, h3')].find(
          (element) => element.offsetParent !== null && /[\u3400-\u9fff]/.test(element.innerText),
        );
        const headingStyle = heading ? getComputedStyle(heading) : null;
        return {
          settledCls: window.__sprint8Performance?.cls ?? 0,
          initialCls: window.__sprint8Performance?.initialCls ?? 0,
          fontWidthShift: window.__sprint8Performance?.fontWidthShift ?? 0,
          longTasks: window.__sprint8Performance?.longTasks ?? 0,
          domContentLoadedMs: navigation.domContentLoadedEventEnd,
          bodyFont: bodyStyle.fontFamily,
          notoVariable: getComputedStyle(document.documentElement)
            .getPropertyValue('--font-noto-sc')
            .trim(),
          notoFaces: [...document.fonts]
            .filter((face) => /noto/i.test(face.family))
            .map((face) => ({ family: face.family, status: face.status })),
          headingFound: Boolean(heading),
          headingLetterSpacing: headingStyle?.letterSpacing ?? '',
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });

      expect(
        coldFonts.reduce((total, font) => total + font.glyphCount, 0),
        'the slow-load font stack must paint the entire probe',
      ).toBe(coldText.length);
      expect(metrics.bodyFont).toMatch(/Noto Sans SC/);
      expect(metrics.bodyFont).toMatch(/PingFang SC/);
      expect(metrics.bodyFont).toMatch(/Microsoft YaHei/);
      expect(metrics.notoVariable).not.toBe('');
      expect(metrics.notoFaces.some((face) => face.status === 'loaded')).toBe(true);
      expect(metrics.headingFound).toBe(true);
      expect(['normal', '0px']).toContain(metrics.headingLetterSpacing);
      expect(metrics.fontWidthShift).toBeLessThanOrEqual(0.08);
      expect(metrics.settledCls).toBeLessThanOrEqual(0.05);
      expect(metrics.initialCls).toBeLessThanOrEqual(1.25);
      expect(metrics.domContentLoadedMs).toBeLessThan(15_000);
      expect(metrics.longTasks).toBeLessThanOrEqual(20);
      expect(metrics.overflow).toBeLessThanOrEqual(1);

      expect(fontResponses.length, 'expected local webfont responses').toBeGreaterThan(0);
      expect(fontResponses.filter((font) => font.status >= 400)).toEqual([]);
      await checkWarmFace(page);
    });
  }
});
