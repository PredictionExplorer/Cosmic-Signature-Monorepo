/**
 * Child-process supervision for the harness.
 *
 * Every managed process writes to its own log file under .harness/logs and is
 * spawned as a process-group leader, so it survives a detached orchestrator
 * exit and can be terminated reliably (group kill) by `harness down` later.
 * Foreground mode mirrors the log files to the console by tailing them.
 */

import { spawn } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  fstatSync,
  constants,
  watchFile,
  unwatchFile,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { publishGeneratedFile } from '../publish-generated-file';

import { harnessPort } from './ports';
import { openOptionalHarnessFile } from './files';
import { createLogger } from './log';
import type { HarnessConfig } from './config';
import { harnessPaths } from './config';

export interface ManagedProcess {
  name: string;
  pid: number;
  logFile: string;
}

export interface HarnessState {
  startedAtIso: string;
  chainPort: number;
  dbPort: number;
  apiPort: number;
  webPort: number;
  controlPort: number;
  composeProject: string;
  processes: ManagedProcess[];
  /** Deployed contract addresses, once known. */
  addresses?: Record<string, string>;
}

/** Extra environment for a child process (merged over the parent's env). */
export type ChildEnv = Record<string, string | undefined>;

export interface SpawnOptions {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env?: ChildEnv;
  logFile: string;
}

/** Spawn a supervised process-group leader whose output goes to a log file. */
export function spawnSupervised(options: SpawnOptions): ManagedProcess {
  mkdirSync(dirname(options.logFile), { recursive: true });
  const fd = openSync(options.logFile, 'a');
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', fd, fd],
    detached: true,
  });
  closeSync(fd);
  child.unref();
  if (child.pid === undefined) {
    throw new Error(`Failed to spawn ${options.name} (${options.command})`);
  }
  return { name: options.name, pid: child.pid, logFile: options.logFile };
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/** SIGTERM the whole process group, escalating to SIGKILL after a grace period. */
export async function stopProcessGroup(pid: number, graceMs = 8_000): Promise<void> {
  const signal = (sig: NodeJS.Signals) => {
    try {
      // Negative pid: the entire process group (the child was a group leader).
      process.kill(-pid, sig);
    } catch {
      try {
        process.kill(pid, sig);
      } catch {
        // Already gone.
      }
    }
  };
  if (!isProcessAlive(pid)) return;
  signal('SIGTERM');
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await sleep(200);
  }
  signal('SIGKILL');
}

/** Mirror a growing log file to the console with a prefix. Returns a stop fn. */
export function mirrorLogFile(name: string, logFile: string): () => void {
  const logger = createLogger(name);
  let offset = 0;
  let inode: number | undefined;
  function drain(initial = false) {
    const fd = openOptionalHarnessFile(logFile, constants.O_RDONLY);
    if (fd === null) return;
    try {
      const { ino, size } = fstatSync(fd);
      if (initial) offset = size;
      else if (ino !== inode || size < offset) offset = 0;
      inode = ino;
      if (size <= offset) return;
      const buffer = Buffer.alloc(Math.min(size - offset, 64 * 1024));
      while (offset < size) {
        const bytes = readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), offset);
        if (bytes === 0) break;
        logger.line(buffer.toString('utf8', 0, bytes));
        offset += bytes;
      }
    } finally {
      closeSync(fd);
    }
  }
  drain(true);
  const onChange = () => drain();
  watchFile(logFile, { interval: 300 }, onChange);
  return () => unwatchFile(logFile, onChange);
}

export interface RunBlockingOptions {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env?: ChildEnv;
  logFile: string;
  /** Mirror output to the console while running (default true). */
  mirror?: boolean;
}

/** Run a one-shot step to completion, logging output; throws on non-zero exit. */
export async function runBlocking(options: RunBlockingOptions): Promise<void> {
  mkdirSync(dirname(options.logFile), { recursive: true });
  const fd = openSync(options.logFile, 'a');
  const stopMirror =
    options.mirror === false ? () => {} : mirrorLogFile(options.name, options.logFile);
  try {
    await new Promise<void>((resolveRun, rejectRun) => {
      const child = spawn(options.command, options.args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stdio: ['ignore', fd, fd],
      });
      child.on('error', rejectRun);
      child.on('exit', (code, sig) => {
        if (code === 0) resolveRun();
        else
          rejectRun(
            new Error(
              `${options.name} exited with ${code ?? `signal ${sig}`} — see ${options.logFile}`,
            ),
          );
      });
    });
  } finally {
    // Give the tail a beat to drain the final lines before detaching.
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 400));
    stopMirror();
    closeSync(fd);
  }
}

export function readStateFile(stateFile: string): HarnessState | null {
  let content: string;
  try {
    content = readFileSync(stateFile, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const state = JSON.parse(content) as HarnessState;
  if (
    !Array.isArray(state?.processes) ||
    !state.processes.every(
      (proc) => typeof proc?.name === 'string' && Number.isSafeInteger(proc.pid) && proc.pid > 0,
    )
  ) {
    throw new Error('Invalid process list in harness state');
  }
  return {
    ...state,
    apiPort: harnessPort(state.apiPort),
    chainPort: harnessPort(state.chainPort),
    controlPort: harnessPort(state.controlPort),
    dbPort: harnessPort(state.dbPort),
    webPort: harnessPort(state.webPort),
  };
}

export function readState(config: HarnessConfig): HarnessState | null {
  return readStateFile(harnessPaths(config).stateFile);
}

export function writeState(config: HarnessConfig, state: HarnessState): void {
  const { stateFile } = harnessPaths(config);
  publishGeneratedFile(stateFile, JSON.stringify(state, null, 2));
}

export function emptyState(config: HarnessConfig): HarnessState {
  return {
    startedAtIso: new Date().toISOString(),
    chainPort: config.chainPort,
    dbPort: config.dbPort,
    apiPort: config.apiPort,
    webPort: config.webPort,
    controlPort: config.controlPort,
    composeProject: config.composeProject,
    processes: [],
  };
}

export function logFileFor(config: HarnessConfig, name: string): string {
  return join(harnessPaths(config).logsDir, `${name}.log`);
}
