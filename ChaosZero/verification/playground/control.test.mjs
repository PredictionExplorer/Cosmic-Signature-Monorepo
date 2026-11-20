import assert from "node:assert/strict";
import { once } from "node:events";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { control, controlSession, parseCommand } from "./control.mjs";

const instanceId = "0x" + "ab".repeat(32);

test("controls accept explicit, bounded simulation actions", () => {
  for (const [args, expected] of [
    [["status"], { command: "status" }],
    [["stop"], { command: "stop" }],
    [["bots", "0"], { command: "bots", value: 0 }],
    [["bots", "3"], { command: "bots", value: 3 }],
    [["advance", "1"], { command: "advance", value: 1 }],
    [["advance", "2678400"], { command: "advance", value: 2678400 }],
  ])
    assert.deepEqual(parseCommand(args), expected);
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
    assert.throws(() => parseCommand(args));
});

async function privateServer(t, handle) {
  const parent = Buffer.byteLength(join(tmpdir(), "csv4-XXXXXX/ctl")) > 100 ? "/tmp" : tmpdir();
  const dir = mkdtempSync(join(parent, "csv4-"));
  const controlSocket = join(dir, "ctl");
  const server = createServer(handle);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  server.listen(controlSocket);
  await once(server, "listening");
  chmodSync(controlSocket, 0o600);
  return { dir, session: { instanceId, controlSocket } };
}

test("checks the greeting on the same connection before sending just the requested action", async (t) => {
  let received;
  const { dir, session } = await privateServer(t, (socket) => {
    socket.setEncoding("utf8");
    socket.write('{"instanceId":');
    setImmediate(() => socket.write(JSON.stringify(instanceId) + "}\n"));
    socket.once("data", (data) => {
      received = JSON.parse(data);
      socket.end('{"ok":true,"result":{"bots":2}}\n');
    });
  });
  const file = join(dir, "session.json");
  writeFileSync(file, JSON.stringify({ ...session, controlToken: "unused legacy credential" }), {
    mode: 0o600,
  });
  assert.deepEqual(await control(["bots", "2"], file), { bots: 2 });
  assert.deepEqual(received, { command: "bots", value: 2 });
});

test("a different socket service receives zero command or session bytes", async (t) => {
  const chunks = [];
  let closed;
  const disconnected = new Promise((resolve) => {
    closed = resolve;
  });
  const { session } = await privateServer(t, (socket) => {
    socket.on("data", (data) => chunks.push(data));
    socket.on("close", closed);
    socket.write(JSON.stringify({ instanceId: "0x" + "cd".repeat(32) }) + "\n");
  });
  await assert.rejects(controlSession(["stop"], session), /different session/);
  await disconnected;
  assert.equal(chunks.length, 0);
});

test("refuses a shared, symlinked or external endpoint before connecting", async (t) => {
  let connections = 0;
  const { dir, session } = await privateServer(t, (socket) => {
    connections++;
    socket.destroy();
  });
  chmodSync(session.controlSocket, 0o666);
  await assert.rejects(controlSession(["stop"], session), /private to the session owner/);
  chmodSync(session.controlSocket, 0o600);
  chmodSync(dir, 0o755);
  await assert.rejects(controlSession(["stop"], session), /private to the session owner/);
  chmodSync(dir, 0o700);
  const alt = mkdtempSync(join(tmpdir(), "csv4-"));
  t.after(() => rmSync(alt, { recursive: true, force: true }));
  symlinkSync(session.controlSocket, join(alt, "ctl"));
  await assert.rejects(
    controlSession(["stop"], { ...session, controlSocket: join(alt, "ctl") }),
    /private to the session owner/,
  );
  await assert.rejects(
    controlSession(["stop"], { ...session, controlSocket: "http://127.0.0.1:5555" }),
    /socket path/,
  );
  assert.equal(connections, 0);
});

test("surfaces a server rejection and an incomplete greeting", async (t) => {
  let count = 0;
  const { session } = await privateServer(t, (socket) => {
    if (count++ === 0) return socket.end('{"incomplete":');
    socket.write(JSON.stringify({ instanceId }) + "\n");
    socket.once("data", () => socket.end('{"ok":false,"error":"Session is stopping"}\n'));
  });
  await assert.rejects(controlSession(["status"], session), /closed before completing/);
  await assert.rejects(controlSession(["status"], session), /Session is stopping/);
});
