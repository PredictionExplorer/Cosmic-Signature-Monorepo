// @vitest-environment node
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";

// Resolve from each consumer. A top-level import could test a different copy
// from the one pnpm installs for the connector or for its browser build.
const appRequire = createRequire(import.meta.url);
const wagmiRequire = createRequire(appRequire.resolve("wagmi"));
const connectorRequire = createRequire(
  wagmiRequire.resolve("@wagmi/connectors"),
);

describe("wallet connector dependencies", () => {
  it("restores an Arbitrum WalletConnect session and forwards account changes", async () => {
    const { EthereumProvider } = connectorRequire(
      "@walletconnect/ethereum-provider",
    );
    const account = "0x1111111111111111111111111111111111111111";
    const nextAccount = "0x2222222222222222222222222222222222222222";
    const session = {
      topic: "offline-session",
      namespaces: {
        eip155: {
          accounts: [`eip155:42161:${account}`],
          chains: ["eip155:42161"],
          methods: ["eth_sendTransaction"],
          events: ["accountsChanged", "chainChanged"],
        },
      },
    };

    // The upstream provider accepts an existing SignClient. This in-memory
    // session exercises the actual provider without a relay, wallet or signer.
    const client = Object.assign(new EventEmitter(), {
      session: { getAll: () => [session], get: () => session },
      core: {
        relayer: { connected: true },
        storage: {
          getItem: async () => undefined,
          setItem: async () => undefined,
        },
      },
    });
    const provider = await EthereumProvider.init({
      projectId: "offline-test",
      chains: [42161],
      rpcMap: { 42161: "http://127.0.0.1:1" },
      showQrModal: false,
      disableProviderPing: true,
      client,
    });
    expect(provider.accounts).toEqual([account]);
    expect(Number(await provider.request({ method: "eth_chainId" }))).toBe(
      42161,
    );
    let changedAccounts: string[] | undefined;
    provider.once("accountsChanged", (accounts: string[]) => {
      changedAccounts = accounts;
    });
    client.emit("session_event", {
      topic: session.topic,
      params: {
        chainId: "eip155:42161",
        event: { name: "accountsChanged", data: [nextAccount] },
      },
    });
    expect(changedAccounts).toEqual([nextAccount]);
  });

  const consumers = [
    ["@metamask/sdk"],
    ["@metamask/sdk", "@metamask/sdk-communication-layer"],
    ["@metamask/sdk", "@metamask/providers", "@metamask/utils"],
    [
      "@metamask/sdk",
      "@metamask/providers",
      "@metamask/rpc-errors",
      "@metamask/utils",
    ],
    ["@gemini-wallet/core", "@metamask/rpc-errors", "@metamask/utils"],
  ];
  it.each(consumers.map((packages) => ({ packages })))(
    "supports UUID generation and validation in both module formats for $packages",
    ({ packages }) => {
      let resolveFrom = connectorRequire;
      let directory = "";
      for (const name of packages) {
        const entry = resolveFrom.resolve(name);
        directory = dirname(entry);
        resolveFrom = createRequire(entry);
      }
      const { v4, validate } = resolveFrom("uuid");
      expect(validate(v4())).toBe(true);
      // Node's ESM resolver selects a separate entry from the CommonJS one.
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
        import assert from "node:assert/strict";
        import { v4, validate } from "uuid";
        assert.equal(validate(v4()), true);
      `,
        ],
        { cwd: directory },
      );
    },
  );
});
