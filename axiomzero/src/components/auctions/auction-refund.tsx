import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { isAddressEqual, type Address } from "viem";

import { Price } from "./auction-display";
import styles from "./auction.module.css";

export function AuctionRefundNotice({
  address,
  credit,
  leading,
}: {
  address: Address;
  credit?: { account: Address; amount?: bigint | null } | null;
  leading: boolean;
}) {
  const amount =
    credit && isAddressEqual(credit.account, address)
      ? credit.amount
      : undefined;
  const available = amount != null && amount > 0n;
  const unavailable = credit === null || amount === null;
  if (!available && !unavailable && !leading) return null;

  return (
    <section aria-label="Auction refunds" className={styles.form}>
      {available ? (
        <div className={styles.review}>
          <h3>Refund available</h3>
          <p>
            <strong>
              <Price wei={amount} />
            </strong>{" "}
            is available to this wallet across all auction lots. You can
            withdraw it now.
            {leading && " Your current leading bid stays in the auction."}
          </p>
          <Link href="/auctions/account#refunds" className={styles.textLink}>
            Withdraw refund <ArrowRight size={15} aria-hidden />
          </Link>
        </div>
      ) : (
        <p>
          {unavailable
            ? "The refund balance could not be verified."
            : "If you’re outbid, your full previous bid becomes available to withdraw immediately."}{" "}
          <Link href="/auctions/account#refunds" className={styles.textLink}>
            View refunds <ArrowRight size={15} aria-hidden />
          </Link>
        </p>
      )}
    </section>
  );
}
