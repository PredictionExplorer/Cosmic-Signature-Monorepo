export type FaqItem = {
  question: string;
  answer: string;
  /** Featured items surface in the home page FAQ teaser. */
  featured?: boolean;
};

export type FaqCategory = {
  id: string;
  title: string;
  description: string;
  items: readonly FaqItem[];
};

export const FAQ_CATEGORIES: readonly FaqCategory[] = [
  {
    id: "getting-started",
    title: "Getting started",
    description:
      "What Axiom Zero is and what you need before your first trade.",
    items: [
      {
        question: "What is Axiom Zero?",
        answer:
          "Axiom Zero is a zero-fee NFT marketplace for fair-launch generative art collections on Arbitrum, including Random Walk and Cosmic Signature. Every artwork is produced by mathematics, code, and algorithms, and every trade settles directly on-chain.",
        featured: true,
      },
      {
        question: "What do I need to start collecting?",
        answer:
          "You need an Ethereum wallet (such as MetaMask or Rainbow) connected to the Arbitrum network, plus some ETH on Arbitrum for purchases and network gas. Browsing the marketplace requires no wallet at all.",
        featured: true,
      },
      {
        question: "How do I connect my wallet?",
        answer:
          "Press Connect wallet in the header and choose your wallet provider. If your wallet is on a different network, the site prompts you to switch to Arbitrum. Axiom Zero never takes custody of your assets; every action is signed in your own wallet.",
      },
      {
        question: "Do I need an account or sign-up?",
        answer:
          "No. There are no accounts, emails, or passwords. Your wallet address is your identity, and all listings, bids, and purchases are recorded on the Arbitrum blockchain.",
      },
    ],
  },
  {
    id: "buying-bidding",
    title: "Buying and bidding",
    description:
      "How purchases and standing offers work on the secondary order book.",
    items: [
      {
        question: "How do I buy an NFT on Axiom Zero?",
        answer:
          "Open a token detail page and press Buy now on an active listing, then confirm the transaction in your wallet. Ownership transfers to your address as soon as the transaction confirms on Arbitrum.",
        featured: true,
      },
      {
        question: "How do I make a secondary-market offer?",
        answer:
          "Open the token page for the NFT you want, enter your bid amount in ETH under Market actions, and press Bid. Your ETH is held by the verified marketplace contract while the bid is active.",
      },
      {
        question: "What is the difference between a listing and a bid?",
        answer:
          "A listing is a sell offer: the owner names a price that anyone can accept instantly with Buy now. A bid is a buy offer: a collector locks ETH behind a price, and the bid stays open on-chain until it is accepted or cancelled. Both sit in the same on-chain order book.",
      },
      {
        question: "Can I cancel a secondary-market offer?",
        answer:
          "Yes. Your active bids appear under Your active orders on the token page. Press Cancel and confirm in your wallet; the marketplace contract returns your escrowed ETH. You only spend network gas.",
      },
    ],
  },
  {
    id: "artwork-auctions",
    title: "Artwork auctions",
    description:
      "Bidding for new Cosmic Signature artworks and collecting a settled lot.",
    items: [
      {
        question: "When does bidding start and end?",
        answer:
          "Each new cycle exhibition has a seven-day preview. The first fully funded bid starts a 48-hour clock for that artwork. A bid accepted with less than ten minutes remaining restores ten full minutes. A work without a first bid stays available.",
      },
      {
        question: "How much ETH does a bid require?",
        answer:
          "The initial opening price is 0.001 ETH. Each batch keeps the opening price recorded at registration. Later bids must raise the highest bid by at least 10%, rounded up to the next wei. A new bidder sends the full amount. The current leader sends only the increase. The confirmed amount is a direct bid and cannot be cancelled.",
      },
      {
        question: "What happens when I am outbid?",
        answer:
          "The auction contract credits your full bid back to your wallet’s refund balance. Open My auctions to retrieve available ETH, even before the lot ends. Your wallet pays the network fee.",
      },
      {
        question: "How do I collect the artwork?",
        answer:
          "After the deadline, anyone can settle the lot. The winning wallet can then send the NFT to its chosen recipient. The full sale price can be forwarded to the Cosmic Signature game reserve independently of delivery.",
      },
    ],
  },
  {
    id: "selling-listings",
    title: "Selling and listings",
    description: "Listing NFTs you own and managing your open orders.",
    items: [
      {
        question: "How do I list an NFT for sale?",
        answer:
          "Open My NFTs or the token page while connected as the owner, enter your price in ETH, and press List this NFT. The first listing for a collection also asks for a one-time marketplace approval before the sell offer is created.",
      },
      {
        question: "What is marketplace approval?",
        answer:
          "Marketplace approval is a standard ERC-721 permission that lets the verified marketplace contract transfer NFTs from a collection on your behalf when a sale completes. It is granted once per collection and can be revoked from your wallet at any time.",
      },
      {
        question: "How do I cancel a listing?",
        answer:
          "Open the token page while connected with the wallet that created the listing, find it under Your active orders, and press Cancel. The NFT never leaves your wallet while it is listed; cancelling simply removes the on-chain sell offer.",
      },
      {
        question: "When do I get paid after a sale?",
        answer:
          "For secondary-market listings and offers, the purchase transfers the NFT and pays the seller in one transaction. For V4 artwork auctions, the winner collects the NFT after settlement and the full winning price goes to the Cosmic Signature reserve.",
      },
    ],
  },
  {
    id: "fees-trust",
    title: "Fees and trust",
    description: "What trading costs and how to verify everything yourself.",
    items: [
      {
        question: "Does Axiom Zero charge marketplace fees?",
        answer:
          "No. Axiom Zero adds no platform fee to trades: 0%. Buyers pay only the listing or bid price plus Arbitrum network gas, and sellers receive the full sale amount.",
        featured: true,
      },
      {
        question: "What is gas and who pays it?",
        answer:
          "Gas is the small fee the Arbitrum network charges to process any transaction. It goes to the network, not to Axiom Zero, and is typically a small fraction of Ethereum mainnet costs. Browsing the marketplace is always free.",
      },
      {
        question: "How can I verify the contracts?",
        answer:
          "Every NFT and marketplace contract address is printed in the site footer with a direct Arbiscan link, so you can inspect the verified source code and the full transaction history yourself.",
      },
      {
        question: "What does zero privilege mean?",
        answer:
          "No founder allocations, no allowlists, no insider mint lanes, and no platform fee. Every collector meets the same market at the same time under the same transparent rules.",
      },
    ],
  },
  {
    id: "collections-artwork",
    title: "Collections and artwork",
    description: "The art systems behind the tokens and the data on each page.",
    items: [
      {
        question: "What collections are listed on Axiom Zero?",
        answer:
          "Random Walk NFTs, generative art drawn by five-dimensional random walks, and Cosmic Signature NFTs, orbital signatures rendered from three-body physics. Both trade through verified contracts on Arbitrum.",
      },
      {
        question: "What is a seed?",
        answer:
          "The seed is the unique on-chain value that deterministically generates a token's artwork. The same seed always produces the same artwork, so it acts as the cryptographic fingerprint of the piece. It is shown on every token detail page.",
      },
      {
        question: "What is a beauty score?",
        answer:
          "Beauty is a numeric aesthetic score that ships with Random Walk token metadata. It is descriptive only: it does not change ownership, trading rules, or fees on Axiom Zero. Tokens without a published score simply omit the badge.",
      },
      {
        question: "What are provenance and token history?",
        answer:
          "Provenance is the recorded life of a token: its mint, transfers, and sales with prices where available. Axiom Zero shows it on each token page under the History tab, combining collection endpoints with on-chain marketplace data.",
      },
      {
        question: "What does anchored mean and why does it affect value?",
        answer:
          "Anchoring is a one-time action on cosmicsignature.com: a Random Walk or Cosmic Signature NFT can be anchored to the protocol exactly once, ever, and the anchor never resets even after it is released. A never-anchored token keeps that option open for its next owner, so collectors often pay a premium for it. Axiom Zero reads the status live from the anchoring contracts on Arbitrum, labels every token as never anchored or anchored, and lets you filter each collection by anchor status.",
        featured: true,
      },
    ],
  },
] as const;

export const ALL_FAQ_ITEMS: readonly FaqItem[] = FAQ_CATEGORIES.flatMap(
  (category) => [...category.items],
);

export const FEATURED_FAQ_ITEMS: readonly FaqItem[] = ALL_FAQ_ITEMS.filter(
  (item) => item.featured,
);
