import { closeSync, constants, fstatSync, openSync } from 'node:fs';

/** Bind subsequent operations to a regular local file; it may not have been created yet. */
export function openOptionalHarnessFile(filePath: string, access: number): number | null {
  let fd: number;
  try {
    fd = openSync(filePath, access | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    if (!fstatSync(fd).isFile()) throw new Error(`Expected a regular file at ${filePath}`);
    return fd;
  } catch (err) {
    closeSync(fd);
    throw err;
  }
}
