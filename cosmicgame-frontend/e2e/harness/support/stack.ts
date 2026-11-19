/**
 * Harness stack management for the Playwright `harness` project: reuse a
 * healthy running stack or boot a dedicated one (and remember ownership so
 * teardown only stops what setup started).
 */

import { execFile } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { publishGeneratedFile } from '../../../scripts/publish-generated-file';
import { readStateFile } from '../../../scripts/harness/processes';
import { loopbackOrigin } from '../../../scripts/harness/ports';
import { SCENARIOS } from '../../../scripts/harness/scenarios';

const execFileAsync = promisify(execFile);

export const REPO_ROOT = join(__dirname, '..', '..', '..');
const RUN_DIR = join(REPO_ROOT, '.harness');
const STATE_FILE = join(RUN_DIR, 'state.json');
const OWNERSHIP_FILE = join(RUN_DIR, 'e2e-owned.json');

export interface HarnessStackState {
  chainPort: number;
  dbPort: number;
  apiPort: number;
  webPort: number;
  controlPort: number;
  processes: Array<{ name: string; pid: number }>;
}

export function readStackState(): HarnessStackState | null {
  return readStateFile(STATE_FILE);
}

export function controlUrl(state: HarnessStackState): string {
  return loopbackOrigin(state.controlPort);
}

export function apiUrl(state: HarnessStackState): string {
  return `${loopbackOrigin(state.apiPort)}/api/cosmicgame`;
}

export function webUrl(state: HarnessStackState): string {
  return loopbackOrigin(state.webPort, 'localhost');
}

/** Return locally registered names before storing or restoring a scenario across test workers. */
function savedScenario(value: unknown): string | null {
  if (value === null || value === undefined || value === 'none') return null;
  const scenario = typeof value === 'string' ? SCENARIOS.get(value) : undefined;
  if (!scenario) throw new Error('Cannot restore an unknown harness scenario');
  return scenario.name;
}

async function healthyStatus(state: HarnessStackState): Promise<{ scenario?: unknown } | null> {
  try {
    const response = await fetch(`${controlUrl(state)}/status`, { redirect: 'error' });
    if (!response.ok) return null;
    const status = (await response.json()) as { ready?: boolean; scenario?: unknown };
    if (status.ready !== true) return null;
    const web = await fetch(`${webUrl(state)}/`, { redirect: 'manual' });
    return web.status < 500 ? status : null;
  } catch {
    return null;
  }
}

export interface EnsuredStack {
  state: HarnessStackState;
  /** True when this run booted the stack (teardown must stop it). */
  owned: boolean;
  /** Scenario that was active before setup switched to `quiet` (reused stacks). */
  previousScenario: string | null;
}

/** Reuse a healthy stack, or boot a dedicated one on port 3100. */
export async function ensureStack(): Promise<EnsuredStack> {
  const existing = readStackState();
  const status = existing && (await healthyStatus(existing));
  if (existing && status) {
    const previousScenario = savedScenario(status.scenario);
    writeOwnership({ owned: false, previousScenario });
    return { state: existing, owned: false, previousScenario };
  }
  if (existing) {
    // A stack exists but is not usable for e2e (e.g. started without the
    // frontend, or half-dead). Clear it before booting a fresh one.
    await stopOwnedStack();
  }

  // Boot a dedicated stack. `up --detach` blocks until everything is healthy.
  await execFileAsync(
    'npm',
    [
      'run',
      'harness',
      '--',
      'up',
      '--detach',
      '--seed-cycles',
      '2',
      '--pace',
      'fast',
      '--scenario',
      'quiet',
    ],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, HARNESS_WEB_PORT: process.env.HARNESS_WEB_PORT ?? '3100' },
      timeout: 20 * 60_000,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const state = readStackState();
  if (!state) throw new Error('Harness stack booted but state.json is missing');
  writeOwnership({ owned: true, previousScenario: null });
  return { state, owned: true, previousScenario: null };
}

interface Ownership {
  owned: boolean;
  previousScenario: string | null;
}

function writeOwnership(ownership: Ownership): void {
  publishGeneratedFile(OWNERSHIP_FILE, JSON.stringify(ownership));
}

export function readOwnership(): Ownership | null {
  try {
    const record = JSON.parse(readFileSync(OWNERSHIP_FILE, 'utf8')) as Partial<Ownership> | null;
    if (typeof record?.owned !== 'boolean') return null;
    return { owned: record.owned, previousScenario: savedScenario(record.previousScenario) };
  } catch {
    return null;
  }
}

export function clearOwnership(): void {
  rmSync(OWNERSHIP_FILE, { force: true });
}

export async function stopOwnedStack(): Promise<void> {
  await execFileAsync('npm', ['run', 'harness', '--', 'down'], {
    cwd: REPO_ROOT,
    timeout: 5 * 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });
}
