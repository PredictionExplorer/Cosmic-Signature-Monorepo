/** @jest-environment node */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { whitePaperPdfPath } from '../../content/white-paper/types';
import { WHITE_PAPER_PDF_MANIFEST_PATH } from '../white-paper-pdf-core';
import { publishWhitePaperPdf } from '../white-paper-pdf-output';

const run = promisify(execFile);
let root: string;
let manifest: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paper-publication-'));
  manifest = join(root, WHITE_PAPER_PDF_MANIFEST_PATH);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

it('merges concurrent publishers in locale order and retains each complete PDF', async () => {
  const worker = `const [modulePath, root, locale] = process.argv.slice(1);
    const { publishWhitePaperPdf } = require(modulePath);
    const digest = require('node:crypto').createHash('sha256').update(locale).digest('hex');
    publishWhitePaperPdf(root, locale, digest, Buffer.from(locale)).catch(error => {
      console.error(error); process.exitCode = 1;
    });`;
  await Promise.all(
    ['ja', 'en', 'zh'].map((locale) =>
      run(process.execPath, [
        '--require',
        'tsx/cjs',
        '-e',
        worker,
        resolve(__dirname, '../white-paper-pdf-output.ts'),
        root,
        locale,
      ]),
    ),
  );
  const entries = JSON.parse(readFileSync(manifest, 'utf8'));
  expect(Object.keys(entries)).toEqual(['en', 'zh', 'ja']);
  for (const locale of ['en', 'zh', 'ja'] as const) {
    expect(entries[locale]).toEqual({
      pdf: whitePaperPdfPath(locale),
      sourceSha256: createHash('sha256').update(locale).digest('hex'),
    });
    expect(readFileSync(join(root, 'public', entries[locale].pdf), 'utf8')).toBe(locale);
  }
});

it.each(['{', 'null', '[]'])(
  'preserves a malformed manifest %s and its previous PDF',
  async (raw) => {
    const output = await publishWhitePaperPdf(
      root,
      'en',
      'a'.repeat(64),
      Buffer.from('first edition'),
    );
    writeFileSync(manifest, raw);
    await expect(
      publishWhitePaperPdf(root, 'en', 'b'.repeat(64), Buffer.from('updated edition')),
    ).rejects.toThrow();
    expect(readFileSync(output, 'utf8')).toBe('first edition');
    expect(readFileSync(manifest, 'utf8')).toBe(raw);
  },
);

it('keeps other entries and recovers when a same-edition update cannot publish', async () => {
  const output = await publishWhitePaperPdf(root, 'en', 'a'.repeat(64), Buffer.from('first'));
  await publishWhitePaperPdf(root, 'ja', 'b'.repeat(64), Buffer.from('unchanged'));
  const other = JSON.parse(readFileSync(manifest, 'utf8')).ja;
  rmSync(output);
  mkdirSync(output);
  await expect(
    publishWhitePaperPdf(root, 'en', 'c'.repeat(64), Buffer.from('changed')),
  ).rejects.toThrow();
  expect(JSON.parse(readFileSync(manifest, 'utf8'))).toEqual({ ja: other });
  rmSync(output, { recursive: true });
  await publishWhitePaperPdf(root, 'en', 'c'.repeat(64), Buffer.from('changed'));
  expect(readFileSync(output, 'utf8')).toBe('changed');
  expect(JSON.parse(readFileSync(manifest, 'utf8'))).toEqual({
    en: { pdf: whitePaperPdfPath('en'), sourceSha256: 'c'.repeat(64) },
    ja: other,
  });
});

it('recovers a stale writer lock after an interrupted first build', async () => {
  mkdirSync(dirname(manifest), { recursive: true });
  mkdirSync(manifest + '.lock');
  utimesSync(manifest + '.lock', new Date(0), new Date(0));
  await publishWhitePaperPdf(root, 'en', 'a'.repeat(64), Buffer.from('first'));
  expect(JSON.parse(readFileSync(manifest, 'utf8')).en.pdf).toBe(whitePaperPdfPath('en'));
});
