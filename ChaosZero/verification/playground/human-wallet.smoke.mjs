// Called by --interactive-smoke with its own disposable session, never the human session pointer.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Contract, JsonRpcProvider, parseEther } from "ethers";
import { enableWallet } from "./human-wallet.mjs";

const { chromium, expect } = createRequire(
  new URL("../../../Cosmic-Signature-frontend/package.json", import.meta.url),
)("@playwright/test");
const session = JSON.parse(await readFile(process.argv[2], "utf8"));
const rpc = new JsonRpcProvider(session.rpcUrl);
const market = new Contract(
  session.market,
  ["function balancesOf(uint256,address) view returns(uint256[8],uint256[8])"],
  rpc,
);
const auction = new Contract(
  session.auction,
  [
    "function refundCredits(address) view returns(uint256)",
    "function minimumNextBid(uint256) view returns(uint256)",
  ],
  rpc,
);
const browser = await chromium.launch();
try {
  async function player(index) {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const wallet = await enableWallet(context, session, index);
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    async function connect(url, name) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name }).first().click();
      await page
        .getByRole("button", { name: new RegExp("Playground Wallet " + index, "i") })
        .first()
        .click();
    }
    async function review(button, approve = true) {
      const pending = context.waitForEvent("page", { timeout: 30_000 });
      await button.click();
      const prompt = await pending;
      await expect(prompt.locator("#summary")).toContainText(wallet.address);
      await prompt
        .getByRole("button", { name: approve ? "Confirm transaction" : "Cancel", exact: true })
        .click();
    }
    return { page, wallet, connect, review };
  }
  const alice = await player(1);
  await alice.connect(session.cosmicUrl + "/experimental-ui", /connect.*wallet/i);
  const form = alice.page.locator("#make-gesture");
  const message = "Human V4 wallet rehearsal";
  await form.getByTestId("gesture-message-input").fill(message);
  await alice.review(form.getByTestId("gesture-submit"));
  await expect(alice.page.getByTestId("gesture-message-chat")).toContainText(message, {
    timeout: 60_000,
  });

  await alice.connect(session.chaosUrl, /^Connect wallet$/i);
  const panel = alice.page.getByTestId("independent-trade-panel");
  await panel.getByLabel(/CST to spend/).fill("1");
  await alice.review(panel.getByRole("button", { name: "Approve CST to trade" }));
  await alice.review(panel.getByRole("button", { name: "Buy YES", exact: true }));
  await expect
    .poll(async () => (await market.balancesOf(session.cycle, alice.wallet.address))[0][0], {
      timeout: 20_000,
    })
    .toBeGreaterThan(0n);

  const token = BigInt(session.firstAuctionTokenId);
  const url = session.axiomUrl + "/auctions/" + token;
  const bob = await player(2);
  for (const [user, amount] of [
    [alice, "0.001"],
    [bob, "0.0011"],
  ]) {
    await user.connect(url, /^Connect wallet$/i);
    await user.page.getByRole("textbox", { name: "Total bid (ETH)" }).fill(amount);
    await user.page.getByRole("button", { name: "Place bid", exact: true }).click();
    await user.review(user.page.getByRole("button", { name: "Confirm bid", exact: true }));
    await expect
      .poll(() => auction.minimumNextBid(token), { timeout: 20_000 })
      .toBeGreaterThan(parseEther(amount));
  }
  assert.equal(await auction.refundCredits(alice.wallet.address), parseEther("0.001"));
  // Cancel a new transaction from the same browser and confirm no transaction was submitted.
  const before = await rpc.getTransactionCount(bob.wallet.address);
  const reviewOpened = bob.page.context().waitForEvent("page");
  const result = bob.page.evaluate(async (to) => {
    const from = (await window.ethereum.request({ method: "eth_accounts" }))[0];
    try {
      await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{ from, to, value: "0x1" }],
      });
    } catch (e) {
      return e.code;
    }
  }, alice.wallet.address);
  const cancel = await reviewOpened;
  await cancel.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await result, 4001);
  assert.equal(await rpc.getTransactionCount(bob.wallet.address), before);
  console.log(
    "Two human wallets played the game, traded CST, competed in a funded auction and cancelled a transaction.",
  );
} finally {
  await browser.close();
  rpc.destroy();
}
