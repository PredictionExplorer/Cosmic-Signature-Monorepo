import { readFileSync } from "node:fs";
import { isAddress, type Address, type Hex } from "viem";

function loopbackOrigin(value_: string): string {
  const url = new URL(value_);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error("The V4 browser test requires HTTP loopback endpoints.");
  }
  return url.origin;
}

interface Deployment {
  rpcUrl: string;
  cosmicUrl: string;
  apiUrl?: string;
  game: Address;
  cst: Address;
  nft: Address;
  market: Address;
  previousMarket: Address;
  auction: Address;
  auctionCodeHash: Hex;
  auctionDeploymentBlock: number;
  cycle: number | string;
  actor: Address;
}

function readDeployment(): Deployment {
  const manifest = process.env.V4_PLAYGROUND_MANIFEST;
  if (!manifest)
    throw new Error(
      "Start the V4 cross-project browser runner to generate its deployment manifest.",
    );
  const deployment: Deployment = JSON.parse(readFileSync(manifest, "utf8"));
  loopbackOrigin(deployment.rpcUrl);
  loopbackOrigin(deployment.cosmicUrl);
  if (deployment.apiUrl) loopbackOrigin(deployment.apiUrl);
  for (const address of [
    deployment.game,
    deployment.cst,
    deployment.nft,
    deployment.auction,
    deployment.market,
    deployment.previousMarket,
    deployment.actor,
  ]) {
    if (!isAddress(address) || BigInt(address) === 0n)
      throw new Error("Invalid V4 fixture address.");
  }
  if (
    !/^0x[\da-f]{64}$/i.test(deployment.auctionCodeHash) ||
    !Number.isSafeInteger(Number(deployment.auctionDeploymentBlock)) ||
    Number(deployment.auctionDeploymentBlock) < 1 ||
    BigInt(deployment.cycle) < 1n
  ) {
    throw new Error("Invalid V4 fixture auction or cycle metadata.");
  }
  return deployment;
}

export const deployment = readDeployment();
export const chaosUrl = loopbackOrigin("http://127.0.0.1:" + (process.env.V4_CHAOS_PORT ?? "4671"));
export const axiomUrl = loopbackOrigin("http://127.0.0.1:" + (process.env.V4_AXIOM_PORT ?? "4672"));
