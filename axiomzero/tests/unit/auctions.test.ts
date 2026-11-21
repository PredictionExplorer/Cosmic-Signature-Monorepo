import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { auctionAbi } from "@/lib/auctions/abi";
import {
  eventPage,
  isUnknownAuction,
  readAuctionSales,
  readBatch,
  readBidHistory,
  readLot,
  readOpenLots,
  readWalletActivity,
  verifiedSnapshot,
} from "@/lib/auctions/client";
import {
  bidFunding,
  parseEthInput,
  phaseOf,
  type AuctionLot,
} from "@/lib/auctions/types";
import {
  submitAuctionAction,
  matchesAuctionTransaction,
} from "@/lib/auctions/actions";
import { isLocalAuctionRpc } from "@/lib/auctions/config";

const mocks = vi.hoisted(() => ({
  client: {
    getChainId: vi.fn(),
    getBlock: vi.fn(),
    getCode: vi.fn(),
    readContract: vi.fn(),
    getLogs: vi.fn(),
    call: vi.fn(),
    getTransaction: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
  },
  wallet: {
    getChainId: vi.fn(),
    getAddresses: vi.fn(),
    sendTransaction: vi.fn(),
  },
}));
vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createPublicClient: () => mocks.client,
  createWalletClient: () => mocks.wallet,
}));
const game = "0x6666666666666666666666666666666666666666" as Address;
const nft = "0x2222222222222222222222222222222222222222" as Address;
const address = "0x3333333333333333333333333333333333333333" as Address;
const holder = "0x4444444444444444444444444444444444444444" as Address;
const hash = ("0x" + "dd".repeat(32)) as Hex;
vi.mock("@/lib/auctions/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auctions/config")>()),
  auctionChainId: 31337,
  requireAuctionConfig: () => ({
    game,
    nft,
    address,
    hash: keccak256("0x1234"),
    deploymentBlock: 1n,
  }),
}));
const minedBlock = ("0x" + "ba".repeat(32)) as Hex;
const opening = 10n ** 15n;
const record = {
  registered: true,
  highestBid: 0n,
  highestBidder: zeroAddress,
  roundNum: 2n,
  eligibleAt: 110n,
  endAt: 0n,
  settled: false,
  delivered: false,
  proceedsForwarded: false,
};
const lot: AuctionLot = {
  ...record,
  openingBid: opening,
  minimumNextBid: opening,
  tokenId: 16,
  seed: hash,
};
function read({
  functionName,
  args,
}: {
  functionName: string;
  args?: readonly bigint[];
}) {
  switch (functionName) {
    case "game":
      return game;
    case "nft":
      return nft;
    case "getNftSeed":
      return args![0] + 1n;
    case "registeredBatchCount":
      return 2n;
    case "firstNftIdByBatchIndex":
      return 8n * (1n + args![0]);
    case "minimumNextBid":
    case "openingBidByRound":
      return opening;
    case "getAuction":
      return { ...record };
    case "refundCredits":
      return 7n;
    default:
      throw Error("Unexpected read " + functionName);
  }
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.readContract.mockImplementation(read);
  mocks.client.getChainId.mockResolvedValue(31337);
  mocks.client.getBlock.mockResolvedValue({ number: 10n, timestamp: 120n });
  mocks.client.getCode.mockResolvedValue("0x1234");
  mocks.wallet.getChainId.mockResolvedValue(31337);
  mocks.wallet.getAddresses.mockResolvedValue([holder]);
  mocks.wallet.sendTransaction.mockResolvedValue(hash);
  mocks.client.waitForTransactionReceipt.mockResolvedValue({
    status: "success",
    transactionHash: hash,
    blockHash: minedBlock,
    blockNumber: 11n,
  });
  mocks.client.getTransaction.mockImplementation(async ({ hash: txHash }) => {
    const reviewed = mocks.client.call.mock.calls[0][0];
    return {
      hash: txHash,
      chainId: 31337,
      blockHash: minedBlock,
      blockNumber: 11n,
      from: reviewed.account,
      to: reviewed.to,
      input: reviewed.data,
      value: reviewed.value,
    };
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("verified auction reads", () => {
  it("reads wallet-wide refund credit for the connected lot visitor at the same verified block", async () => {
    const publicLot = await readLot(16);
    expect(publicLot).not.toHaveProperty("accountRefund");
    expect(
      mocks.client.readContract.mock.calls.some(
        ([call]) => call.functionName === "refundCredits",
      ),
    ).toBe(false);
    const connectedLot = await readLot(16, holder);
    expect(connectedLot?.accountRefund).toEqual({
      account: holder,
      amount: 7n,
    });
    expect(mocks.client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address,
        functionName: "refundCredits",
        args: [holder],
        blockNumber: connectedLot?.blockNumber,
      }),
    );
    expect(mocks.client.getBlock).toHaveBeenCalledTimes(2);
  });
  it("preserves the public lot if only the connected wallet’s credit read fails", async () => {
    mocks.client.readContract.mockImplementation((call) => {
      if (call.functionName === "refundCredits")
        throw new Error("Credit unavailable");
      return read(call);
    });
    const result = await readLot(16, holder);
    expect(result?.accountRefund).toEqual({ account: holder, amount: null });
    expect(result?.lot.tokenId).toBe(16);
  });

  it("pins every contract call in a catalogue to one block and reads the batch opening price once", async () => {
    const b = await readBatch();
    expect(b.lots.map((l) => l.tokenId)).toEqual([
      16, 17, 18, 19, 20, 21, 22, 23,
    ]);
    expect(b.lots[0].seed.endsWith("11")).toBe(true);
    expect(b.lots[0].openingBid).toBe(opening);
    expect(
      mocks.client.readContract.mock.calls.every(
        ([c]) => c.blockNumber === 10n,
      ),
    ).toBe(true);
    expect(
      mocks.client.readContract.mock.calls.filter(
        ([c]) => c.functionName === "openingBidByRound",
      ),
    ).toHaveLength(1);
    expect((await readBatch(1)).lots[0].tokenId).toBe(8);
    expect((await readBatch(2)).lots).toEqual([]);
    await expect(readBatch(-1)).rejects.toThrow();
    await expect(readLot(1.1)).rejects.toThrow();
  });
  it("skips 59 preview cycles logarithmically and returns only bid-ready siblings at the boundary", async () => {
    mocks.client.readContract.mockImplementation((c) => {
      if (c.functionName === "registeredBatchCount") return 60n;
      if (c.functionName === "getAuction") {
        const id = c.args[0];
        return {
          ...record,
          eligibleAt: id < 16n ? 120n : 121n,
          settled: id === 9n,
          endAt: id === 10n ? 120n : id === 11n ? 121n : 0n,
        };
      }
      return read(c);
    });
    const page = await readOpenLots();
    expect(page.lots.map((l) => l.tokenId)).toEqual([8, 11, 12, 13, 14, 15]);
    expect(page.nextBefore).toBeNull();
    expect(
      mocks.client.readContract.mock.calls.filter(
        ([c]) => c.functionName === "firstNftIdByBatchIndex",
      ).length,
    ).toBeLessThanOrEqual(8);
    expect(
      mocks.client.readContract.mock.calls.filter(
        ([c]) => c.functionName === "getNftSeed",
      ),
    ).toHaveLength(6);
    expect(
      mocks.client.readContract.mock.calls.every(
        ([c]) => c.blockNumber === 10n,
      ),
    ).toBe(true);
  });
  it("limits each search and continues from the same batch index after new registrations", async () => {
    let count = 7n;
    mocks.client.readContract.mockImplementation((c) => {
      if (c.functionName === "registeredBatchCount") return count;
      if (c.functionName === "getAuction")
        return { ...record, settled: c.args[0] >= 32n };
      return read(c);
    });
    const first = await readOpenLots();
    expect(first.lots).toEqual([]);
    expect(first.nextBefore).toBe(3n);
    count += 5n;
    const next = await readOpenLots(Number(first.nextBefore));
    expect(next.lots.map((l) => l.tokenId)).toEqual([
      24, 25, 26, 27, 28, 29, 30, 31,
    ]);
    expect(next.nextBefore).toBe(2n);
    await expect(readOpenLots(-1)).rejects.toThrow();
  });
  it("distinguishes an empty deployment and a catalogue with every lot still in preview", async () => {
    let count = 0n;
    mocks.client.readContract.mockImplementation((c) => {
      if (c.functionName === "registeredBatchCount") return count;
      if (c.functionName === "getAuction")
        return { ...record, eligibleAt: 150n + c.args[0] / 8n };
      return read(c);
    });
    expect(await readOpenLots()).toMatchObject({
      count: 0n,
      firstOpening: null,
      lots: [],
      nextBefore: null,
    });
    count = 5n;
    expect(await readOpenLots()).toMatchObject({
      count: 5n,
      firstOpening: 151n,
      lots: [],
      nextBefore: null,
    });
  });
  it.each(["chain", "runtime", "game", "collection"])(
    "rejects a mismatched %s",
    async (name) => {
      if (name === "chain") mocks.client.getChainId.mockResolvedValue(1);
      if (name === "runtime") mocks.client.getCode.mockResolvedValue("0x65");
      if (name === "game" || name === "collection")
        mocks.client.readContract.mockImplementation((call) =>
          call.functionName === (name === "game" ? "game" : "nft")
            ? zeroAddress
            : read(call),
        );
      await expect(verifiedSnapshot()).rejects.toThrow();
    },
  );
  it("separates an unknown token from an unavailable RPC", async () => {
    expect((await readLot(16))?.lot.minimumNextBid).toBe(opening);
    mocks.client.readContract.mockImplementation((call) => {
      if (call.functionName === "getAuction")
        throw new BaseError("read failed", {
          cause: new ContractFunctionRevertedError({
            abi: auctionAbi,
            functionName: "getAuction",
            data: encodeErrorResult({
              abi: auctionAbi,
              errorName: "UnknownAuction",
              args: [16n],
            }),
          }),
        });
      return read(call);
    });
    expect(await readLot(16)).toBeNull();
    await expect(readLot(3)).rejects.toThrow();
    mocks.client.readContract.mockRejectedValue(new Error("offline"));
    await expect(readLot(16)).rejects.toThrow("offline");
  });
  it("distinguishes earned refunds, current leads and won undelivered lots", async () => {
    mocks.client.readContract.mockImplementation((call) => {
      if (call.functionName !== "getAuction") return read(call);
      const id = call.args[0];
      return id > 17n
        ? record
        : {
            ...record,
            highestBid: opening,
            highestBidder: holder,
            endAt: id === 16n ? 121n : 119n,
          };
    });
    const a = await readWalletActivity(holder);
    expect(a.refund).toBe(7n);
    expect(a.leading[0].tokenId).toBe(16);
    expect(a.won[0].tokenId).toBe(17);
  });
  it("pages provider-limited ranges without skipping the unread block", async () => {
    const readRange = vi.fn(async (from: bigint, to: bigint) => {
      if (to - from > 99n) throw Error("block range exceeds limit");
      return [from, to];
    });
    const { rows, nextBeforeBlock } = await eventPage(
      43n,
      3000n,
      undefined,
      readRange,
    );
    expect(rows[1]).toBe(3000n);
    expect(nextBeforeBlock).toBe(rows[0] - 1n);
    expect(await eventPage(43n, 3000n, 42n, readRange)).toEqual({
      rows: [],
      nextBeforeBlock: null,
    });
    await expect(
      eventPage(0n, 20n, undefined, async () => {
        throw Error("provider unavailable");
      }),
    ).rejects.toThrow("provider unavailable");
  });
  it("reads bids and completed sales from their respective event and excludes removed logs", async () => {
    const row = {
      args: {
        nftId: 16n,
        roundNum: 2n,
        amount: opening,
        bidder: holder,
        winner: holder,
        endAt: 500n,
      },
      blockNumber: 4n,
      transactionHash: hash,
      logIndex: 1,
      removed: false,
    };
    mocks.client.getLogs.mockResolvedValue([row, { ...row, removed: true }]);
    const { bids } = await readBidHistory(16);
    expect(bids).toHaveLength(1);
    expect(bids[0].hash).toBe(hash);
    const { sales } = await readAuctionSales(undefined, 16);
    expect(sales[0]).toMatchObject({
      tokenId: 16,
      timestamp: 120n,
      winner: holder,
    });
    expect(mocks.client.getLogs.mock.calls.map(([c]) => c.event.name)).toEqual([
      "AuctionBidPlaced",
      "AuctionSettled",
    ]);
  });
});

describe("funding and signed auction transactions", () => {
  const provider = {} as Parameters<typeof submitAuctionAction>[0];
  it("simulates the exact bid, checks the receipt and supports a leader increasing by the difference", async () => {
    mocks.client.readContract.mockImplementation((call) =>
      call.functionName === "getAuction"
        ? { ...record, highestBid: opening, highestBidder: holder }
        : read(call),
    );
    const review = vi.fn();
    await submitAuctionAction(
      provider,
      holder,
      {
        kind: "bid",
        tokenId: 16,
        total: opening * 2n,
        expectedFunding: opening,
      },
      review,
    );
    expect(mocks.client.call.mock.calls[0][0]).toMatchObject({
      account: holder,
      to: address,
      value: opening,
    });
    expect(mocks.wallet.sendTransaction.mock.calls[0][0]).toMatchObject(
      mocks.client.call.mock.calls[0][0],
    );
    expect(review).toHaveBeenCalledWith(hash);
  });
  it("rejects a changed wallet, price, funding or recipient before signing", async () => {
    const bid = {
      kind: "bid",
      tokenId: 16,
      total: opening,
      expectedFunding: opening,
    } as const;
    await expect(
      submitAuctionAction(provider, holder, { ...bid, total: 1n }, vi.fn()),
    ).rejects.toThrow("minimum bid");
    await expect(
      submitAuctionAction(
        provider,
        holder,
        { ...bid, expectedFunding: 2n },
        vi.fn(),
      ),
    ).rejects.toThrow("required ETH");
    await expect(
      submitAuctionAction(
        provider,
        holder,
        { kind: "withdrawRefund", recipient: address },
        vi.fn(),
      ),
    ).rejects.toThrow("recipient");
    mocks.wallet.getAddresses
      .mockResolvedValueOnce([holder])
      .mockResolvedValueOnce([game]);
    await expect(
      submitAuctionAction(provider, holder, bid, vi.fn()),
    ).rejects.toThrow("wallet account");
    expect(mocks.wallet.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(["settle", "claimNft", "forwardProceeds", "withdrawRefund"] as const)(
    "confirms %s with zero ETH",
    async (kind) => {
      await submitAuctionAction(
        provider,
        holder,
        { kind, tokenId: 16, recipient: holder },
        vi.fn(),
      );
      expect(mocks.client.call.mock.calls[0][0].value).toBe(0n);
    },
  );
  it("preserves an unconfirmed hash, detects receipt mismatches and rejects reverted transactions", async () => {
    const act = () =>
      submitAuctionAction(
        provider,
        holder,
        { kind: "settle", tokenId: 16 },
        vi.fn(),
      );
    mocks.client.waitForTransactionReceipt.mockRejectedValueOnce(
      Error("timeout"),
    );
    await expect(act()).rejects.toMatchObject({ hash });
    mocks.client.getTransaction.mockResolvedValueOnce({
      hash,
      blockHash: minedBlock,
      blockNumber: 11n,
      chainId: 31337,
      from: holder,
      to: address,
      input: "0x",
      value: 0n,
    });
    await expect(act()).rejects.toThrow("differs");
    mocks.client.waitForTransactionReceipt.mockResolvedValueOnce({
      transactionHash: hash,
      status: "reverted",
    });
    await expect(act()).rejects.toThrow("reverted");
    expect(
      matchesAuctionTransaction(
        { from: holder, to: null, input: "0x", value: 0n },
        { account: holder, to: address, data: "0x", value: 0n },
      ),
    ).toBe(false);
  });
  it("marks chain timestamp boundaries and restricts local endpoints", () => {
    expect([109n, 110n].map((t) => phaseOf(lot, t))).toEqual([
      "preview",
      "waiting",
    ]);
    expect(
      [119n, 120n].map((t) => phaseOf({ ...lot, endAt: 120n }, t)),
    ).toEqual(["active", "ended"]);
    expect(phaseOf({ ...lot, settled: true }, 120n)).toBe("settled");
    expect(isLocalAuctionRpc("https://example.test")).toBe(false);
    expect(isLocalAuctionRpc("http://127.0.0.1:8549")).toBe(true);
  });
  it("rejects imprecise or non-decimal ETH input", () => {
    for (const invalid of [
      "1e2",
      "+2",
      "00.2",
      "1.0000000000000000001",
      "-1",
      "0x1",
    ])
      expect(parseEthInput(invalid)).toBeNull();
  });
});

describe("auction read boundaries and event ordering", () => {
  it("rejects oversized IDs, missing code and impossible cursors", async () => {
    expect(isUnknownAuction(Error("network unavailable"), 1n)).toBe(false);
    mocks.client.readContract.mockImplementation((call) =>
      call.functionName === "firstNftIdByBatchIndex" ? 2n ** 54n : read(call),
    );
    await expect(readBatch()).rejects.toThrow("catalogue range");
    await expect(eventPage(0n, 3n, -1n, vi.fn())).rejects.toThrow();
    await expect(
      eventPage(1n, 1n, undefined, async () => {
        throw new Error("RPC range too large");
      }),
    ).rejects.toThrow();
    await expect(
      eventPage(1n, 3n, undefined, async () => {
        throw "transport failure";
      }),
    ).rejects.toBe("transport failure");
    mocks.client.getCode.mockResolvedValueOnce(undefined);
    await expect(verifiedSnapshot()).rejects.toThrow();
    mocks.client.getCode.mockResolvedValueOnce("0x");
    await expect(verifiedSnapshot()).rejects.toThrow();
  });
  it("sorts settled lots by block and log without treating separate bids as sales", async () => {
    const row = {
      removed: false,
      args: { nftId: 16n, roundNum: 2n, amount: opening, winner: holder },
      transactionHash: hash,
    };
    mocks.client.getLogs.mockResolvedValue(
      [
        [6n, 2],
        [8n, 1],
        [6n, 3],
        [4n, 1],
      ].map(([blockNumber, logIndex]) => ({ ...row, blockNumber, logIndex })),
    );
    const { sales } = await readAuctionSales();
    expect(
      sales.map(({ blockNumber, logIndex }) => [blockNumber, logIndex]),
    ).toEqual([
      [8n, 1],
      [6n, 3],
      [6n, 2],
      [4n, 1],
    ]);
    expect(mocks.client.getBlock).toHaveBeenCalledTimes(4);
  });
  it("rejects an overflowing amount and accepts whole ETH", () => {
    expect(parseEthInput("9".repeat(60))).toBeNull();
    expect(parseEthInput(" 1 ")).toBe(10n ** 18n);
    expect(() => bidFunding(lot, 2n ** 256n, holder)).toThrow();
  });
});
describe("wallet replacement and recovery", () => {
  const act = (notify = vi.fn()) =>
    submitAuctionAction(
      {} as Parameters<typeof submitAuctionAction>[0],
      holder,
      { kind: "settle", tokenId: 16 },
      notify,
    );
  const replacement = ("0x" + "0f".repeat(32)) as Hex;
  it.each(["repriced", "replaced", "different value"] as const)(
    "handles receipt replacement: %s",
    async (reason) => {
      mocks.client.waitForTransactionReceipt.mockImplementationOnce(
        async ({ onReplaced }) => {
          const request = mocks.client.call.mock.calls[0][0];
          onReplaced({
            reason: reason === "different value" ? "repriced" : reason,
            transaction: {
              to: request.to,
              from: holder,
              input: request.data,
              value: reason === "different value" ? 1n : 0n,
              hash: replacement,
            },
          });
          return {
            transactionHash: replacement,
            status: "success",
            blockHash: minedBlock,
            blockNumber: 11n,
          };
        },
      );
      const notify = vi.fn();
      if (reason === "repriced") {
        await act(notify);
        expect(notify.mock.calls).toEqual([[hash], [replacement]]);
      } else {
        await expect(act(notify)).rejects.toThrow("replaced");
      }
    },
  );
  it("preserves a pending receipt when its transaction cannot be fetched; rejects a conflicting hash", async () => {
    mocks.client.getTransaction.mockRejectedValueOnce(
      Error("Archive unavailable"),
    );
    await expect(act()).rejects.toMatchObject({ hash });
    mocks.client.waitForTransactionReceipt.mockResolvedValueOnce({
      status: "success",
      transactionHash: replacement,
    });
    await expect(act()).rejects.toMatchObject({
      hash,
      message: expect.stringContaining("submitted"),
    });
  });
  it.each([
    { blockHash: null },
    { blockHash: hash },
    { blockNumber: 12n },
    { chainId: 42161 },
    { hash: replacement },
  ])(
    "preserves a submitted transaction when receipt and inclusion disagree: %o",
    async (disagreement) => {
      mocks.client.getTransaction.mockImplementationOnce(async () => {
        const reviewed = mocks.client.call.mock.calls[0][0];
        return {
          hash,
          chainId: 31337,
          blockHash: minedBlock,
          blockNumber: 11n,
          from: holder,
          to: address,
          input: reviewed.data,
          value: reviewed.value,
          ...disagreement,
        };
      });
      await expect(act()).rejects.toMatchObject({
        hash,
        message: expect.stringContaining("submitted"),
      });
    },
  );
  it("accepts an older transaction without a chain ID when its hash, inclusion and economic intent match on the verified RPC", async () => {
    mocks.client.getTransaction.mockImplementationOnce(async () => {
      const reviewed = mocks.client.call.mock.calls[0][0];
      return {
        hash,
        blockHash: minedBlock,
        blockNumber: 11n,
        from: holder,
        to: address,
        input: reviewed.data,
        value: reviewed.value,
      };
    });
    await expect(act()).resolves.toMatchObject({ transactionHash: hash });
  });
  it("requires the intended chain and a selected account even when connector state is stale", async () => {
    mocks.wallet.getChainId.mockResolvedValueOnce(42161);
    await expect(act()).rejects.toThrow("network changed");
    mocks.wallet.getAddresses.mockResolvedValueOnce([]);
    await expect(act()).rejects.toThrow("account or network");
    expect(mocks.client.call).not.toHaveBeenCalled();
  });
});
