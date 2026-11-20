import assert from "node:assert/strict";
import test from "node:test";
import { getAddress, parseEther, ZeroAddress } from "ethers";
import { auctionChoice, botRpcUrl, gameChoice, marketOrder, validateBotSession } from "./bots.mjs";

const accounts = Array.from({ length: 10 }, (_, i) =>
  getAddress("0x" + (i + 1).toString(16).padStart(40, "0")),
);
const instanceId = "0x" + "a1".repeat(32);
const wallets = (indices) => indices.map((index) => ({ index, address: accounts[index] }));
const manifest = { humanWallets: wallets([1, 2, 3]), botWallets: wallets([7, 8, 9]), instanceId };

test("wallets and node must belong to the unforked local playground", () => {
  assert.equal(botRpcUrl("http://127.0.0.1:18564"), "http://127.0.0.1:18564/");
  for (const url of [
    "https://127.0.0.1:18564",
    "http://example.org",
    "http://127.0.0.1:18564/rpc",
    "http://user@127.0.0.1:18564",
    "http://127.0.0.1:18564/?proxy=elsewhere",
  ])
    assert.throws(() => botRpcUrl(url));
  const validate = (m, metadata, id) => validateBotSession(m, accounts, metadata, id);
  validate(manifest, { instanceId }, 31337);
  for (const metadata of [
    null,
    {},
    { instanceId: "0x12" },
    { instanceId, forkedNetwork: { chainId: 1 } },
  ])
    assert.throws(() => validate(manifest, metadata, 31337));
  assert.throws(() => validate(manifest, { instanceId }, 1));
  assert.throws(() => validate({ ...manifest, humanWallets: wallets([7]) }, { instanceId }, 31337));
  assert.throws(() =>
    validate({ ...manifest, botWallets: wallets([0, 8, 9]) }, { instanceId }, 31337),
  );
  assert.throws(() =>
    validate({ ...manifest, botWallets: wallets([7, 8]) }, { instanceId }, 31337),
  );
});

test("players wait at the opening, respect the current leader and observe close exclusivity", () => {
  const game = {
    address: accounts[7],
    now: 25n,
    activation: 10n,
    end: 50n,
    last: accounts[1],
    exclusive: 15n,
    price: parseEther("0.002"),
    balance: parseEther("5"),
    spent: 0n,
  };
  assert.equal(gameChoice(game), "gesture");
  const cst = { price: parseEther("1"), balance: parseEther("2"), spent: 0n };
  assert.equal(gameChoice({ ...game, cst }), "cstGesture");
  assert.equal(gameChoice({ ...game, cst, last: ZeroAddress }), "gesture");
  assert.equal(gameChoice({ ...game, cst: { ...cst, balance: 0n } }), "gesture");
  assert.equal(gameChoice({ ...game, cst: { ...cst, spent: parseEther("25") } }), "gesture");
  assert.equal(gameChoice({ ...game, now: 14n, last: ZeroAddress }), null);
  assert.equal(gameChoice({ ...game, last: game.address }), null);
  assert.equal(gameChoice({ ...game, spent: parseEther("0.1") }), null);
  assert.equal(gameChoice({ ...game, balance: parseEther("0.05") }), null);
  assert.equal(gameChoice({ ...game, now: 47n }), null);
  assert.equal(gameChoice({ ...game, now: 50n }), null);
  assert.equal(gameChoice({ ...game, now: 50n, last: game.address }), "close");
  assert.equal(gameChoice({ ...game, now: 75n }), "close");
});

test("collectors honor wallet ceilings, expiry, delivery rights and outstanding proceeds", () => {
  const terms = {
    now: 31n,
    address: accounts[8],
    minimum: parseEther("0.002"),
    ceiling: parseEther("0.006"),
    balance: parseEther("3"),
  };
  const lot = {
    registered: true,
    eligibleAt: 30n,
    endAt: 50n,
    settled: false,
    highestBidder: accounts[7],
  };
  assert.equal(auctionChoice(lot, terms), "bid");
  for (const tooHigh of [1n, 2n, 1234n, 10n ** 40n])
    assert.equal(auctionChoice(lot, { ...terms, minimum: terms.ceiling + tooHigh }), null);
  assert.equal(auctionChoice(lot, { ...terms, now: 29n }), null);
  assert.equal(auctionChoice(lot, { ...terms, address: lot.highestBidder }), null);
  assert.equal(auctionChoice(lot, { ...terms, balance: parseEther("0.05") }), null);
  assert.equal(auctionChoice(lot, { ...terms, now: 50n }), "settle");
  assert.equal(
    auctionChoice({ ...lot, settled: true }, { ...terms, address: lot.highestBidder }),
    "collect",
  );
  assert.equal(auctionChoice({ ...lot, settled: true }, terms), "forward");
  assert.equal(auctionChoice({ ...lot, settled: true, proceedsForwarded: true }, terms), null);
});

test("traders skip resolved questions, compare their valuation with the pool and cap inventory", () => {
  const trade = {
    question: 3,
    knownMask: 0n,
    fairBps: 6200,
    yesBps: 5400,
    yesHeld: 0n,
    noHeld: 0n,
    size: parseEther("2"),
    funds: parseEther("5"),
  };
  assert.deepEqual(marketOrder(trade), { yes: true, buy: true, input: trade.size });
  assert.deepEqual(marketOrder({ ...trade, fairBps: 4000 }), {
    yes: false,
    buy: true,
    input: trade.size,
  });
  assert.deepEqual(marketOrder({ ...trade, noHeld: 9n }), { yes: false, buy: false, input: 9n });
  for (let q = 0; q < 8; q++)
    assert.equal(marketOrder({ ...trade, knownMask: 1n << BigInt(q), question: q }), null);
  assert.equal(marketOrder({ ...trade, funds: 1n }), null);
  assert.equal(marketOrder({ ...trade, yesHeld: parseEther("40") }), null);
  assert.equal(marketOrder({ ...trade, fairBps: 5500 }), null);
});
