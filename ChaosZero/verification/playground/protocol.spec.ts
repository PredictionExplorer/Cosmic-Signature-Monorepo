import { expect, test, type BrowserContext } from "@playwright/test";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  formatEther,
  getAddress,
  http,
  parseAbi,
  parseAbiItem,
  parseEther,
  parseEventLogs,
  type Address,
} from "viem";
import { hardhat } from "viem/chains";
import { axiomUrl, chaosUrl, deployment } from "./deployment";

const gameAbi = parseAbi([
  "function roundNum() view returns (uint256)",
  "function mainPrizeTime() view returns (uint256)",
  "function artAuction() view returns (address)",
  "function chaosZeroMarket() view returns (address)",
  "function claimMainPrize()",
]);
const positionAbi = parseAbi([
  "function balancesOf(uint256 roundId, address user) view returns (uint256[8], uint256[8])",
  "function cst() view returns (address)",
]);
const bidPlaced = parseAbiItem(
  "event BidPlaced(uint256 indexed roundNum,address indexed lastBidderAddress,int256 paidEthPrice,int256 paidCstPrice,int256 indexed randomWalkNftId,string message,uint256 bidCstRewardAmount,uint256 cstBidPriceDeclineMultiplier,uint256 mainPrizeTime)",
);
const auctionAbi = parseAbi([
  "event AuctionBatchRegistered(uint256 indexed roundNum,uint256 indexed firstNftId,uint256 count,uint256 eligibleAt,uint256 openingBid)",
  "event AuctionBidPlaced(uint256 indexed nftId,uint256 indexed roundNum,address indexed bidder,uint256 amount,uint256 ethPaid,uint256 endAt)",
]);

// The local provider sends real requests to the same node used by the application's read client.
// Only the selected unlocked account may sign, and only on the displayed test site.
async function installAuctionWallet(context_: BrowserContext, actor_: Address) {
  await context_.addInitScript(
    ({ rpc, address, auction, origin }) => {
      if (window.location.origin !== origin) return;
      let connected = sessionStorage.getItem("v4-wallet") === address;
      const listeners = new Map<string, Set<(value: unknown) => void>>();
      const provider = {
        on(event: string, listener: (value: unknown) => void) {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)!.add(listener);
          return provider;
        },
        removeListener(event: string, listener: (value: unknown) => void) {
          listeners.get(event)?.delete(listener);
          return provider;
        },
        async request({
          method,
          params = [],
        }: {
          method: string;
          params?: Array<Record<string, string>>;
        }) {
          if (method === "eth_requestAccounts" || method === "wallet_requestPermissions") {
            connected = true;
            sessionStorage.setItem("v4-wallet", address);
          }
          if (method === "eth_chainId") return "0x7a69";
          if (method === "eth_accounts" || method === "eth_requestAccounts")
            return connected ? [address] : [];
          if (method === "wallet_getPermissions" || method === "wallet_requestPermissions")
            return connected ? [{ parentCapability: "eth_accounts" }] : [];
          if (method === "wallet_switchEthereumChain" && params[0]?.chainId === "0x7a69")
            return null;
          if (method === "eth_sendTransaction") {
            if (
              !connected ||
              params[0]?.from?.toLowerCase() !== address.toLowerCase() ||
              params[0]?.to?.toLowerCase() !== auction.toLowerCase()
            ) {
              throw new Error("Unexpected V4 browser wallet transaction.");
            }
          } else if (
            ![
              "eth_call",
              "eth_estimateGas",
              "eth_gasPrice",
              "eth_feeHistory",
              "eth_getTransactionCount",
              "eth_getBlockByNumber",
              "eth_getBalance",
              "eth_maxPriorityFeePerGas",
            ].includes(method)
          ) {
            throw Object.assign(new Error("Unsupported test wallet method " + method), {
              code: 4200,
            });
          }
          const response = await fetch(rpc, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          });
          const body = await response.json();
          if (body.error) throw Object.assign(new Error(body.error.message), body.error);
          return body.result;
        },
      };
      const detail = {
        info: {
          uuid: "d08c624c-99b2-46aa-86da-9aa053a2fe10",
          name: "Playground Wallet",
          rdns: "test.cosmicsignature.playground",
          icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
        },
        provider,
      };
      const announce = () =>
        window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { rpc: deployment.rpcUrl, address: actor_, auction: deployment.auction, origin: axiomUrl },
  );
}

test("one V4 cycle connects a Cosmic Signature gesture, a Chaos Zero position and an Axiom Zero bid", async ({
  page,
  context,
}) => {
  const { rpcUrl, game, market, auction, actor, cst } = deployment;
  const cycle = BigInt(deployment.cycle);
  const transport = http(rpcUrl);
  const chain = createPublicClient({
    chain: hardhat,
    transport,
    pollingInterval: 200,
    cacheTime: 0,
  });
  const director = createTestClient({ chain: hardhat, mode: "hardhat", transport });
  const wallet = createWalletClient({ chain: hardhat, account: actor, transport });
  expect(await chain.getChainId()).toBe(31337);
  expect(await chain.readContract({ address: game, abi: gameAbi, functionName: "roundNum" })).toBe(
    cycle,
  );
  expect(
    await chain.readContract({ address: game, abi: gameAbi, functionName: "artAuction" }),
  ).toBe(getAddress(auction));
  expect(
    await chain.readContract({ address: game, abi: gameAbi, functionName: "chaosZeroMarket" }),
  ).toBe(getAddress(market));
  expect(await chain.readContract({ address: market, abi: positionAbi, functionName: "cst" })).toBe(
    getAddress(cst),
  );
  const startBlock = await chain.getBlockNumber();

  await context.route(/^https?:\/\//, (route) => {
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(route.request().url()).hostname,
    );
    return local ? route.continue() : route.abort();
  });
  await installAuctionWallet(context, actor);

  await test.step("Submit an ETH gesture and observe its indexed message", async () => {
    await page.goto(deployment.cosmicUrl + "/experimental-ui", { waitUntil: "domcontentloaded" });
    await page.getByTestId("harness-open").click();
    await page.getByTestId("harness-persona-select").selectOption("Nova");
    await page.getByRole("button", { name: "Close harness panel" }).click();
    const form = page.locator("#make-gesture");
    const message = "V4 playground cycle " + cycle + " at block " + startBlock;
    await form.getByTestId("gesture-message-input").fill(message);
    await form.getByTestId("gesture-submit").click();
    await expect
      .poll(async () => {
        const logs = await chain.getLogs({
          address: game,
          event: bidPlaced,
          fromBlock: startBlock + 1n,
          args: { roundNum: cycle, lastBidderAddress: actor },
          strict: true,
        });
        return logs.map((log) => log.args.message);
      })
      .toContain(message);
    await expect(page.getByTestId("gesture-message-chat")).toContainText(message, {
      timeout: 60_000,
    });
  });

  await test.step("Buy an outcome in the same cycle with the same wallet", async () => {
    const positions = () =>
      chain.readContract({
        address: market,
        abi: positionAbi,
        functionName: "balancesOf",
        args: [cycle, actor],
      });
    const [before] = await positions();
    await page.goto(chaosUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("independent-cycle")).toHaveText("Cycle " + cycle);
    await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Mock Connector 1", exact: true })
      .click();
    const panel = page.getByTestId("independent-trade-panel");
    await panel.getByLabel(/CST to spend/).fill("1");
    await panel.getByRole("button", { name: "Approve CST to trade" }).click();
    await panel.getByRole("button", { name: "Buy YES", exact: true }).click();
    await expect(
      page.getByText("Position purchase confirmed.", { exact: true }).first(),
    ).toBeVisible();
    await expect.poll(async () => (await positions())[0][0]).toBeGreaterThan(before[0]);
  });

  await test.step("Close that cycle and bid through the catalogue on one of its eight works", async () => {
    const deadline = await chain.readContract({
      address: game,
      abi: gameAbi,
      functionName: "mainPrizeTime",
    });
    const now = (await chain.getBlock()).timestamp;
    if (deadline >= now) {
      await director.setNextBlockTimestamp({ timestamp: deadline + 1n });
      await director.mine({ blocks: 1 });
    }
    const closeHash = await wallet.writeContract({
      address: game,
      abi: gameAbi,
      functionName: "claimMainPrize",
    });
    const receipt = await chain.waitForTransactionReceipt({ hash: closeHash });
    expect(receipt.status).toBe("success");
    const events = parseEventLogs({
      abi: auctionAbi,
      eventName: "AuctionBatchRegistered",
      logs: receipt.logs.filter((log) => getAddress(log.address) === getAddress(auction)),
    });
    expect(events).toHaveLength(1);
    const { roundNum, firstNftId, eligibleAt, count, openingBid } = events[0]!.args;
    expect(roundNum).toBe(cycle);
    expect(count).toBe(8n);
    expect(openingBid).toBe(parseEther("0.001"));
    await director.setNextBlockTimestamp({ timestamp: eligibleAt });
    await director.mine({ blocks: 1 });
    const lot = "/auctions/" + firstNftId;
    await page.goto(axiomUrl + "/auctions", { waitUntil: "domcontentloaded" });
    await page
      .locator('a[href="' + lot + '"]')
      .first()
      .click();
    await page.getByRole("button", { name: "Connect wallet" }).first().click();
    await page
      .getByRole("button", { name: /Playground Wallet/i })
      .first()
      .click();
    await page.getByRole("textbox", { name: "Total bid (ETH)" }).fill(formatEther(openingBid));
    await page.getByRole("button", { name: "Review bid", exact: true }).click();
    await page.getByRole("button", { name: "Confirm in wallet", exact: true }).click();
    await expect
      .poll(async () => {
        const logs = await chain.getLogs({
          address: auction,
          event: auctionAbi[1],
          fromBlock: receipt.blockNumber,
          args: { nftId: firstNftId, roundNum: cycle, bidder: actor },
          strict: true,
        });
        return logs.map((log) => log.args.ethPaid);
      })
      .toEqual([openingBid]);
    await expect(page.getByRole("textbox", { name: "Total bid (ETH)" })).toHaveValue("0.0011");
  });
});
