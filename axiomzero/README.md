# Axiom Zero

Axiom Zero is a production-minded marketplace for Random Walk NFTs and Cosmic
Signature NFTs on Arbitrum. The brand principle is simple: generative art,
equal access, zero privilege.

## Stack

- Next.js App Router, React, TypeScript, Tailwind CSS v4
- Wagmi, Viem, RainbowKit, TanStack Query
- Next.js route handlers for normalized marketplace reads
- Vitest, Testing Library, fast-check, Playwright, axe, Lighthouse CI
- Vercel-ready server-rendered pages with small wallet client islands

## Local Development

```bash
corepack pnpm install
corepack pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Copy `env.example` to `.env.local` and fill in production values before wallet
testing or deployment.

Wallet connections require a real `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.
Deployments still build without it so the marketplace remains browsable, but a
real project ID should be configured in Vercel for reliable WalletConnect QR and
mobile wallet support. Marketplace reads use the collection Go backend APIs
plus verified Arbitrum contract reads; keep the backend URLs and contract
addresses in `env.example` aligned with production sources.

## Marketplace Architecture

The UI reads normalized marketplace data through `src/app/api/marketplace/**`.
Token identity, ownership, and provenance history come from each collection's
Go backend JSON API (the same PredictionExplorer "webserv" that powers
`randomwalknft.com` and `cosmicsignature.com`): Random Walk uses
`tokens/info` and `tokens/history` on `api.randomwalknft.com:1443`, Cosmic
Signature uses `cst/info`, `cst/transfers/all`, and `cst/list` under
`/api/cosmicgame` on `nfts.cosmicsignature.com`. When an API is unreachable,
tokens degrade to static metadata enriched with an on-chain `ownerOf` read so
ownership never renders as the zero address. Listings, bids, and sales are
always read from the verified Arbitrum marketplace contract. Wallet actions
are signed client-side with wagmi and viem, then the app refreshes
server-rendered data after confirmations.

## Wallet dependency compatibility

The scoped resolutions and versioned patches in `pnpm-workspace.yaml` keep the production wallet graph on patched dependencies. Keep the patch files with the lockfile when installing or building the site.

| Consumer | Compatibility requirement |
| --- | --- |
| Wagmi and MetaMask | WalletConnect’s Ethereum provider 2.26 uses an updated transport and URL parser. The pinned MetaMask consumers use UUID 11.1.1 for its CommonJS and ESM generator and validator. |
| WalletConnect storage | Its filesystem filter uses `minimatch` in place of the vulnerable `picomatch` dependency. The storage driver, keys, and serialized wallet sessions retain their existing formats. |
| Reown frame messages | Runtime schemas use native Zod 4. The patch preserves optional RPC parameters and empty success responses. The former schema declarations are used only to describe existing message types. |
| Base and Coinbase CDP | Base uses CDP SDK 1.51.2 with Axios 1.21.1. Later SDKs import optional payment modules that prevent this wallet bundle from building. Its scoped ABI dependency supports Zod 4. The CDP patch keeps EIP-712 field maps and their exported policy types aligned across module formats. |

Retire the compatibility changes when upstream releases support the patched dependencies. Run the frozen install, production audit, wallet compatibility tests, and local auction rehearsal when updating these packages.

## Quality Gates

```bash
corepack pnpm audit --prod
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test:unit
corepack pnpm build
corepack pnpm test:e2e
```

GitHub Actions runs the same gates, including the Playwright end-to-end and
axe accessibility suites, on relevant pushes and pull requests to `main` or
`V4`. See the [Axiom Zero workflow](../.github/workflows/axiom.yml). The e2e pages read the live collection backends
and the public Arbitrum RPC; configure an `ARBITRUM_RPC_URL` dedicated
endpoint if public-RPC rate limiting makes runs flaky.

## Deployment

Deploy on Vercel with Node 20+ and the variables listed in `env.example`.
Verify all contract addresses against official Random Walk and Cosmic Signature
sources before enabling real trading flows in production.

Set `ARBITRUM_RPC_URL` to a dedicated provider endpoint (Alchemy, Infura,
QuickNode, ...) in production. Without it the app falls back to the public
`arb1.arbitrum.io/rpc` endpoint, which rate-limits shared hosting IPs and
intermittently fails the on-chain offer scans, baking "N/A" market stats into
statically cached pages.

## Brand Notes

Axiom Zero avoids blue and purple entirely. The visual system uses ink, carbon,
warm ivory, copper, ember, and chartreuse to feel precise, elegant, and
memorable without turning the market into a casino-like interface.

The marketplace should remain calm under pressure: clear filters, readable
prices, obvious wallet states, accessible focus rings, strong contrast, and
minimal motion.

## V4 artwork auctions

The catalogue at `/auctions` groups eight works per cycle. Each lot at `/auctions/{tokenId}` has a seven-day preview, a 48-hour clock from its first funded bid, and a ten-minute rolling close. The opening price starts at 0.001 ETH and is frozen per batch. Subsequent bids raise the current total by at least 10%, rounded up to whole wei. The winning price goes to the game reserve. Outbid collectors can retrieve ETH before the lot ends.

Use `/auctions/account` for funded bids, won lots, delivery and refunds. The settlement archive at `/auctions/results` links primary sales to their on-chain records. A settled primary sale and a later order-book resale are separate trades.

Public browsing and signing for the separate ETH auction use the reviewed auction address, runtime hash and creation block in `env.example`. Leave these empty before launch. Arbitrum deployments must match the production game and Cosmic Signature collection. Every lot reads its frozen opening price and next minimum from the contract. The auction wallet page shows previously registered batches and refund credit; settlement histories count confirmed sales. Listings and standing offers use the existing marketplace contract.

For a local end-to-end run, compile the production game contracts in the monorepo’s `Cosmic-Signature/` directory (`ENABLE_HARDHAT_PREPROCESSOR=false npx hardhat compile`), then run `pnpm test:auction:local` here. It builds a temporary production copy of Axiom Zero, starts its own Hardhat node and website on loopback ports 8559 and 4599, and tests bidding and settlement in Chromium using disposable node accounts. A second real v4 batch verifies that later opening-price changes preserve already registered lots. No signing keys are required.
