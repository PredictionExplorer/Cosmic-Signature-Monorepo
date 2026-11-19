import { linkSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Publish a complete file, returning false if a no-overwrite writer lost the race. */
export function publishGeneratedFile(
  target: string,
  contents: string | Buffer,
  overwrite = true,
): boolean {
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true });
  const temp = mkdtempSync(join(parent, '.publish-'));
  const staged = join(temp, 'file');
  try {
    writeFileSync(staged, contents);
    if (overwrite) {
      renameSync(staged, target);
    } else {
      try {
        // Hard-link publication is atomic and never replaces an existing directory entry.
        linkSync(staged, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw error;
      }
    }
    return true;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
