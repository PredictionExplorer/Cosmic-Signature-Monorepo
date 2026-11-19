import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const venue = "0x1111111111111111111111111111111111111111";
const game = "0x2222222222222222222222222222222222222222";
const nft = "0x3333333333333333333333333333333333333333";
const zero = "0x0000000000000000000000000000000000000000";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_AUCTION_ADDRESS", venue);
  vi.stubEnv("NEXT_PUBLIC_AUCTION_CODE_HASH", "0x" + "ff".repeat(32));
  vi.stubEnv("NEXT_PUBLIC_AUCTION_DEPLOYMENT_BLOCK", "123");
  vi.stubEnv("NEXT_PUBLIC_AUCTION_CHAIN_ID", "31337");
  vi.stubEnv("NEXT_PUBLIC_AUCTION_LOCAL_RPC_URL", "http://127.0.0.1:8559");
  vi.stubEnv("NEXT_PUBLIC_AUCTION_LOCAL_GAME_ADDRESS", game);
  vi.stubEnv("NEXT_PUBLIC_COSMIC_SIGNATURE_NFT_ADDRESS", nft);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
describe("auction deployment selection", () => {
  it("pins Arbitrum One to the existing game and NFT collection and requires a recent block in real time", async () => {
    vi.stubEnv("NEXT_PUBLIC_AUCTION_CHAIN_ID", undefined);
    const { requireAuctionConfig, auctionChainId } =
      await import("@/lib/auctions/config");
    expect(auctionChainId).toBe(42161);
    expect(requireAuctionConfig()).toMatchObject({
      address: venue,
      game: "0x6a714Ae7B5b6eA520F6BCA23d2E609C4Fd5863F2",
      nft: "0xbb84Be3500A63581d3F2d5AC3bdF8685AAedad25",
      deploymentBlock: 123n,
    });
    const { assertFresh } = await import("@/lib/auctions/client");
    const now = BigInt(Math.floor(Date.now() / 1000));
    expect(() => assertFresh(now)).not.toThrow();
    expect(() => assertFresh(now - 121n)).toThrow("stale");
    expect(() => assertFresh(now + 31n)).toThrow("stale");
  });
  it("enables the isolated wallet transport only for a loopback fixture", async () => {
    const { requireAuctionConfig, isLocalAuctionRpc } =
      await import("@/lib/auctions/config");
    expect(requireAuctionConfig()).toMatchObject({ address: venue, game, nft });
    expect(isLocalAuctionRpc(undefined)).toBe(false);
    expect(isLocalAuctionRpc("invalid")).toBe(false);
    expect(isLocalAuctionRpc("file:///etc/hosts")).toBe(false);
    const { wagmiConfig } = await import("@/lib/web3/config");
    expect(wagmiConfig.chains.map((c) => c.id)).toEqual([31337]);
  });
  it.each([
    ["NEXT_PUBLIC_AUCTION_ADDRESS", undefined],
    ["NEXT_PUBLIC_AUCTION_ADDRESS", "incorrect"],
    ["NEXT_PUBLIC_AUCTION_ADDRESS", zero],
    ["NEXT_PUBLIC_AUCTION_CODE_HASH", undefined],
    ["NEXT_PUBLIC_AUCTION_CODE_HASH", "32"],
    ["NEXT_PUBLIC_AUCTION_DEPLOYMENT_BLOCK", undefined],
    ["NEXT_PUBLIC_AUCTION_DEPLOYMENT_BLOCK", "-1"],
    ["NEXT_PUBLIC_AUCTION_CHAIN_ID", "1"],
    ["NEXT_PUBLIC_AUCTION_LOCAL_GAME_ADDRESS", undefined],
    ["NEXT_PUBLIC_COSMIC_SIGNATURE_NFT_ADDRESS", undefined],
    ["NEXT_PUBLIC_AUCTION_LOCAL_GAME_ADDRESS", zero],
    ["NEXT_PUBLIC_COSMIC_SIGNATURE_NFT_ADDRESS", zero],
    ["NEXT_PUBLIC_AUCTION_LOCAL_GAME_ADDRESS", "bad"],
    ["NEXT_PUBLIC_COSMIC_SIGNATURE_NFT_ADDRESS", "bad"],
    ["NEXT_PUBLIC_AUCTION_LOCAL_RPC_URL", "https://arb1.arbitrum.io/rpc"],
  ])("rejects incomplete or mismatched configuration %s=%s", async (k, v) => {
    vi.stubEnv(k!, v);
    const { requireAuctionConfig } = await import("@/lib/auctions/config");
    expect(() => requireAuctionConfig()).toThrow();
  });
});
