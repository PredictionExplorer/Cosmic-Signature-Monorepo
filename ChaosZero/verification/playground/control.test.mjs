import assert from "node:assert/strict";
import { test } from "node:test";
import { commandPath } from "./control.mjs";

test("controls accept explicit, bounded simulation actions", () => {
  for (const [args, expected] of [
    [["status"], "/status"],
    [["stop"], "/stop"],
    [["bots", "0"], "/bots/0"],
    [["bots", "3"], "/bots/3"],
    [["advance", "1"], "/advance/1"],
    [["advance", "2678400"], "/advance/2678400"],
  ])
    assert.equal(commandPath(args), expected);
  for (const args of [
    [],
    ["status", "extra"],
    ["stop", "extra"],
    ["bots"],
    ["bots", "4"],
    ["advance", "2678401"],
    ["advance", "-1"],
    ["advance", "0"],
    ["advance", "1.2"],
    ["advance", "1e3"],
    ["advance", "1", "extra"],
  ])
    assert.throws(() => commandPath(args));
});
