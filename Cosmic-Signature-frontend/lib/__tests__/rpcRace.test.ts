import { toHex, padHex } from 'viem';

import { __resetRpcRace, fetchEndgameChainSample } from '../rpcRace';

jest.unmock('viem');
jest.mock('@/lib/serverRotation', () => ({
  rpcUrls: ['https://a.rpc.test', 'https://b.rpc.test'],
}));

const game = '0x0000000000000000000000000000000000000011';
const participant = '0x0000000000000000000000000000000000000022';
const proxy = `${window.location.origin}/api/rpc`;
// JSON-RPC servers may return batch items in a different order from the request.
const batch = [
  { id: 4, result: { timestamp: '0x64' } },
  { id: 2, result: padHex(participant, { size: 32 }) },
  { id: 3, result: toHex(7, { size: 32 }) },
  { id: 1, result: toHex(105, { size: 32 }) },
];

function response(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

const send = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
const originalFetch = global.fetch;

beforeEach(() => {
  __resetRpcRace();
  jest.useFakeTimers();
  global.fetch = send.mockReset();
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

it('accepts a complete sample from a second node when the first returns an RPC error', async () => {
  send
    .mockResolvedValueOnce(
      response([{ id: 4, error: { code: -32000, message: 'head unavailable' } }]),
    )
    .mockResolvedValueOnce(response(batch))
    .mockRejectedValue(new Error('unexpected fallback'));

  await expect(fetchEndgameChainSample(game)).resolves.toEqual({
    mainPrizeTimeSec: 105,
    lastBidderAddress: participant,
    roundNum: 7,
    blockTimestampSec: 100,
    sampledAtMs: Date.now(),
  });
  expect(send.mock.calls.map(([url]) => url)).toEqual(['https://a.rpc.test', 'https://b.rpc.test']);
});

it('uses the proxy during a direct outage and retries the nodes after five minutes', async () => {
  send
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(response([]))
    .mockResolvedValue(response(batch));

  await expect(fetchEndgameChainSample(game)).resolves.toMatchObject({ roundNum: 7 });
  await expect(fetchEndgameChainSample(game)).resolves.toMatchObject({ roundNum: 7 });
  jest.setSystemTime(Date.now() + 5 * 60_000);
  await expect(fetchEndgameChainSample(game)).resolves.toMatchObject({ roundNum: 7 });
  expect(send.mock.calls.map(([url]) => url)).toEqual([
    'https://a.rpc.test',
    'https://b.rpc.test',
    proxy,
    proxy,
    'https://a.rpc.test',
    'https://b.rpc.test',
  ]);
});

it('rejects an incomplete proxy sample when every direct node is offline', async () => {
  send
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(response([{ id: 4, result: {} }]));
  await expect(fetchEndgameChainSample(game)).rejects.toThrow('latest block missing timestamp');
});
