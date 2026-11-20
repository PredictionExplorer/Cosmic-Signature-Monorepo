// Local participants sign through Hardhat's unlocked accounts. They never change chain time.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import {
  Contract,
  FetchRequest,
  JsonRpcProvider,
  ZeroAddress,
  getAddress,
  isError,
  keccak256,
  parseEther,
} from "ethers";
const site = createRequire(
  new URL("../../../Cosmic-Signature-frontend/package.json", import.meta.url),
);
const { createRng, PERSONAS, pickInt, pickOne, pickWeighted } = site(
  "./scripts/harness/director/personas.ts",
);

const gameRoot = new URL("../../../Cosmic-Signature/", import.meta.url);
const marketRoot = new URL("../../", import.meta.url);
const cashReserve = parseEther("0.05");
const gameBudget = parseEther("0.1"); // per wallet, per cycle, from the game's actual ledger
const cstGestureBudget = parseEther("25");
const marketLimit = parseEther("40"); // total units held per wallet in each question
const preferences = [
  [
    ["game", 6],
    ["market", 2],
    ["auction", 2],
  ],
  [
    ["game", 2],
    ["market", 6],
    ["auction", 2],
  ],
  [
    ["game", 2],
    ["market", 2],
    ["auction", 6],
  ],
];
const ceilings = ["0.006", "0.012", "0.025"].map(parseEther);

function integer(value, min, max, name) {
  if (!/^\d+$/.test(String(value)) || Number(value) < min || Number(value) > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return Number(value);
}

export function botRpcUrl(endpoint) {
  const url = new URL(endpoint);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("Bots require the playground's numeric HTTP loopback RPC address");
  return url.href;
}

export function validateBotSession(manifest, accounts, metadata, chainId) {
  if (
    BigInt(chainId) !== 31337n ||
    !/^0x[0-9a-f]{64}$/i.test(manifest.instanceId) ||
    metadata?.instanceId !== manifest.instanceId ||
    metadata?.forkedNetwork
  )
    throw new Error("Bots require the original unforked playground node instance");
  if (manifest.botWallets?.length !== preferences.length || !manifest.humanWallets?.length)
    throw new Error("Missing human or bot wallets in the playground manifest");
  for (const [i, wallet] of manifest.botWallets.entries()) {
    if (
      wallet.index !== 7 + i ||
      getAddress(wallet.address) !== getAddress(accounts[wallet.index]) ||
      manifest.humanWallets.some(
        (human) => getAddress(human.address) === getAddress(wallet.address),
      )
    )
      throw new Error("Bot wallets must be the distinct reserved local accounts 7 through 9");
  }
}

export function gameChoice({
  now,
  activation,
  end,
  last,
  address,
  exclusive,
  price,
  spent,
  balance,
  cst,
}) {
  if (now < activation + 6n) return null; // leave the human a chance to open the cycle
  if (last !== ZeroAddress && now >= end) {
    return last === address || now >= end + exclusive + 10n ? "close" : null;
  }
  if (last === address || (last !== ZeroAddress && end - now <= 4n)) return null;
  if (
    cst &&
    last !== ZeroAddress &&
    cst.price <= cst.balance &&
    cst.price <= cstGestureBudget - cst.spent
  )
    return "cstGesture";
  if (price > gameBudget - spent || price + cashReserve > balance) return null;
  return "gesture";
}

export function auctionChoice(lot, { now, address, minimum, balance, ceiling }) {
  if (!lot.registered || now < lot.eligibleAt) return null;
  if (lot.settled) {
    if (!lot.delivered && lot.highestBidder === address) return "collect";
    return lot.proceedsForwarded ? null : "forward";
  }
  if (lot.endAt > 0n && now >= lot.endAt) return "settle";
  if (lot.highestBidder === address || minimum > ceiling || minimum + cashReserve > balance)
    return null;
  return "bid";
}

export function marketOrder({
  knownMask,
  question,
  fairBps,
  yesBps,
  yesHeld,
  noHeld,
  funds,
  size,
}) {
  if (knownMask & (1n << BigInt(question)) || Math.abs(fairBps - yesBps) < 250) return null;
  const yes = fairBps > yesBps;
  const opposite = yes ? noHeld : yesHeld;
  if (opposite > 0n) return { yes: !yes, buy: false, input: opposite < size ? opposite : size };
  if (funds < size || yesHeld + noHeld >= marketLimit) return null;
  return { yes, buy: true, input: size };
}

function artifact(root, packagePath) {
  return JSON.parse(readFileSync(new URL(packagePath, root), "utf8")).abi;
}

function makePlayers(manifest, count, rng) {
  return manifest.botWallets.slice(0, count).map(({ index, address }, i) => ({
    address: getAddress(address),
    persona: PERSONAS.find((p) => p.accountIndex === index),
    preferences: preferences[i],
    claimCycle: BigInt(manifest.cycle),
    ceiling: ceilings[i],
    fairBps: Array.from({ length: 8 }, () => pickInt(rng, 3200, 6800)),
    // Concentrate activity on three of the eight lots; five remain available for human-only play.
    lot: i,
  }));
}

export async function connectBots(manifest, { count = 3, seed = 42, signal } = {}) {
  const rng = createRng(integer(seed, 0, 0xffffffff, "V4_BOT_SEED"));
  count = integer(count, 1, 3, "V4_BOT_COUNT");
  const req = new FetchRequest(botRpcUrl(manifest.rpcUrl));
  const getUrl = req.getUrlFunc;
  req.getUrlFunc = async (...args) => {
    const response = await getUrl(...args);
    if (response.statusCode >= 300 && response.statusCode < 400)
      throw new Error("The playground RPC must not redirect");
    return response;
  };
  const provider = new JsonRpcProvider(req, 31337, {
    staticNetwork: true,
    cacheTimeout: -1,
    pollingInterval: 200,
  });
  async function verifyNode() {
    const [accounts, metadata, chainId] = await Promise.all([
      provider.send("eth_accounts", []),
      provider.send("hardhat_metadata", []),
      provider.send("eth_chainId", []),
    ]);
    validateBotSession(manifest, accounts, metadata, chainId);
  }
  try {
    await verifyNode();
    const gameArtifact = (name) =>
      artifact(gameRoot, `artifacts/production/contracts/production/${name}.sol/${name}.json`);
    const marketArtifact = (name) => artifact(marketRoot, `out/${name}.sol/${name}.json`);
    const game = new Contract(manifest.game, gameArtifact("CosmicSignatureGameV4"), provider);
    const auction = new Contract(
      manifest.auction,
      gameArtifact("CosmicSignatureArtAuction"),
      provider,
    );
    const token = new Contract(manifest.cst, gameArtifact("CosmicSignatureToken"), provider);
    const market = new Contract(
      manifest.market,
      marketArtifact("GameFundedOutcomeMarket"),
      provider,
    );
    const source = new Contract(manifest.source, marketArtifact("V3OutcomeSource"), provider);
    const bindings = await Promise.all([
      game.artAuction(),
      game.chaosZeroMarket(),
      game.token(),
      auction.game(),
      auction.nft(),
      market.game(),
      market.cst(),
      market.source(),
    ]);
    const expected = [
      manifest.auction,
      manifest.market,
      manifest.cst,
      manifest.game,
      manifest.nft,
      manifest.game,
      manifest.cst,
      manifest.source,
    ];
    if (
      bindings.some((value, i) => value !== getAddress(expected[i])) ||
      keccak256(await provider.getCode(manifest.auction)) !== manifest.auctionCodeHash
    )
      throw new Error("The bot manifest does not match the game's V4 contracts");
    const players = makePlayers(manifest, count, rng);
    for (const player of players) player.signer = await provider.getSigner(player.address);
    // Use the same trade solver as the Chaos Zero UI, including its exact rounding rules.
    const { quoteIndependentTrade } = site("tsx/cjs/api").require(
      "../../frontend/src/shared/independent-math.ts",
      import.meta.url,
    );

    async function send(player, contract, method, ...args) {
      await verifyNode();
      signal?.throwIfAborted();
      const tx = await contract.connect(player.signer)[method](...args);
      await tx.wait(1, 30_000);
      console.log(`[bots] ${player.persona.name} ${method} ${tx.hash}`);
      return method;
    }
    async function playGame(player, cycle, now, balance) {
      const [activation, end, last, exclusive, price, history] = await Promise.all([
        game.roundActivationTime(),
        game.mainPrizeTime(),
        game.lastBidderAddress(),
        game.timeoutDurationToClaimMainPrize(),
        game.getNextEthBidPrice(),
        game.biddersInfo(cycle, player.address),
      ]);
      let cst;
      if (
        last !== ZeroAddress &&
        now < end &&
        last !== player.address &&
        rng() < player.persona.style.cstAffinity
      ) {
        const [price, balance] = await Promise.all([
          game.getNextCstBidPrice(),
          token.balanceOf(player.address),
        ]);
        cst = { price, balance, spent: history.totalSpentCstAmount };
      }
      const action = gameChoice({
        now,
        activation,
        end,
        last,
        address: player.address,
        exclusive,
        price,
        spent: history.totalSpentEthAmount,
        cst,
        balance,
      });
      if (action === "cstGesture")
        return send(
          player,
          game,
          "bidWithCst",
          cst.price,
          `${player.persona.name} · local rehearsal`,
          0n,
        );
      if (action === "close") return send(player, game, "claimMainPrize");
      if (action === "gesture")
        return send(
          player,
          game,
          "bidWithEth",
          -1n,
          `${player.persona.name} · local rehearsal`,
          0n,
          {
            value: price,
          },
        );
      return null;
    }
    async function playMarket(player, cycle, now) {
      // A paused player can have claims spanning several cycles. Catch up one per turn.
      if (player.claimCycle < cycle) {
        const [, claim] = await market.previewClaim(player.claimCycle, player.address);
        if (claim > 0n) {
          const result = await send(player, market, "claimKnown", player.claimCycle);
          player.claimCycle++;
          return result;
        }
        player.claimCycle++;
      }
      const [open, , known] = await source.outcomeState(cycle);
      const unknown = Array.from({ length: 8 }, (_, i) => i).filter(
        (q) => !(known & (1n << BigInt(q))),
      );
      if (!open || !unknown.length) return null;
      const q = pickOne(rng, unknown);
      const [pool, funding, [yes, no], funds] = await Promise.all([
        market.questionState(cycle, q),
        market.fundingPreview(cycle, 0n),
        market.balancesOf(cycle, player.address),
        token.balanceOf(player.address),
      ]);
      const book = {
        collateral: pool.activeCollateral + funding.allocations[q],
        yes: pool.yesSupply,
        no: pool.noSupply,
        initialYesBps: 5000,
      };
      if (!book.collateral) return null;
      const order = marketOrder({
        knownMask: known,
        question: q,
        fairBps: player.fairBps[q],
        yesBps: funding.canFund ? 5000 : Number(pool.currentYesBps),
        yesHeld: yes[q],
        noHeld: no[q],
        funds,
        size: BigInt(pickInt(rng, 1, 4)) * 10n ** 18n,
      });
      if (!order) return null;
      const output = quoteIndependentTrade(book, order.yes, order.buy, order.input);
      if (!output || (order.buy && yes[q] + no[q] + output > marketLimit)) return null;
      if (order.buy && (await token.allowance(player.address, manifest.market)) < order.input)
        await send(player, token, "approve", manifest.market, order.input);
      return send(
        player,
        market,
        order.buy ? "buy" : "sell",
        cycle,
        q,
        order.yes,
        order.input,
        output,
        now + 60n,
      );
    }
    async function playAuction(player, now, balance) {
      if ((await auction.refundCredits(player.address)) > 0n)
        return send(player, auction, "withdrawRefund", player.address);
      const batches = await auction.registeredBatchCount();
      if (!batches) return null;
      const batch = rng() < 0.5 ? batches - 1n : BigInt(pickInt(rng, 0, Number(batches - 1n)));
      const offset = BigInt(rng() < 0.55 ? 0 : player.lot);
      let id = (await auction.firstNftIdByBatchIndex(batch)) + offset;
      let lot = await auction.getAuction(id);
      if (now < lot.eligibleAt && batch > 0n) {
        id = (await auction.firstNftIdByBatchIndex(0n)) + offset;
        lot = await auction.getAuction(id);
      }
      const minimum = await auction.minimumNextBid(id);
      const action = auctionChoice(lot, {
        now,
        address: player.address,
        minimum,
        balance,
        ceiling: player.ceiling,
      });
      if (action === "forward") return send(player, auction, "forwardProceeds", id);
      if (action === "settle") return send(player, auction, "settle", id);
      if (action === "collect") return send(player, auction, "claimNft", id, player.address);
      if (action === "bid") return send(player, auction, "bid", id, minimum, { value: minimum });
      return null;
    }
    let turn = 0;
    return {
      names: players.map((p) => p.persona.name),
      delay: () => pickInt(rng, 6000, 13000),
      close: () => provider.destroy(),
      async step(domain) {
        await verifyNode();
        const player = players[turn++ % players.length];
        const [cycle, head, balance] = await Promise.all([
          game.roundNum(),
          provider.getBlock("latest"),
          provider.getBalance(player.address),
        ]);
        if (balance < cashReserve) return null;
        const now = BigInt(head.timestamp);
        switch (domain ?? pickWeighted(rng, player.preferences)) {
          case "game":
            return playGame(player, cycle, now, balance);
          case "market":
            return playMarket(player, cycle, now);
          case "auction":
            return playAuction(player, now, balance);
          default:
            throw new Error("Unknown bot activity");
        }
      },
    };
  } catch (error) {
    provider.destroy();
    throw error;
  }
}

async function main() {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const manifest = JSON.parse(readFileSync(process.env.V4_PLAYGROUND_MANIFEST, "utf8"));
  const bots = await connectBots(manifest, {
    count: process.env.V4_BOT_COUNT,
    seed: process.env.V4_BOT_SEED,
    signal: controller.signal,
  });
  try {
    console.log(
      `[bots] Playing as ${bots.names.join(", ")} (seed ${process.env.V4_BOT_SEED ?? 42})`,
    );
    while (!controller.signal.aborted) {
      await sleep(bots.delay(), undefined, { signal: controller.signal });
      try {
        await bots.step();
      } catch (error) {
        if (!isError(error, "CALL_EXCEPTION")) throw error;
        console.log(`[bots] State changed before the action completed: ${error.shortMessage}`);
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    bots.close();
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
