import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { lock } from 'proper-lockfile';

import { whitePaperPdfPath } from '../content/white-paper/types';
import type { AppLocale } from '../i18n/locale';
import { routing } from '../i18n/routing';

import { publishGeneratedFile } from './publish-generated-file';
import {
  WHITE_PAPER_PDF_MANIFEST_PATH,
  type WhitePaperPdfManifestEntry,
} from './white-paper-pdf-core';

type Entries = Partial<Record<AppLocale, WhitePaperPdfManifestEntry>>;

function readManifest(path: string): Entries {
  try {
    const entries: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
      throw new Error('Expected the white paper manifest to contain an object');
    }
    return entries as Entries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

function writeManifest(path: string, entries: Entries): void {
  const ordered: Entries = {};
  for (const locale of routing.locales) {
    if (entries[locale]) ordered[locale] = entries[locale];
  }
  publishGeneratedFile(path, JSON.stringify(ordered, null, 2) + '\n');
}

/** Serialize only publication. Compiling PDFs for different locales can run in parallel. */
export async function publishWhitePaperPdf(
  root: string,
  locale: AppLocale,
  sourceSha256: string,
  bytes: Buffer,
): Promise<string> {
  const manifest = join(root, WHITE_PAPER_PDF_MANIFEST_PATH);
  const pdf = whitePaperPdfPath(locale);
  const output = join(root, 'public', pdf);
  mkdirSync(dirname(manifest), { recursive: true });
  // realpath:false allows the first build to create the manifest. Retry longer
  // than the stale timeout so another process can recover an interrupted writer.
  const release = await lock(manifest, {
    realpath: false,
    stale: 10_000,
    retries: { retries: 20, minTimeout: 100, maxTimeout: 1_000, randomize: true },
  });
  try {
    const entries = readManifest(manifest);
    const previous = entries[locale];
    if (previous?.pdf === pdf && previous.sourceSha256 !== sourceSha256) {
      // These bytes will replace the same edition. If publication is interrupted,
      // no entry may still attest to the old digest for the replaced file.
      delete entries[locale];
      writeManifest(manifest, entries);
    }
    publishGeneratedFile(output, bytes);
    entries[locale] = { pdf, sourceSha256 };
    writeManifest(manifest, entries);
    return output;
  } finally {
    await release();
  }
}
