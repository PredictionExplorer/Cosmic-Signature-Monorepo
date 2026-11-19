/** @jest-environment node */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GOOGLE_FONTS_COMMIT } from '../build-og-fonts-core';
import { readFontSource } from '../read-font-source';

describe('pinned font sources', () => {
  let root: string;
  const sourceSize = 187208;
  const file = 'JetBrainsMono[wght].ttf';
  const source = { path: 'ofl/jetbrainsmono/' + file };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'font-source-'));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects an unknown source before making a request', async () => {
    const request = jest.spyOn(global, 'fetch');
    await expect(readFontSource(root, { path: 'ofl/other/font.ttf' })).rejects.toThrow(
      'No pinned font',
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects a same-size response with the wrong checksum without publishing it', async () => {
    const wrong = Buffer.alloc(sourceSize);
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(wrong));
    await expect(readFontSource(root, source)).rejects.toThrow('integrity');
    expect(existsSync(join(root, 'node_modules/.cache/og-fonts', GOOGLE_FONTS_COMMIT, file))).toBe(
      false,
    );
  });

  it('rechecks cached bytes and rejects a truncated replacement', async () => {
    const dir = join(root, 'node_modules/.cache/og-fonts', GOOGLE_FONTS_COMMIT);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), Buffer.alloc(sourceSize));
    const request = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('partial'));
    await expect(readFontSource(root, source)).rejects.toThrow('Incomplete font');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
