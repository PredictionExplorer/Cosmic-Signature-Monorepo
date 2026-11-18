import styles from "@/components/auctions/auction.module.css";

export default function LoadingAuctions() {
  return (
    <div className={styles.shell}>
      <div className={styles.message} role="status">
        Loading auction data…
      </div>
    </div>
  );
}
