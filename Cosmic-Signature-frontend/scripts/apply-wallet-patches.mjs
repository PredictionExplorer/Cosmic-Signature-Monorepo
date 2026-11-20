// npm installs each SDK from its integrity-checked tarball. Apply the same native-Zod-4
// migration as the other two sites to every physical copy, including nested dependencies.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPatch, parsePatch } from 'diff';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const sdkVersions = {
  '@reown/appkit-wallet': '1.8.19',
  '@coinbase/cdp-sdk': '1.51.2',
};

// Full blob IDs in the checked-in diffs identify the exact input and output files.
function gitObjectHash(contents) {
  return createHash('sha1')
    .update(`blob ${Buffer.byteLength(contents)}\0`)
    .update(contents)
    .digest('hex');
}

function readFilePatches(packageName, version) {
  const fileName = `${packageName.replace('/', '__')}@${version}.patch`;
  const text = readFileSync(path.join(root, 'patches', fileName), 'utf8');
  return text.split(/(?=^diff --git )/m).map((section) => {
    const ids = /^index ([a-f0-9]{40})\.\.([a-f0-9]{40})\b/m.exec(section);
    const [patch] = parsePatch(section);
    if (!ids || !patch?.newFileName.startsWith('b/'))
      throw new Error(`Invalid patch in ${fileName}`);
    return { original: ids[1], patched: ids[2], patch };
  });
}

const updates = new Map();
for (const [sdk, expectedVersion] of Object.entries(sdkVersions)) {
  const copies = Object.keys(lock.packages).filter((location) =>
    location.endsWith(`node_modules/${sdk}`),
  );
  if (copies.length === 0)
    throw new Error(`Review the wallet patches: ${sdk} is absent from the lockfile`);

  const files = readFilePatches(sdk, expectedVersion);
  for (const location of copies) {
    const directory = path.join(root, location);
    const installed = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
    if (installed.name !== sdk || installed.version !== expectedVersion) {
      throw new Error(
        `Expected ${sdk}@${expectedVersion} in ${location}; review the wallet patches`,
      );
    }
    for (const { original, patched, patch } of files) {
      const target = path.join(directory, patch.newFileName.slice(2));
      const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
      const currentId = current === null ? '0'.repeat(40) : gitObjectHash(current);
      if (currentId === patched) continue;
      if (currentId !== original)
        throw new Error(`Unexpected contents at ${target}; reinstall from the lockfile`);
      const result = applyPatch(current ?? '', patch);
      if (typeof result !== 'string' || gitObjectHash(result) !== patched) {
        throw new Error(`Wallet patch did not produce the reviewed file at ${target}`);
      }
      updates.set(target, result);
    }
  }
}

// Validate all copies first. Atomic replacement keeps interrupted installs safe to retry.
for (const [target, result] of updates) {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, result, { flag: 'wx' });
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}
console.log(`Verified wallet SDK patches (${updates.size} files updated).`);
