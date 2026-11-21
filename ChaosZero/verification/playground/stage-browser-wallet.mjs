// Install only in the disposable game workspace after the interactive seed exists.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isAddress } from "ethers";
import { installBrowserWallet } from "./browser-wallet.mjs";

export function browserWalletSession(manifest, chaosUrl, axiomUrl) {
  function origin(value) {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !url.port ||
      url.href !== url.origin + "/"
    )
      throw new Error("Expected a loopback playground origin");
    return url.origin;
  }
  function address(value) {
    assert.ok(isAddress(value), "Expected a playground contract or account address");
    return value;
  }
  assert.match(manifest.instanceId, /^0x[\da-f]{64}$/i);
  assert.deepEqual(
    manifest.humanWallets.map((w) => w.index),
    [1, 2, 3],
  );
  // The control socket, bot accounts and other private session metadata never enter the bundle.
  return {
    instanceId: manifest.instanceId,
    cosmicUrl: origin(manifest.cosmicUrl),
    chaosUrl: origin(chaosUrl),
    axiomUrl: origin(axiomUrl),
    rpcUrl: origin(manifest.rpcUrl),
    humanWallets: manifest.humanWallets.map(({ index, address: account }) => ({
      index,
      address: address(account),
    })),
    game: address(manifest.game),
    market: address(manifest.market),
    auction: address(manifest.auction),
    cst: address(manifest.cst),
    nft: address(manifest.nft),
  };
}

export async function stageBrowserWallet(directory, manifestPath, chaosUrl, axiomUrl) {
  if (resolve(manifestPath) !== join(resolve(directory), ".harness/v4.json"))
    throw new Error("The wallet must be staged beside its own interactive deployment");
  if (existsSync(join(directory, "instrumentation-client.ts")))
    throw new Error("Client instrumentation already exists in this checkout");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const config = browserWalletSession(manifest, chaosUrl, axiomUrl);
  await writeFile(
    join(directory, "instrumentation-client.js"),
    `// Generated for this local V4 session.\n(${installBrowserWallet.toString()})(${JSON.stringify(config)});\n`,
    { flag: "wx" },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [manifestPath, chaosUrl, axiomUrl] = process.argv.slice(2);
  await stageBrowserWallet(process.cwd(), manifestPath, chaosUrl, axiomUrl);
}
