// The interactive smoke runs this before starting the indexer, on an exclusively owned seed.
import assert from "node:assert/strict";
import { JsonRpcProvider } from "ethers";
import { connectBots, botRpcUrl } from "./bots.mjs";

export async function verifyBots(manifest) {
  const bots = await connectBots(manifest, { count: 3, seed: 42 });
  const provider = new JsonRpcProvider(botRpcUrl(manifest.rpcUrl), 31337, {
    staticNetwork: true,
    cacheTimeout: -1,
  });
  let snapshot;
  try {
    snapshot = await provider.send("evm_snapshot", []);
    const nonces = () =>
      Promise.all(manifest.botWallets.map(({ address }) => provider.getTransactionCount(address)));
    const humanNonces = () =>
      Promise.all(
        manifest.humanWallets.map(({ address }) => provider.getTransactionCount(address)),
      );
    const before = await nonces();
    const humans = await humanNonces();
    await provider.send("evm_increaseTime", [8]);
    await provider.send("evm_mine", []);
    async function until(domain, method) {
      for (let i = 0; i < 18; i++) if ((await bots.step(domain)) === method) return;
      assert.fail(`Expected a confirmed bot ${method} on ${domain}`);
    }
    await until("game", "bidWithEth");
    await until("market", "buy");
    await until("auction", "bid");
    await until("auction", "withdrawRefund");
    await provider.send("evm_increaseTime", [2 * 86400 + 601]);
    await provider.send("evm_mine", []);
    await until("auction", "settle");
    await until("auction", "claimNft");
    await until("auction", "forwardProceeds");
    await until("game", "claimMainPrize");
    assert.ok(
      (await nonces()).every((nonce, i) => nonce > before[i]),
      "Each bot used its own wallet",
    );
    assert.deepEqual(await humanNonces(), humans, "No bot signed as a human");
  } finally {
    try {
      if (snapshot !== undefined) assert.equal(await provider.send("evm_revert", [snapshot]), true);
    } finally {
      provider.destroy();
      bots.close();
    }
  }
}
