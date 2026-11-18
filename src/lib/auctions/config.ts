import { isAddress, zeroAddress, type Address, type Hex } from "viem";
import { arbitrum, foundry } from "viem/chains";

export const auctionChainId = Number(
  process.env.NEXT_PUBLIC_AUCTION_CHAIN_ID ?? arbitrum.id,
);
export const auctionChain = auctionChainId === foundry.id ? foundry : arbitrum;
const address = process.env.NEXT_PUBLIC_AUCTION_ADDRESS?.trim();
export const auctionConfigured = Boolean(address);
export const auctionAddress =
  address && isAddress(address) && address !== zeroAddress
    ? address
    : undefined;
export const auctionRpcUrl = process.env.NEXT_PUBLIC_AUCTION_LOCAL_RPC_URL;
const game =
  auctionChainId === foundry.id
    ? process.env.NEXT_PUBLIC_AUCTION_LOCAL_GAME_ADDRESS
    : "0x6a714Ae7B5b6eA520F6BCA23d2E609C4Fd5863F2";
const nft =
  auctionChainId === foundry.id
    ? process.env.NEXT_PUBLIC_COSMIC_SIGNATURE_NFT_ADDRESS
    : "0xbb84Be3500A63581d3F2d5AC3bdF8685AAedad25";
const hash = process.env.NEXT_PUBLIC_AUCTION_CODE_HASH;
const block = process.env.NEXT_PUBLIC_AUCTION_DEPLOYMENT_BLOCK;

export function requireAuctionConfig() {
  if (
    !auctionAddress ||
    !game ||
    !nft ||
    game === zeroAddress ||
    nft === zeroAddress ||
    !isAddress(game) ||
    !isAddress(nft) ||
    !hash ||
    !/^0x[0-9a-f]{64}$/i.test(hash) ||
    !block ||
    !/^\d+$/.test(block) ||
    (auctionChainId !== arbitrum.id && auctionChainId !== foundry.id)
  ) {
    throw new Error("Auction deployment details are missing or invalid.");
  }
  if (auctionChainId === foundry.id && !isLocalAuctionRpc(auctionRpcUrl)) {
    throw new Error("Local auctions require a loopback RPC endpoint.");
  }
  return {
    address: auctionAddress as Address,
    game,
    nft,
    hash: hash as Hex,
    deploymentBlock: BigInt(block),
  };
}

export function isLocalAuctionRpc(endpoint: string | undefined) {
  if (!endpoint) return false;
  try {
    const url = new URL(endpoint);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
