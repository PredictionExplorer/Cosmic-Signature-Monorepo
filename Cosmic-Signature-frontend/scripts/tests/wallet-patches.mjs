import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyPatch, parsePatch, reversePatch } from 'diff';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { packages } = JSON.parse(fs.readFileSync(join(root, 'package-lock.json'), 'utf8'));

test('wallet installation rejects drift before writing and can be repeated', (t) => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'wallet-patches-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(join(dir, 'scripts'));
  const installer = join(dir, 'scripts/apply-wallet-patches.mjs');
  fs.copyFileSync(join(root, 'scripts/apply-wallet-patches.mjs'), installer);
  fs.cpSync(join(root, 'patches'), join(dir, 'patches'), { recursive: true });
  fs.mkdirSync(join(dir, 'node_modules'));
  fs.symlinkSync(join(root, 'node_modules/diff'), join(dir, 'node_modules/diff'), 'junction');

  // Reconstruct the pre-install files from the checked-in diffs and the installed SDKs.
  // Include a nested CDP copy so an installer that only visits top-level packages fails.
  const copies = {};
  const files = [];
  for (const location of [
    'node_modules/@reown/appkit-wallet',
    'node_modules/@coinbase/cdp-sdk',
    'node_modules/fixture/node_modules/@coinbase/cdp-sdk',
  ]) {
    const sdk = location.split('node_modules/').at(-1);
    const source = Object.keys(packages).find((key) => key.endsWith(`node_modules/${sdk}`));
    const { version } = packages[source];
    copies[location] = { version };
    fs.mkdirSync(join(dir, location), { recursive: true });
    fs.copyFileSync(join(root, source, 'package.json'), join(dir, location, 'package.json'));
    const diff = fs.readFileSync(
      join(dir, 'patches', `${sdk.replace('/', '__')}@${version}.patch`),
      'utf8',
    );
    for (const patch of parsePatch(diff)) {
      const name = patch.newFileName.slice(2);
      const path = join(dir, location, name);
      const after = fs.readFileSync(join(root, source, name), 'utf8');
      const before = patch.isCreate ? null : applyPatch(after, reversePatch(patch));
      fs.mkdirSync(dirname(path), { recursive: true });
      if (before !== null) {
        assert.equal(typeof before, 'string', name);
        fs.writeFileSync(path, before);
      }
      files.push({ path, before, after });
    }
  }
  fs.writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ packages: copies }));
  const install = () => spawnSync(process.execPath, [installer], { encoding: 'utf8' });

  const last = files.findLast(({ before }) => before !== null);
  fs.writeFileSync(last.path, 'unexpected contents');
  const failed = install();
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Unexpected contents/);
  assert.equal(fs.readFileSync(last.path, 'utf8'), 'unexpected contents');
  fs.writeFileSync(last.path, last.before);
  for (const { path, before } of files) {
    assert.equal(fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : null, before, path);
  }

  const first = install();
  assert.equal(first.status, 0, first.stderr);
  for (const { path, after } of files) {
    assert.equal(fs.readFileSync(path, 'utf8'), after, path);
    fs.utimesSync(path, 0, 0);
  }
  const second = install();
  assert.equal(second.status, 0, second.stderr);
  for (const { path } of files) assert.equal(fs.statSync(path).mtimeMs, 0, path);
});
