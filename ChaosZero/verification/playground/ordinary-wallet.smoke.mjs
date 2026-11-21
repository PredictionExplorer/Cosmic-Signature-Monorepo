// This rehearsal uses a fresh browser context with no extension or Playwright-injected provider.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { expect } = createRequire(
  new URL("../../../Cosmic-Signature-frontend/package.json", import.meta.url),
)("@playwright/test");

function accountButton(page, address) {
  return page
    .getByRole("button", { name: new RegExp(address.slice(0, 4) + ".*" + address.slice(-4), "i") })
    .first();
}

export async function exerciseOrdinaryWallet(browser, session, rpc) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const alice = session.humanWallets[0].address;
    const bob = session.humanWallets[1].address;
    const urls = [
      session.cosmicUrl + "/experimental-ui",
      session.chaosUrl,
      session.axiomUrl + "/auctions",
    ];
    const pages = await Promise.all(
      urls.map(async (url) => {
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await expect(accountButton(page, alice)).toBeVisible({ timeout: 30_000 });
        await expect(
          page.getByRole("combobox", { name: "Playground wallet", exact: true }),
        ).toHaveValue("1");
        return page;
      }),
    );
    const game = pages[0];
    const select = game.getByRole("combobox", { name: "Playground wallet", exact: true });
    await select.selectOption("2");
    await expect(accountButton(game, bob)).toBeVisible({ timeout: 30_000 });
    await game.reload({ waitUntil: "domcontentloaded" });
    await expect(select).toHaveValue("2");
    await expect(accountButton(game, bob)).toBeVisible({ timeout: 30_000 });
    for (const page of pages.slice(1)) await expect(accountButton(page, alice)).toBeVisible();

    const transfer = () =>
      game.evaluate(
        async ({ from, to }) => {
          try {
            const hash = await window.ethereum.request({
              method: "eth_sendTransaction",
              params: [{ from, to, value: "0x1" }],
            });
            return { hash };
          } catch (error) {
            return { code: error.code };
          }
        },
        { from: bob, to: alice },
      );
    const nonce = () => rpc.send("eth_getTransactionCount", [bob, "pending"]);
    const before = BigInt(await nonce());
    const review = game.getByRole("dialog", { name: "Review local transaction", exact: true });
    const cancelled = transfer();
    await expect(review).toBeVisible();
    await expect(review).toContainText(bob);
    await review.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.deepEqual(await cancelled, { code: 4001 });
    assert.equal(BigInt(await nonce()), before);

    const approved = transfer();
    await expect(review).toContainText(alice);
    await review.getByRole("button", { name: "Confirm transaction", exact: true }).click();
    const { hash } = await approved;
    assert.match(hash, /^0x[0-9a-f]{64}$/i);
    const receipt = await rpc.waitForTransaction(hash, 1, 30_000);
    assert.equal(receipt.status, 1);
    const tx = await rpc.getTransaction(hash);
    assert.equal(tx.from.toLowerCase(), bob.toLowerCase());
    assert.equal(tx.to.toLowerCase(), alice.toLowerCase());
    assert.equal(tx.value, 1n);
    assert.equal(BigInt(await nonce()), before + 1n);
    console.log(
      "Ordinary browser wallets connected on all three sites, switched and survived reload. A rejected transfer kept its nonce; the approved transfer used the selected account.",
    );
  } finally {
    await context.close();
  }
}
