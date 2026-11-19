/** Standalone, loopback-only read fixture for browser cases that do not install page routes. */
import { createServer, type ServerResponse } from 'node:http';

import { gestures, specialRecipients } from './home-gesture-chat-fixtures';
import { denseFixture } from './mobile-audit-fixtures';
import { dashboard, gestureInfo, qualityFixture, tokenInfo } from './zh-quality-mocks';
import { roundInfo, sprint4Fixture, SPRINT4_MOCK_CYCLE } from './zh-sprint4-helpers';

// The live-shaped records keep the gallery, past allocations and current participant feed usable.
const tokenCount = 36;
const tokens = Array.from({ length: tokenCount }, (_, index) => ({
  ...tokenInfo,
  TokenId: tokenCount - index,
  TokenName: index % 2 ? '' : 'Signature ' + (tokenCount - index),
}));
const feed = gestures.map((row, index) => ({
  ...row,
  RoundNum: SPRINT4_MOCK_CYCLE,
  BidPosition: index + 1,
  Tx: {
    ...row.Tx,
    TxHash: '0x' + row.Tx.TxId.toString(16).padStart(64, '0'),
    DateTime: new Date(row.Tx.TimeStamp * 1000).toISOString(),
  },
}));
const historicalRound = { ...roundInfo, RoundNum: 1 };

function fixture(path: string): unknown {
  if (path.endsWith('/statistics/dashboard')) {
    return {
      ...dashboard,
      CurNumBids: feed.length,
      LastBidderAddr: specialRecipients.LastBidderAddress,
      CurRoundStats: { ...dashboard.CurRoundStats, TotalBids: feed.length },
      MainStats: { ...dashboard.MainStats, NumCSTokenMints: tokens.length },
    };
  }
  if (path.endsWith('/bid/current_special_winners')) return specialRecipients;
  const byRound = path.match(/\/bid\/list\/by_round\/(\d+)\/([01])\/(\d+)\/(\d+)$/);
  if (byRound) {
    const rows = Number(byRound[1]) === SPRINT4_MOCK_CYCLE ? [...feed] : [];
    if (byRound[2] === '1') rows.reverse();
    const offset = Number(byRound[3]);
    return { BidsByRound: rows.slice(offset, offset + Number(byRound[4])) };
  }
  if (path.includes('/bid/list/all/')) return { Gestures: feed };
  const gallery = path.match(/\/cst\/list\/all\/(\d+)\/(\d+)$/);
  if (gallery) {
    const offset = Number(gallery[1]);
    return { CosmicSignatureTokenList: tokens.slice(offset, offset + Number(gallery[2])) };
  }
  const token = path.match(/\/cst\/info\/(\d+)$/);
  if (token) {
    const id = Number(token[1]);
    if (tokens.some((row) => row.TokenId === id))
      return { TokenInfo: { ...tokenInfo, TokenId: id } };
  }
  if (path.includes('/rounds/list/')) return { Rounds: [roundInfo, historicalRound] };
  if (path.endsWith('/rounds/info/1')) return { RoundInfo: historicalRound };
  const gesture = path.match(/\/bid\/info\/(1|2|5|10)$/);
  if (gesture) {
    return {
      ...gestureInfo,
      BidInfo: {
        ...gestureInfo.BidInfo,
        Tx: { ...gestureInfo.BidInfo.Tx, EvtLogId: Number(gesture[1]) },
      },
    };
  }
  return qualityFixture(path) ?? sprint4Fixture(path) ?? denseFixture(path);
}

interface RpcRequest {
  id?: string | number | null;
  method?: string;
}
function rpc(request: RpcRequest) {
  const chainId =
    process.env.NEXT_PUBLIC_NETWORK === 'sepolia'
      ? 421614
      : process.env.NEXT_PUBLIC_NETWORK === 'local'
        ? 31337
        : 42161;
  const values: Record<string, unknown> = {
    eth_chainId: '0x' + chainId.toString(16),
    net_version: String(chainId),
    eth_blockNumber: '0x186a0',
    eth_accounts: [],
    eth_getBalance: '0x0',
    eth_getLogs: [],
    eth_getCode: '0x',
    eth_getTransactionCount: '0x0',
  };
  const response = { jsonrpc: '2.0', id: request.id ?? null };
  return request.method && Object.hasOwn(values, request.method)
    ? { ...response, result: values[request.method] }
    : { ...response, error: { code: -32601, message: 'Unsupported mock RPC method' } };
}

function json(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(data));
}

const port = Number(
  process.env.PLAYWRIGHT_API_PORT ?? Number(process.env.PLAYWRIGHT_PORT ?? 3000) + 1,
);
createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'content-type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  if (path === '/healthz' && request.method === 'GET') {
    json(response, 200, { ready: true });
    return;
  }
  if (path === '/rpc' && request.method === 'POST') {
    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 64_000) {
          json(response, 413, { error: 'request too large' });
          return;
        }
      }
      const value = JSON.parse(body);
      json(response, 200, Array.isArray(value) ? value.map(rpc) : rpc(value));
    } catch {
      json(response, 400, { error: 'invalid JSON-RPC request' });
    }
    return;
  }
  const data =
    request.method === 'GET' && path.startsWith('/api/cosmicgame/') ? fixture(path) : undefined;
  json(response, data === undefined ? 404 : 200, data ?? { error: 'No fixture for this path' });
}).listen(port, '127.0.0.1');
