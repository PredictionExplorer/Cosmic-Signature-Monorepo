import {
  createWalletClient,
  custom,
  encodeFunctionData,
  isAddress,
  isAddressEqual,
  zeroAddress,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { auctionAbi } from "./abi";
import { assertFresh, verifiedSnapshot } from "./client";
import { auctionChain, auctionChainId } from "./config";
import { checkId } from "./types";

export type AuctionAction =
  | { kind: "bid"; tokenId: number; total: bigint; expectedFunding: bigint }
  | { kind: "settle" | "forwardProceeds"; tokenId: number }
  | { kind: "claimNft"; tokenId: number; recipient: Address }
  | { kind: "withdrawRefund"; recipient: Address };

export class AuctionConfirmationPending extends Error {
  constructor(
    public readonly hash: Hex,
    cause: unknown,
  ) {
    super(
      "Your transaction was submitted. Check its receipt before trying again.",
      { cause },
    );
  }
}

export function matchesAuctionTransaction(
  actual: { from: Address; to: Address | null; input: Hex; value: bigint },
  expected: { account: Address; to: Address; data: Hex; value: bigint },
) {
  return (
    actual.to !== null &&
    isAddressEqual(actual.from, expected.account) &&
    isAddressEqual(actual.to, expected.to) &&
    actual.value === expected.value &&
    actual.input.toLowerCase() === expected.data.toLowerCase()
  );
}

/** The connected wagmi connector supplies the EIP-1193 provider, including for mobile wallets. */
export async function submitAuctionAction(
  provider: EIP1193Provider,
  account: Address,
  action: AuctionAction,
  onHash: (hash: Hex) => void,
) {
  if ("tokenId" in action) checkId(action.tokenId);
  const wallet = createWalletClient({
    chain: auctionChain,
    transport: custom(provider),
  });
  async function verifyWallet() {
    const [addresses, chainId] = await Promise.all([
      wallet.getAddresses(),
      wallet.getChainId(),
    ]);
    if (
      chainId !== auctionChainId ||
      !addresses[0] ||
      !isAddressEqual(addresses[0], account)
    ) {
      throw new Error(
        "Your wallet account or network changed. Review the transaction again.",
      );
    }
  }
  const [snapshot] = await Promise.all([verifiedSnapshot(), verifyWallet()]);
  const { base, client, blockTime } = snapshot;
  if (
    "recipient" in action &&
    (!isAddress(action.recipient) ||
      isAddressEqual(action.recipient, zeroAddress) ||
      isAddressEqual(action.recipient, base.address))
  )
    throw new Error("Enter a valid recipient address.");
  let data: Hex;
  let value = 0n;
  if (action.kind === "bid") {
    const id = BigInt(action.tokenId);
    const [record, minimum] = await Promise.all([
      client.readContract({ ...base, functionName: "getAuction", args: [id] }),
      client.readContract({
        ...base,
        functionName: "minimumNextBid",
        args: [id],
      }),
    ]);
    if (action.total < minimum || action.total >= 1n << 256n)
      throw new Error("The minimum bid changed. Review the current price.");
    value = isAddressEqual(record.highestBidder, account)
      ? action.total - record.highestBid
      : action.total;
    if (action.expectedFunding !== value)
      throw new Error("The required ETH changed. Review the bid again.");
    data = encodeFunctionData({
      abi: auctionAbi,
      functionName: "bid",
      args: [id, action.total],
    });
  } else if (action.kind === "withdrawRefund") {
    data = encodeFunctionData({
      abi: auctionAbi,
      functionName: "withdrawRefund",
      args: [action.recipient],
    });
  } else if (action.kind === "claimNft") {
    data = encodeFunctionData({
      abi: auctionAbi,
      functionName: "claimNft",
      args: [BigInt(action.tokenId), action.recipient],
    });
  } else {
    data = encodeFunctionData({
      abi: auctionAbi,
      functionName: action.kind,
      args: [BigInt(action.tokenId)],
    });
  }
  const request = { account, to: base.address, data, value };
  await client.call(request);
  await verifyWallet();
  assertFresh(blockTime);
  const hash = await wallet.sendTransaction({
    ...request,
    chain: auctionChain,
  });
  onHash(hash);
  let accepted = hash;
  let replaced = false;
  const receipt = await client
    .waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 180_000,
      onReplaced({ reason, transaction }) {
        if (
          reason !== "repriced" ||
          !matchesAuctionTransaction(transaction, request)
        )
          replaced = true;
        else {
          accepted = transaction.hash;
          onHash(accepted);
        }
      },
    })
    .catch((cause: unknown) => {
      throw new AuctionConfirmationPending(accepted, cause);
    });
  if (replaced)
    throw new Error("The reviewed auction transaction was replaced.");
  if (receipt.transactionHash.toLowerCase() !== accepted.toLowerCase())
    throw new AuctionConfirmationPending(
      accepted,
      new Error("The receipt identifies a different transaction."),
    );
  if (receipt.status !== "success")
    throw new Error("The auction transaction reverted.");
  const transaction = await client
    .getTransaction({ hash: accepted })
    .catch((cause: unknown) => {
      throw new AuctionConfirmationPending(accepted, cause);
    });
  // A transaction may return to the pending pool or be mined in a different
  // block between the receipt and this read. Preserve the hash for recovery.
  if (
    transaction.hash.toLowerCase() !== accepted.toLowerCase() ||
    (transaction.chainId !== undefined &&
      transaction.chainId !== auctionChainId) ||
    transaction.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase() ||
    transaction.blockNumber !== receipt.blockNumber
  )
    throw new AuctionConfirmationPending(
      accepted,
      new Error("The confirmation block changed."),
    );
  if (!matchesAuctionTransaction(transaction, request))
    throw new Error(
      "The confirmed transaction differs from the reviewed auction action.",
    );
  return receipt;
}
