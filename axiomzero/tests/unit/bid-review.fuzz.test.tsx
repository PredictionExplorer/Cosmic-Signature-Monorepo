import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import fc from "fast-check";
import { formatEther, zeroAddress, type Address } from "viem";
import { expect, it, vi } from "vitest";

import { BidForm } from "@/components/auctions/auction-bidding";
import type { AuctionLot } from "@/lib/auctions/types";
import { fuzzParams } from "../helpers/fuzz";

const wallet = vi.hoisted(() => ({ address: "" as Address }));
vi.mock("wagmi", () => ({ useAccount: () => wallet }));
const accounts = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
] as const;
const changes = ["poll", "switch wallet", "switch lot", "outbid"] as const;
type Change = (typeof changes)[number];

it("requires a fresh bid review after any wallet, lot or minimum change", async () => {
  const scenario = fc.record({
    high: fc.bigInt({ min: 10n, max: (1n << 240n) - 1n }),
    ownLead: fc.boolean(),
    premium: fc.bigInt({ min: 0n, max: 10n ** 24n }),
    changes: fc.array(fc.constantFrom<Change>(...changes), { maxLength: 8 }),
  });
  await fc.assert(
    fc.asyncProperty(scenario, async ({ high, ownLead, premium, changes }) => {
      wallet.address = accounts[0];
      const first: AuctionLot = {
        tokenId: 42,
        roundNum: 1n,
        seed: "0x00",
        openingBid: 1n,
        eligibleAt: 0n,
        endAt: 48n * 3600n,
        highestBid: high,
        minimumNextBid: high + (high + 9n) / 10n,
        highestBidder: ownLead ? accounts[0] : accounts[1],
        settled: false,
        delivered: false,
        proceedsForwarded: false,
      };
      const second: AuctionLot = { ...first, tokenId: 43 };
      let lot = first;
      const send = vi.fn().mockResolvedValue(true);
      const form = () => (
        <BidForm lot={{ ...lot }} busy={false} onAction={send} />
      );
      const view = render(form());
      const ui = within(view.container);
      try {
        const bid = lot.minimumNextBid + premium;
        fireEvent.change(ui.getByRole("textbox"), {
          target: { value: formatEther(bid) },
        });
        fireEvent.click(ui.getByRole("button", { name: "Review bid" }));
        expect(
          ui.getByRole("button", { name: "Confirm in wallet" }),
        ).toBeEnabled();
        // A review stays authorized through identical polls only. Returning to an old
        // wallet or lot cannot turn an already-invalidated review into a new approval.
        let reviewed = true;
        for (const change of changes) {
          switch (change) {
            case "switch wallet":
              wallet.address =
                wallet.address === accounts[0] ? accounts[1] : accounts[0];
              break;
            case "switch lot":
              lot = lot === first ? second : first;
              break;
            case "outbid":
              lot.highestBid = lot.minimumNextBid;
              lot.highestBidder =
                lot.highestBidder === accounts[0] ? accounts[1] : accounts[0];
              lot.minimumNextBid = lot.highestBid + (lot.highestBid + 9n) / 10n;
              break;
          }
          if (change !== "poll") reviewed = false;
          view.rerender(form());
          expect(
            ui.queryByRole("button", { name: "Confirm in wallet" }) !== null,
          ).toBe(reviewed);
          expect(send).not.toHaveBeenCalled();
        }
        const total = reviewed ? bid : lot.minimumNextBid + premium;
        if (!reviewed) {
          fireEvent.change(ui.getByRole("textbox"), {
            target: { value: formatEther(total) },
          });
          fireEvent.click(ui.getByRole("button", { name: "Review bid" }));
        }
        const existingEscrow =
          lot.highestBidder === wallet.address ? lot.highestBid : 0n;
        await act(async () => {
          fireEvent.click(
            ui.getByRole("button", { name: "Confirm in wallet" }),
          );
        });
        expect(send.mock.calls).toEqual([
          [
            {
              kind: "bid",
              tokenId: lot.tokenId,
              total,
              expectedFunding: total - existingEscrow,
            },
          ],
        ]);
      } finally {
        cleanup();
        wallet.address = zeroAddress;
      }
    }),
    fuzzParams(30),
  );
});
