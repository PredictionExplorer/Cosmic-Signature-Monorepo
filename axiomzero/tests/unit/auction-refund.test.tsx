import { render, screen, within } from "@testing-library/react";
import { parseEther } from "viem";
import { expect, it } from "vitest";
import { AuctionRefundNotice } from "@/components/auctions/auction-refund";

const owner = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";

it("links a verified wallet-wide credit to the refund form even while leading another lot", () => {
  const view = render(
    <AuctionRefundNotice
      address={owner}
      credit={{ account: owner, amount: parseEther("0.07") }}
      leading
    />,
  );
  const panel = within(screen.getByRole("region", { name: "Auction refunds" }));
  expect(panel.getByText("Refund available")).toBeVisible();
  expect(panel.getByText(/across all auction lots/)).toHaveTextContent(
    "0.07 ETH",
  );
  expect(panel.getByText(/current leading bid stays/)).toBeVisible();
  expect(panel.getByRole("link", { name: "Withdraw refund" })).toHaveAttribute(
    "href",
    "/auctions/account#refunds",
  );
  view.rerender(
    <AuctionRefundNotice
      address={other}
      credit={{ account: owner, amount: parseEther("0.07") }}
      leading={false}
    />,
  );
  expect(
    screen.queryByRole("region", { name: "Auction refunds" }),
  ).not.toBeInTheDocument();
});

it("explains the refund path to a leader even when nothing is available yet", () => {
  const view = render(
    <AuctionRefundNotice
      address={owner}
      credit={{ account: owner, amount: 0n }}
      leading
    />,
  );
  expect(screen.getByText(/full previous bid/)).toBeVisible();
  expect(screen.getByRole("link", { name: "View refunds" })).toHaveAttribute(
    "href",
    "/auctions/account#refunds",
  );
  expect(screen.queryByText("Refund available")).not.toBeInTheDocument();
  view.rerender(
    <AuctionRefundNotice
      address={owner}
      credit={{ account: owner, amount: 0n }}
      leading={false}
    />,
  );
  expect(
    screen.queryByRole("region", { name: "Auction refunds" }),
  ).not.toBeInTheDocument();
});

it("keeps a recovery link on read errors without claiming that a refund exists", () => {
  render(
    <AuctionRefundNotice
      address={owner}
      credit={{ account: owner, amount: null }}
      leading={false}
    />,
  );
  expect(screen.getByText(/could not be verified/)).toBeVisible();
  expect(screen.getByRole("link", { name: "View refunds" })).toHaveAttribute(
    "href",
    "/auctions/account#refunds",
  );
  expect(screen.queryByText("Refund available")).not.toBeInTheDocument();
});
