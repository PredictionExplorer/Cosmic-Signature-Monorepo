# Play V4 on your machine

One local chain backs the game, the Chaos Zero market and the Axiom Zero auction site. Each window uses a separate funded test wallet. The game, CST, NFTs, market and auction contracts execute real transactions on that chain.

## Start a session

Run commands from the monorepo root. Use Node from [.node-version](../.node-version), npm, pnpm 10.32.0, Foundry 1.7.1, native solc 0.8.38, Docker with Compose, Go matching the indexer's `go.mod` and Goose 3.27.2. The [toolchain guide](../ChaosZero/verification/playground/README.md) covers the compilers and backend requirements. On a new checkout install the dependencies and Chromium once:

```sh
make play-setup
```

With Docker running, start the session in a terminal:

```sh
make play
```

The launcher prepares the version of the indexer/API in the [backend lock](../Cosmic-Signature-frontend/harness.lock.json). On first use it may download that checkout, Go modules and the PostgreSQL image. It prints the site addresses when all three sites are ready. The default game URL is `http://localhost:14670/experimental-ui`, Chaos Zero is at `http://127.0.0.1:4671` and Axiom Zero is at `http://127.0.0.1:4672/auctions`.

Open any of the three site addresses in your browser. The interactive site connects **Playground Wallet 1** automatically. Choose another funded wallet from the playground wallet selector. Each tab remembers its selection when reloaded. Review the sender, recipient and amount before approving a local transaction. The three human wallets each start with at least 1,000 test ETH and 1,000 CST.

For a dedicated Chromium window that keeps the same identity across all three sites, run `make play-wallet WALLET=1` in a second terminal. Use `WALLET=2` or `WALLET=3` for another window. Dedicated windows review transactions in a separate confirmation tab. Both approaches use the local node’s accounts and require no extension, seed phrase or imported key.

## Try one cycle

1. **Make a gesture on the game site.** The seed played earlier versions on one proxy, upgraded it to V4 and completed its first V4 cycle. You join an active cycle with historical activity already indexed. The first gesture starts a 75-second countdown. Further gestures add 20 seconds. To skip the initial countdown, run `make play-advance BY=90` in another terminal. After the deadline, the last participant has 45 seconds of exclusive access to finalization. The next cycle has a 20-second intermission.
2. **Take a position on Chaos Zero.** Select one of the eight questions, approve CST and buy a position. Wallet 1 also has a 10 CST claim from the preceding cycle. At startup each current pool contains 1,000 CST of fresh game funding and 1,000 CST carried forward.
3. **Try both sides of an auction.** Eight lots from the preceding cycle are already eligible. Open a lot on Axiom Zero, bid with wallet 1 and outbid it with wallet 2. Wallet 1 can retrieve its refund. The opening bid is 0.001 ETH, so wallet 2 can bid 0.0011 ETH. The first funded bid starts the production 48-hour clock. Run `make play-advance BY=172801` after the bids, refresh the lot, settle it, then collect the NFT from the winning wallet. A newly registered batch takes seven chain days to become eligible.
4. **Try bots.** Run `make play-bots BOTS=2` while the sites are open. Bots take turns from their own funded accounts. They check current prices, positions, balances and deadlines before acting. One favors game gestures, another the market and the third auctions. Together they take one turn every 6–13 seconds. Their choices include gestures, position trades, competing bids and settlement. They concentrate on three lots per batch, leaving five for people. Set `BOTS=0` to pause them or `BOTS=3` to enable all three.

## Control the session

| Command | Effect |
| --- | --- |
| `make play BOTS=2` | Start a fresh game with two bots already active. The default is zero. |
| `make play-status` | Show the site URLs, chain time, block number, bot count and log directory. Confirmed bot actions appear in `bots.log` there. If the worker exits, the sites keep running and status reports how to restart the bots. |
| `make play-advance BY=90` | Advance the whole chain by 90 seconds and mine a block. Every open cycle and lot sees that time advance. |
| `make play-stop` | Close the session and discard its local chain and database. Ctrl-C in the launcher terminal also stops it. |
| `make test-play` | Run the automated human-wallet, market, auction, bot and clock checks in a separate disposable session on other ports. |

Once the launcher exits, `make play` starts again from the same scenario. Open fresh wallet windows for the new session. A wallet opened for an earlier chain refuses to sign on the replacement chain.

Each checkout has one human session. Its commands use a socket accessible only to the local user. If startup reports an occupied port, check `make play-status` first. If you need different ports, set `HARNESS_CHAIN_PORT`, `HARNESS_DB_PORT`, `HARNESS_API_PORT`, `HARNESS_WEB_PORT`, `V4_CHAOS_PORT` or `V4_AXIOM_PORT` before starting. The wallet command discovers the active URLs. A failed startup prints its disposable workspace directory for diagnosis.
