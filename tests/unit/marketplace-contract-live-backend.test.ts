import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MarketOffer } from "@/lib/marketplace/types";

/**
 * The collection backends replace the RPC offer scan outside tests
 * (NODE_ENV gate in shouldUseCollectionBackend), so these paths are covered
 * with a stubbed production env and mocked backend adapters. The adapters
 * themselves are tested in random-walk-market-live.test.ts and
 * cosmic-signature-market-live.test.ts.
 */
const backendMocks = vi.hoisted(() => ({
  fetchRandomWalkOffers: vi.fn(),
  fetchCosmicSignatureOffers: vi.fn(),
}));

vi.mock("@/lib/marketplace/random-walk-market-live", () => ({
  fetchRandomWalkOffers: backendMocks.fetchRandomWalkOffers,
}));

vi.mock("@/lib/marketplace/cosmic-signature-market-live", () => ({
  fetchCosmicSignatureOffers: backendMocks.fetchCosmicSignatureOffers,
}));

import {
  fetchCollectionContractOffers,
  fetchContractOffersForTokenId,
  resetMarketplaceOfferScanCacheForTests,
  type MarketplaceOfferTuple,
} from "@/lib/marketplace/marketplace-contract-live";

const randomWalkNft = "0x895a6F444BE4ba9d124F61DF736605792B35D66b" as const;
const cosmicNft = "0xbb84Be3500A63581d3F2d5AC3bdF8685AAedad25" as const;
const marketplace = "0x47eF85Dfb775aCE0934fBa9EEd09D22e6eC0Cc08" as const;
const zero = "0x0000000000000000000000000000000000000000" as const;
const seller = "0x0000000000000000000000000000000000000001" as const;

function backendOffer(overrides: Partial<MarketOffer> = {}): MarketOffer {
  return {
    id: "random-walk-sell-12",
    offerId: 12,
    collectionId: "random-walk",
    tokenId: 1233,
    kind: "sell",
    priceEth: 0.1,
    maker: seller,
    createdAt: "2021-11-12T03:37:31.000Z",
    active: true,
    ...overrides,
  };
}

function chainOffer(tokenId: bigint): MarketplaceOfferTuple {
  return [randomWalkNft, tokenId, 1_000_000_000_000_000_000n, seller, zero, true];
}

function mockClient(offers: Record<number, MarketplaceOfferTuple>) {
  const readContract = vi.fn(async (call: { functionName: string }) => {
    if (call.functionName === "numOffers") {
      return BigInt(Object.keys(offers).length);
    }
    if (call.functionName === "getSellOffers") {
      return [0n];
    }
    if (call.functionName === "getBuyOffers") {
      return [];
    }

    throw new Error(`Unexpected read ${call.functionName}`);
  });
  const multicall = vi.fn(
    async (call: {
      contracts: readonly { args?: readonly unknown[] }[];
    }) =>
      call.contracts.map((contract) => {
        const result = offers[Number(contract.args?.[0])];
        return result
          ? ({ status: "success", result } as const)
          : ({ status: "failure", error: new Error("missing") } as const);
      }),
  );

  return { readContract, multicall };
}

describe("marketplace contract live backend preference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMarketplaceOfferScanCacheForTests();
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("prefers the Random Walk backend for collection offers", async () => {
    backendMocks.fetchRandomWalkOffers.mockResolvedValue([backendOffer()]);
    const client = mockClient({});

    const offers = await fetchCollectionContractOffers({
      collectionId: "random-walk",
      nftAddress: randomWalkNft,
      marketplaceAddress: marketplace,
      client,
    });

    expect(offers).toEqual([expect.objectContaining({ offerId: 12 })]);
    expect(client.readContract).not.toHaveBeenCalled();
    expect(client.multicall).not.toHaveBeenCalled();
  });

  it("falls back to the RPC scan when the Random Walk backend fails", async () => {
    backendMocks.fetchRandomWalkOffers.mockRejectedValue(
      new Error("backend down"),
    );
    const client = mockClient({ 0: chainOffer(7n) });

    const offers = await fetchCollectionContractOffers({
      collectionId: "random-walk",
      nftAddress: randomWalkNft,
      marketplaceAddress: marketplace,
      client,
    });

    expect(offers).toEqual([
      expect.objectContaining({ collectionId: "random-walk", tokenId: 7 }),
    ]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringMatching(/random-walk offers via backend unavailable/),
    );
  });

  it("prefers the Cosmic Signature backend and resolves artwork per token", async () => {
    backendMocks.fetchCosmicSignatureOffers.mockResolvedValue([
      backendOffer({
        id: "cosmic-signature-sell-3",
        offerId: 3,
        collectionId: "cosmic-signature",
        tokenId: 1,
      }),
      backendOffer({
        id: "cosmic-signature-buy-4",
        offerId: 4,
        collectionId: "cosmic-signature",
        tokenId: 1,
        kind: "buy",
      }),
      backendOffer({
        id: "cosmic-signature-sell-5",
        offerId: 5,
        collectionId: "cosmic-signature",
        tokenId: 2,
        artwork: { image: "backend-2.png", alt: "Backend artwork 2" },
      }),
    ]);
    const loadToken = vi.fn(async (tokenId: number) =>
      tokenId === 1
        ? {
            collectionId: "cosmic-signature" as const,
            tokenId,
            name: `Cosmic Signature #${tokenId}`,
            owner: zero,
            seed: "seed",
            traits: [],
            artwork: { image: "token-1.png", alt: "Token 1 artwork" },
          }
        : undefined,
    );
    const client = mockClient({});

    const offers = await fetchCollectionContractOffers({
      collectionId: "cosmic-signature",
      nftAddress: cosmicNft,
      marketplaceAddress: marketplace,
      loadToken,
      client,
    });

    expect(offers.map((offer) => offer.artwork?.image)).toEqual([
      "token-1.png",
      "token-1.png",
      "backend-2.png",
    ]);
    // Token ids are de-duplicated before artwork resolution.
    expect(loadToken).toHaveBeenCalledTimes(2);
    expect(client.readContract).not.toHaveBeenCalled();
  });

  it("falls back to the RPC scan when the Cosmic Signature backend fails", async () => {
    backendMocks.fetchCosmicSignatureOffers.mockRejectedValue(
      new Error("backend down"),
    );
    const client = mockClient({});

    await expect(
      fetchCollectionContractOffers({
        collectionId: "cosmic-signature",
        nftAddress: cosmicNft,
        marketplaceAddress: marketplace,
        client,
      }),
    ).resolves.toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringMatching(/cosmic-signature offers via backend unavailable/),
    );
    expect(client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "numOffers" }),
    );
  });

  it("filters Random Walk backend offers to the requested token id", async () => {
    backendMocks.fetchRandomWalkOffers.mockResolvedValue([
      backendOffer({ tokenId: 9 }),
      backendOffer({ id: "random-walk-sell-13", offerId: 13, tokenId: 1233 }),
    ]);

    // No injected client: the default RPC client is constructed but the
    // backend answers before any chain read happens.
    const offers = await fetchContractOffersForTokenId({
      collectionId: "random-walk",
      nftAddress: randomWalkNft,
      marketplaceAddress: marketplace,
      tokenId: 1233,
    });

    expect(offers).toEqual([expect.objectContaining({ offerId: 13 })]);
  });

  it("attaches caller artwork to Cosmic Signature token offers", async () => {
    const cosmicOffer = backendOffer({
      id: "cosmic-signature-sell-3",
      offerId: 3,
      collectionId: "cosmic-signature",
      tokenId: 7,
      artwork: { image: "backend.png", alt: "Backend artwork" },
    });
    backendMocks.fetchCosmicSignatureOffers.mockResolvedValue([cosmicOffer]);
    const client = mockClient({});

    const withCallerArtwork = await fetchContractOffersForTokenId({
      collectionId: "cosmic-signature",
      nftAddress: cosmicNft,
      marketplaceAddress: marketplace,
      tokenId: 7,
      artwork: { image: "caller.png", alt: "Caller artwork" },
      client,
    });
    const withBackendArtwork = await fetchContractOffersForTokenId({
      collectionId: "cosmic-signature",
      nftAddress: cosmicNft,
      marketplaceAddress: marketplace,
      tokenId: 7,
      client,
    });

    expect(withCallerArtwork[0]?.artwork?.image).toBe("caller.png");
    expect(withBackendArtwork[0]?.artwork?.image).toBe("backend.png");
    expect(client.readContract).not.toHaveBeenCalled();
  });

  it("falls back to RPC token reads when the Random Walk backend fails", async () => {
    backendMocks.fetchRandomWalkOffers.mockRejectedValue(
      new Error("backend down"),
    );
    const client = mockClient({ 0: chainOffer(7n) });

    const offers = await fetchContractOffersForTokenId({
      collectionId: "random-walk",
      nftAddress: randomWalkNft,
      marketplaceAddress: marketplace,
      tokenId: 7,
      client,
    });

    expect(offers).toEqual([expect.objectContaining({ tokenId: 7 })]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringMatching(/random-walk token 7 offers via backend/),
    );
  });

  it("falls back to RPC token reads when the Cosmic Signature backend fails", async () => {
    backendMocks.fetchCosmicSignatureOffers.mockRejectedValue(
      new Error("backend down"),
    );
    const client = mockClient({ 0: chainOffer(7n) });

    const offers = await fetchContractOffersForTokenId({
      collectionId: "cosmic-signature",
      nftAddress: cosmicNft,
      marketplaceAddress: marketplace,
      tokenId: 7,
      client,
    });

    expect(offers).toEqual([expect.objectContaining({ tokenId: 7 })]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringMatching(/cosmic-signature token 7 offers via backend/),
    );
  });
});
