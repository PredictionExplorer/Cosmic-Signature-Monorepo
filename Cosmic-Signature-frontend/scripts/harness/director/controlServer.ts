/**
 * Loopback HTTP control API for the director. Consumed by the in-app dev
 * panel and by `harness` CLI one-shot commands. JSON in/out, permissive CORS
 * (the panel runs on the Next.js origin), bound to 127.0.0.1 only.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { createLogger } from '../log';

import { HarnessCommandError, publicCommandFailure } from './commandError';
import type { GestureKind } from './actions';
import { HarnessTransitionAbortedError } from './planner';
import type { DirectorRuntime } from './runtime';

const log = createLogger('control');

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HarnessCommandError('Request body is not valid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HarnessCommandError('Request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  response.end(JSON.stringify(body));
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

export function startControlServer(runtime: DirectorRuntime, port: number): Server {
  const server = createServer((request, response) => {
    void handle(request, response).catch((err: unknown) => {
      const status = err instanceof HarnessCommandError ? 400 : 500;
      if (status === 500)
        log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
      sendJson(response, status, { error: publicCommandFailure(err) });
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === 'OPTIONS') {
      sendJson(response, 204, {});
      return;
    }
    const path = (request.url ?? '/').split('?')[0];

    if (request.method === 'GET' && path === '/status') {
      sendJson(response, 200, await runtime.status());
      return;
    }
    if (request.method !== 'POST') {
      sendJson(response, 404, { error: `No route ${request.method} ${path}` });
      return;
    }

    const body = await readJsonBody(request);
    try {
      switch (path) {
        case '/scenario': {
          const name = asString(body.name);
          if (!name) throw new HarnessCommandError('Missing scenario "name"');
          await runtime.switchScenario(name);
          sendJson(response, 200, { ok: true, scenario: name });
          return;
        }
        case '/gesture': {
          const kind = asString(body.kind) as GestureKind | undefined;
          const persona = asString(body.persona);
          const message = typeof body.message === 'string' ? body.message : undefined;
          const txHash = await runtime.gesture({
            ...(persona !== undefined ? { persona } : {}),
            ...(kind !== undefined ? { kind } : {}),
            ...(message !== undefined ? { message } : {}),
          });
          sendJson(response, 200, { ok: true, txHash });
          return;
        }
        case '/finalize': {
          const persona = asString(body.persona);
          const finalizedBy = await runtime.finalize(persona);
          sendJson(response, 200, { ok: true, finalizedBy });
          return;
        }
        case '/phase': {
          const name = asString(body.name);
          if (!name) throw new HarnessCommandError('Missing phase "name"');
          await runtime.driveTo(name);
          sendJson(response, 200, { ok: true, phase: name });
          return;
        }
        case '/pace': {
          const name = asString(body.name);
          if (!name) throw new HarnessCommandError('Missing pace "name"');
          await runtime.setPace(name);
          sendJson(response, 200, { ok: true, pace: name });
          return;
        }
        case '/pause':
          runtime.pause();
          sendJson(response, 200, { ok: true });
          return;
        case '/resume':
          runtime.resume();
          sendJson(response, 200, { ok: true });
          return;
        default:
          sendJson(response, 404, { error: `No route POST ${path}` });
      }
    } catch (err) {
      if (err instanceof HarnessTransitionAbortedError) {
        sendJson(response, 200, { ok: false, superseded: true });
        return;
      }
      throw err;
    }
  }

  server.listen(port, '127.0.0.1', () => {
    log.info(`Control API listening on http://127.0.0.1:${port}`);
  });
  return server;
}
