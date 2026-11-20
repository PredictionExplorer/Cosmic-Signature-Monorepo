import assert from "node:assert/strict";
import test from "node:test";
import { checkedTransaction, walletSession } from "./human-wallet.mjs";

const address = "0x" + "11".repeat(20);
const other = "0x" + "22".repeat(20);
const session = {
  humanWallets: [{ index: 1, address }],
  instanceId: "0x" + "01".repeat(32),
  rpcUrl: "http://127.0.0.1:8545",
  cosmicUrl: "http://localhost:3000",
  chaosUrl: "http://127.0.0.1:3001",
  axiomUrl: "http://127.0.0.1:3002",
};

test("only a funded human wallet and the exact local origins can be selected", () => {
  assert.equal(walletSession(session, 1).address, address);
  for (const index of [0, 2, 7, NaN]) assert.throws(() => walletSession(session, index));
  for (const url of ["https://example.org", "http://user@localhost", "http://127.0.0.1:3000/other"])
    assert.throws(() => walletSession({ ...session, rpcUrl: url }, 1));
  assert.throws(() => walletSession({ ...session, instanceId: "" }, 1));
});

test("a review binds the sender, recipient, amount and local chain", () => {
  const wallet = walletSession(session, 1);
  const tx = { from: address, to: other, value: "0x12", data: "0x", chainId: "0x7a69" };
  assert.deepEqual(checkedTransaction(wallet, [tx]), {
    from: address,
    to: other,
    value: "0x12",
    data: "0x",
  });
  for (const change of [
    { from: other },
    { chainId: "0x1" },
    { to: null },
    { value: "1 ether" },
    { data: 42 },
    { data: "0x1" },
    { value: "0x" },
    { input: "0xab" },
  ])
    assert.throws(() => checkedTransaction(wallet, [{ ...tx, ...change }]));
});
