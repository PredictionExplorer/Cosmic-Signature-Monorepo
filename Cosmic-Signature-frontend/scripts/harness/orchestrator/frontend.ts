/**
 * Next.js dev server in testing mode: injects the local-network environment
 * (process env takes precedence over .env files) and keeps build artifacts in
 * a harness-specific dist dir so a regular `npm run dev` can coexist.
 */

import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  readFileSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { join, relative } from 'node:path';

import { openOptionalHarnessFile } from '../files';
import type { HarnessConfig } from '../config';
import { harnessPaths } from '../config';
import { waitFor } from '../rpc';
import { logFileFor, spawnSupervised, type ManagedProcess } from '../processes';

import { chainRpcUrl } from './chain';
import { apiBaseUrl } from './backend';

/** Minimal .env parser — enough to recover existing values like the WalletConnect id. */
export function readEnvFileValue(filePath: string, key: string): string | undefined {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    if (line.slice(0, eq).trim() !== key) continue;
    return line
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }
  return undefined;
}

function walletConnectProjectId(config: HarnessConfig): string {
  for (const file of ['.env.local', '.env']) {
    const value = readEnvFileValue(
      join(config.frontendDir, file),
      'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID',
    );
    if (value) return value;
  }
  // Injected + burner connectors never open a WalletConnect session, so a
  // placeholder keeps the app booting on machines without a real project id.
  return 'cosmic-harness-local';
}

/** Environment for the testing-mode frontend (dev server or e2e build). */
export function testingModeEnv(config: HarnessConfig): Record<string, string> {
  return {
    NEXT_PUBLIC_NETWORK: 'local',
    NEXT_PUBLIC_RPC_URL: chainRpcUrl(config),
    NEXT_PUBLIC_API_URL: `${apiBaseUrl(config)}/api/cosmicgame`,
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: walletConnectProjectId(config),
    NEXT_PUBLIC_HARNESS: '1',
    NEXT_PUBLIC_HARNESS_CONTROL_URL: `http://127.0.0.1:${config.controlPort}`,
    NEXT_DIST_DIR: relative(config.frontendDir, harnessPaths(config).nextDistDir),
    // Neutralize overrides that would fight the harness data planes.
    NEXT_PUBLIC_UX_SCENARIO: '',
    NEXT_PUBLIC_API_URLS: '',
    NEXT_PUBLIC_RPC_URLS: '',
    NEXT_PUBLIC_SENTRY_DSN: '',
    COSMICGAME_API_UPSTREAM: '',
  };
}

/**
 * Next regenerates the tracked declaration when a harness-specific dist directory is used.
 * Retain the original inode during startup so a replacement file cannot receive the restore.
 */
export async function withPreservedNextEnv<T>(
  filePath: string,
  start: () => Promise<T>,
): Promise<T> {
  const fd = openOptionalHarnessFile(filePath, constants.O_RDWR);
  if (fd === null) return start();
  try {
    const original = readFileSync(fd);
    const before = fstatSync(fd, { bigint: true });
    try {
      return await start();
    } finally {
      const after = fstatSync(fd, { bigint: true });
      if (after.nlink > 0n && (after.mtimeNs !== before.mtimeNs || after.size !== before.size)) {
        let offset = 0;
        while (offset < original.length) {
          offset += writeSync(fd, original, offset, original.length - offset, offset);
        }
        ftruncateSync(fd, original.length);
      }
    }
  } finally {
    closeSync(fd);
  }
}

/** Start `next dev` in testing mode and wait until it serves. */
export async function startFrontend(config: HarnessConfig): Promise<ManagedProcess> {
  rmSync(logFileFor(config, 'web'), { force: true });
  return withPreservedNextEnv(join(config.frontendDir, 'next-env.d.ts'), async () => {
    const managed = spawnSupervised({
      name: 'web',
      command: 'npx',
      args: ['next', 'dev', '-p', String(config.webPort)],
      cwd: config.frontendDir,
      env: testingModeEnv(config),
      logFile: logFileFor(config, 'web'),
    });
    await waitFor(
      `Next.js dev server on :${config.webPort}`,
      async () => {
        const response = await fetch(`http://127.0.0.1:${config.webPort}/`, { redirect: 'manual' });
        return response.status < 500;
      },
      { timeoutMs: 120_000 },
    );
    return managed;
  });
}
