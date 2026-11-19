import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { GOOGLE_FONTS_COMMIT, type FontSource } from './build-og-fonts-core';
import { publishGeneratedFile } from './publish-generated-file';

/** Sizes and SHA-512 digests of the individual blobs at GOOGLE_FONTS_COMMIT. */
const pinnedFonts: Readonly<Record<string, { size: number; integrity: string }>> = {
  'ofl/inter/Inter[opsz,wght].ttf': {
    size: 876576,
    integrity:
      'sha512-O3HSygsLdknZOfmC/luXPJE8SwqJ4bB+prix/PX4yPJbXPKTk2+Tax6LQ4MeqXa9ghUc0K0NKEeyVPajrAt/nA==',
  },
  'ofl/jetbrainsmono/JetBrainsMono[wght].ttf': {
    size: 187208,
    integrity:
      'sha512-q4YgAynFImSEwA3XmsSbiZTJH3X6fEyhRrMNTJubJYmvRKbRphBA0Uu2JKt/Ft0Pln2uFc47JOWRWPeU7oV/VA==',
  },
  'ofl/notosanshk/NotoSansHK[wght].ttf': {
    size: 11905808,
    integrity:
      'sha512-BbIgRWc9v9Ond2LBHXB8d2wUYviZmQWHzSUJVvJrt1BUBRTscig1C9xkb22Yf/fcTS/QK42a7DNelqxW3kY/Gg==',
  },
  'ofl/notosansjp/NotoSansJP[wght].ttf': {
    size: 9589900,
    integrity:
      'sha512-7JtsooI6BiQl3x/hdDU56JlGj1rX4rvgEmizRxqy2odmWzQBusc2oOW7RT9YgnfsjiLDCRkR8oftazD6CtxDRg==',
  },
  'ofl/notosanskr/NotoSansKR[wght].ttf': {
    size: 10414588,
    integrity:
      'sha512-wCHxbgjMkU35wIOVmyI2cgQNTWY5d8NToHTVG9EjqKyjUNCjrOl2CtcqjZIpQqfg9c8gOqRN0uw1fJkHqBqcWQ==',
  },
  'ofl/notosanssc/NotoSansSC[wght].ttf': {
    size: 17772300,
    integrity:
      'sha512-pVzB6yTR6EVp3ZpPlM0Ltjo5CJWVHQPpLV2h3rL074GiB1VuPNv/EpEPoJNAKQucdi6XgozAJcuGxJvIMkpYQA==',
  },
  'ofl/notosanstc/NotoSansTC[wght].ttf': {
    size: 11941968,
    integrity:
      'sha512-OvU9AmMXmE9RRqS3DDhqEcjRWUitkygy9ubrVwUICfrErS/JM6GX7E4z6er+ktz7s7qg70m3mvslu9AUEZn9bQ==',
  },
  'ofl/onest/Onest[wght].ttf': {
    size: 193056,
    integrity:
      'sha512-Lv2oelKlJH4Pg/qQR9zwqziGhqUT17l5i5t6q/Yjbzfogu6F0JEvJKNuLPAgU4RX4pnJurdtIKPLs00dhBU8OQ==',
  },
};

function hasCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException)?.code === code;
}

/** Bound the response even when a server omits Content-Length. */
async function download(path: string, size: number): Promise<Buffer> {
  const url = new URL(
    GOOGLE_FONTS_COMMIT + '/' + path,
    'https://raw.githubusercontent.com/google/fonts/',
  );
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body)
    throw new Error(`Font download failed: HTTP ${response.status} (${path})`);
  const reader = response.body.getReader();
  const bytes = Buffer.alloc(size);
  let offset = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value.byteLength > size - offset) {
        await reader.cancel();
        throw new Error(`Font exceeds its pinned size: ${path}`);
      }
      bytes.set(chunk.value, offset);
      offset += chunk.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== size) throw new Error(`Incomplete font download: ${path}`);
  return bytes;
}

export async function readFontSource(root: string, source: FontSource): Promise<Buffer> {
  const pin = Object.hasOwn(pinnedFonts, source.path) ? pinnedFonts[source.path] : undefined;
  if (!pin) throw new Error(`No pinned font source for ${source.path}`);
  const target = join(
    root,
    'node_modules',
    '.cache',
    'og-fonts',
    GOOGLE_FONTS_COMMIT,
    basename(source.path),
  );
  const verified = (bytes: Buffer) =>
    bytes.length === pin.size &&
    'sha512-' + createHash('sha512').update(bytes).digest('base64') === pin.integrity;

  try {
    const file = await open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await file.stat();
      if (stat.isFile() && stat.size === pin.size) {
        const cached = await file.readFile();
        if (verified(cached)) return cached;
      }
    } finally {
      await file.close();
    }
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error;
  }
  const bytes = await download(source.path, pin.size);
  if (!verified(bytes)) throw new Error(`Font failed its pinned integrity check: ${source.path}`);
  publishGeneratedFile(target, bytes);
  return bytes;
}
