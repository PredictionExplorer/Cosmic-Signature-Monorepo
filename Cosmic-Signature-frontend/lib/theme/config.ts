/** Stable preference IDs; palettes live in styles/themes.css and names in common.json. */
export const SITE_THEMES = ['midnight', 'classic-blue', 'aurora', 'nebula', 'ember'] as const;
export type SiteTheme = (typeof SITE_THEMES)[number];
export const DEFAULT_SITE_THEME: SiteTheme = 'midnight';
export const THEME_STORAGE_KEY = 'cosmic-signature-theme';
export const THEME_COOKIE_NAME = 'cs_theme';
export const THEME_CHANGE_EVENT = 'cosmic-signature:theme';

/**
 * Mobile browser chrome (`<meta name="theme-color">`) per palette: each
 * palette's `--background` as hex, so the toolbar blends into the page from
 * the first paint instead of flashing a colour of its own. The bootstrap
 * below writes it before paint; lib/theme/__tests__/config.test.ts checks
 * every entry against styles/themes.css.
 */
export const THEME_CHROME: Readonly<Record<SiteTheme, `#${string}`>> = {
  midnight: '#090a11',
  'classic-blue': '#0a0d24',
  aurora: '#0c1518',
  nebula: '#140f1a',
  ember: '#15110f',
};

export function isSiteTheme(value: unknown): value is SiteTheme {
  return typeof value === 'string' && SITE_THEMES.includes(value as SiteTheme);
}

export function themeFromCookie(cookie: string): SiteTheme | undefined {
  const value = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${THEME_COOKIE_NAME}=`))
    ?.slice(THEME_COOKIE_NAME.length + 1);
  return isSiteTheme(value) ? value : undefined;
}

/** Share only with our own sibling hosts. Preview hosts and localhost stay host-only. */
export function themeCookieString(theme: SiteTheme, hostname: string, secure: boolean): string {
  const domain = ['cosmicsignature.com', 'cosmicsignature.local'].find(
    (base) => hostname === base || hostname.endsWith(`.${base}`),
  );
  return [
    `${THEME_COOKIE_NAME}=${theme}`,
    'Path=/',
    'Max-Age=31536000',
    'SameSite=Lax',
    ...(domain ? [`Domain=${domain}`] : []),
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

/** React serializes these values as HTML attributes on the bootstrap script. */
export const THEME_SCRIPT_ATTRIBUTES = {
  'data-cookie-name': THEME_COOKIE_NAME,
  'data-storage-key': THEME_STORAGE_KEY,
  'data-default-theme': DEFAULT_SITE_THEME,
  'data-colors': JSON.stringify(THEME_CHROME),
};

/**
 * Synchronous script in the shared document head. The code is constant; preferences
 * and palette configuration are read as data. The cross-host cookie takes priority.
 */
export const THEME_INIT_SCRIPT = `(() => {
  const {cookieName, storageKey, defaultTheme, colors} = document.currentScript.dataset;
  const palette = JSON.parse(colors);
  const known = (value) => typeof value === 'string' && Object.hasOwn(palette, value);
  let theme;
  try {
    const prefix = cookieName + '=';
    theme = document.cookie.split(';').map(part => part.trim())
      .find(part => part.startsWith(prefix))?.slice(prefix.length);
  } catch {}
  if (!known(theme)) {
    try { theme = localStorage.getItem(storageKey); } catch {}
  }
  if (!known(theme)) theme = defaultTheme;
  document.documentElement.dataset.theme = theme;
  try {
    document.querySelectorAll('meta[name="theme-color"]')
      .forEach(meta => meta.setAttribute('content', palette[theme]));
  } catch {}
})()`;
