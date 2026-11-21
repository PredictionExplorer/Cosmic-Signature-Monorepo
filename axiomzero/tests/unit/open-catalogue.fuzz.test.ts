import fc from "fast-check";
import { keccak256, zeroAddress } from "viem";
import { expect, it, vi } from "vitest";
import { fuzzParams } from "../helpers/fuzz";
import { readOpenLots } from "@/lib/auctions/client";

const chain = vi.hoisted(() => ({
  getChainId: async () => 31337,
  getBlock: vi.fn(),
  getCode: async () => "0x00",
  readContract: vi.fn(),
}));
vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createPublicClient: () => chain,
}));
const venue = "0x1111111111111111111111111111111111111111";
const game = "0x2222222222222222222222222222222222222222";
const nft = "0x3333333333333333333333333333333333333333";
vi.mock("@/lib/auctions/config", async (original) => ({
  ...(await original<typeof import("@/lib/auctions/config")>()),
  auctionChainId: 31337,
  requireAuctionConfig: () => ({
    address: venue,
    game,
    nft,
    hash: keccak256("0x00"),
    deploymentBlock: 1n,
  }),
}));

const batch = fc.record({
  gapInDays: fc.integer({ min: 0, max: 4 }), // includes simultaneous registrations
  extraNfts: fc.integer({ min: 0, max: 12 }),
  opening: fc.bigInt({ min: 1n, max: 10n ** 24n }),
  outcomes: fc.array(fc.constantFrom("unbid", "live", "ended", "sold"), {
    minLength: 8,
    maxLength: 8,
  }),
});
const day = 86400n;

it("pages through exactly the open lots at the snapshot, in cycle and token order", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(batch, { minLength: 1, maxLength: 18 }),
      fc.nat(),
      fc.constantFrom(-1n, 0n, 1n, 2n * day, 3n * day),
      async (generated, reference, offset) => {
        let eligibleAt = 7n * day;
        let nextToken = 0;
        const batches = generated.map((data, index) => {
          eligibleAt += BigInt(data.gapInDays) * day;
          const first = nextToken + data.extraNfts;
          nextToken = first + 8;
          return { ...data, first, roundNum: BigInt(index + 1), eligibleAt };
        });
        const boundary =
          batches[reference % batches.length].eligibleAt + offset;
        // The snapshot already contains every registration, including those still in preview.
        const lastRegistration =
          batches[batches.length - 1].eligibleAt - 7n * day;
        const now = boundary > lastRegistration ? boundary : lastRegistration;
        const records = batches.map((b) =>
          b.outcomes.map((outcome, i) => {
            const started = b.eligibleAt <= now && outcome !== "unbid";
            const closed =
              started &&
              now - b.eligibleAt >= 2n * day &&
              (outcome === "ended" || outcome === "sold");
            return {
              tokenId: b.first + i,
              record: {
                roundNum: b.roundNum,
                eligibleAt: b.eligibleAt,
                endAt: !started ? 0n : closed ? now : now + 2n * day,
                settled: closed && outcome === "sold",
                registered: true,
                delivered: false,
                proceedsForwarded: false,
                highestBidder: started
                  ? "0x4444444444444444444444444444444444444444"
                  : zeroAddress,
                highestBid: started ? b.opening : 0n,
              },
              minimum: started ? b.opening + (b.opening + 9n) / 10n : b.opening,
            };
          }),
        );
        const byId = new Map(records.flat().map((lot) => [lot.tokenId, lot]));
        const blockNumber = 73n;
        chain.getBlock.mockResolvedValue({
          number: blockNumber,
          timestamp: now,
        });
        chain.readContract.mockImplementation(async (request) => {
          expect(request.blockNumber).toBe(blockNumber);
          const index = Number(request.args?.[0]);
          switch (request.functionName) {
            case "game":
              return game;
            case "nft":
              return nft;
            case "registeredBatchCount":
              return BigInt(batches.length);
            case "firstNftIdByBatchIndex":
              return BigInt(batches[index].first);
            case "openingBidByRound":
              return batches[index - 1].opening;
            case "getNftSeed":
              return BigInt(index);
            case "getAuction":
              return byId.get(index)!.record;
            case "minimumNextBid":
              return byId.get(index)!.minimum;
            default:
              throw Error("Unexpected catalogue read: " + request.functionName);
          }
        });
        // Exhaustive linear oracle, independent of the production binary search,
        // bounded per-page search, and phaseOf implementation.
        const expected = records
          .slice()
          .reverse()
          .flat()
          .filter(
            ({ record }) =>
              record.eligibleAt <= now &&
              !record.settled &&
              (record.endAt === 0n || now < record.endAt),
          )
          .map((lot) => [lot.tokenId, lot.minimum]);
        const seen: Array<[number, bigint]> = [];
        let before: number | undefined;
        for (;;) {
          const page = await readOpenLots(before);
          seen.push(
            ...page.lots.map(
              (lot) => [lot.tokenId, lot.minimumNextBid] as [number, bigint],
            ),
          );
          if (page.nextBefore === null) break;
          expect(page.nextBefore).toBeGreaterThan(0n);
          expect(page.nextBefore).toBeLessThan(
            BigInt(before ?? batches.length),
          );
          before = Number(page.nextBefore);
        }
        expect(seen).toEqual(expected);
        chain.readContract.mockClear();
      },
    ),
    fuzzParams(100),
  );
});
