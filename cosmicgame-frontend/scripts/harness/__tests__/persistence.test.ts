import fs, {
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readOwnership } from '../../../e2e/harness/support/stack';
import { withPreservedNextEnv } from '../orchestrator/frontend';
import { loopbackOrigin } from '../ports';
import { resolveHarnessConfig } from '../config';
import { emptyState, readStateFile, writeState } from '../processes';

describe('harness persistence boundaries', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cosmic-harness-state-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const ports = { controlPort: 8686, webPort: 3000, dbPort: 55432, chainPort: 8545, apiPort: 8099 };
  it('uses saved integer ports for a custom local deployment', () => {
    const path = join(dir, 'state.json');
    expect(readStateFile(path)).toBeNull();
    writeFileSync(path, JSON.stringify({ ...ports, apiPort: 18777, processes: [] }));
    expect(loopbackOrigin(readStateFile(path)?.apiPort)).toEqual('http://127.0.0.1:18777');
  });

  it('keeps an open reader on a complete snapshot while publishing the next one', () => {
    const config = { ...resolveHarnessConfig({ NODE_ENV: 'test' }, dir), runDir: dir };
    const file = join(dir, 'state.json');
    const initial = emptyState(config);
    writeState(config, initial);
    const reader = openSync(file, 'r');
    try {
      const updated = { ...initial, webPort: 3210 };
      writeState(config, updated);
      expect(JSON.parse(readFileSync(reader, 'utf8'))).toEqual(initial);
      expect(readStateFile(file)).toEqual(updated);
    } finally {
      closeSync(reader);
    }
  });

  it.each(['86/86', '8e3', 2.5, 0, 65536, null])(
    'rejects malformed saved port %j',
    (controlPort) => {
      const path = join(dir, 'state.json');
      writeFileSync(path, JSON.stringify({ ...ports, controlPort, processes: [] }));
      expect(() => readStateFile(path)).toThrow('Invalid service port');
    },
  );

  it('only restores a registered scenario from the ownership record', () => {
    const read = jest.spyOn(fs, 'readFileSync');
    try {
      read.mockReturnValueOnce(JSON.stringify({ owned: false, previousScenario: 'ambient' }));
      expect(readOwnership()).toEqual({ owned: false, previousScenario: 'ambient' });
      read.mockReturnValueOnce(JSON.stringify({ owned: false, previousScenario: 'retired' }));
      expect(readOwnership()).toBeNull();
      read.mockReturnValueOnce(JSON.stringify({ owned: 'false', previousScenario: null }));
      expect(readOwnership()).toBeNull();
    } finally {
      read.mockRestore();
    }
  });

  it('restores the tracked declarations even when startup fails', async () => {
    const file = join(dir, 'next-env.d.ts');
    writeFileSync(file, 'original');
    await expect(
      withPreservedNextEnv(file, async () => {
        writeFileSync(file, 'longer generated declarations');
        throw new Error('startup stopped');
      }),
    ).rejects.toThrow('startup stopped');
    expect(readFileSync(file, 'utf8')).toEqual('original');
  });

  it('preserves a file which replaced the declarations during startup', async () => {
    const file = join(dir, 'next-env.d.ts');
    const replacement = join(dir, 'new-declarations');
    writeFileSync(file, 'original');
    writeFileSync(replacement, 'edited');
    await withPreservedNextEnv(file, async () => {
      writeFileSync(file, 'generated');
      renameSync(replacement, file);
    });
    expect(readFileSync(file, 'utf8')).toBe('edited');
  });

  it('never follows a symlink when preserving generated declarations', async () => {
    const file = join(dir, 'next-env.d.ts');
    const link = join(dir, 'declarations-link');
    writeFileSync(file, 'local copy');
    symlinkSync(file, link);
    const start = jest.fn();
    await expect(withPreservedNextEnv(link, start)).rejects.toMatchObject({ code: 'ELOOP' });
    expect(start).not.toHaveBeenCalled();
    expect(readFileSync(file, 'utf8')).toBe('local copy');
  });
});
