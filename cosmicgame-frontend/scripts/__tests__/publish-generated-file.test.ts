/** @jest-environment node */
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { publishGeneratedFile } from '../publish-generated-file';

it('preserves an existing draft, and replaces only its directory entry on explicit overwrite', () => {
  const root = mkdtempSync(join(tmpdir(), 'publish-draft-'));
  try {
    const existing = join(root, 'original');
    const destination = join(root, 'draft');
    writeFileSync(existing, 'original');
    symlinkSync(existing, destination);
    expect(publishGeneratedFile(destination, 'first', false)).toBe(false);
    expect(publishGeneratedFile(destination, 'second', true)).toBe(true);
    expect(readFileSync(existing, 'utf8')).toBe('original');
    expect(readFileSync(destination, 'utf8')).toBe('second');
    expect(readdirSync(root).sort()).toEqual(['draft', 'original']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
