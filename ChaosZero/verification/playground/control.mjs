// The session owns a private Unix socket. No session credential is sent in a command.
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const sessionPath = fileURLToPath(
  new URL("../../../.local/v4-playground/session.json", import.meta.url),
);

export function parseCommand(args) {
  const [command, argument, ...rest] = args;
  if (!rest.length && argument === undefined && ["status", "stop"].includes(command))
    return { command };
  if (!rest.length && /^\d+$/.test(argument ?? "")) {
    const value = Number(argument);
    if (
      (command === "bots" && value <= 3) ||
      (command === "advance" && value > 0 && value <= 31 * 86400)
    )
      return { command, value };
  }
  throw new Error("Use status, stop, bots 0..3, or advance SECONDS (1 through 2678400).");
}

function privateControlSocket(file) {
  if (typeof file !== "string" || resolve(file) !== file || basename(file) !== "ctl")
    throw new Error("Invalid local session socket path.");
  const directory = dirname(file);
  if (
    !/^csv4-[A-Za-z0-9]{6}$/.test(basename(directory)) ||
    ![realpathSync(tmpdir()), realpathSync("/tmp")].includes(realpathSync(dirname(directory)))
  )
    throw new Error("Invalid local session socket directory.");
  const parent = lstatSync(directory);
  const socket = lstatSync(file);
  const uid = process.getuid();
  if (
    !parent.isDirectory() ||
    parent.uid !== uid ||
    (parent.mode & 0o777) !== 0o700 ||
    !socket.isSocket() ||
    socket.uid !== uid ||
    (socket.mode & 0o777) !== 0o600
  )
    throw new Error("The control socket and its directory must be private to the session owner.");
  return file;
}

export async function controlSession(args, session) {
  const command = parseCommand(args);
  if (!/^0x[\da-f]{64}$/i.test(session.instanceId))
    throw new Error("Invalid local session identity.");
  const socket = createConnection(privateControlSocket(session.controlSocket)).setEncoding("utf8");
  const timeout = setTimeout(() => socket.destroy(new Error("Control command timed out.")), 30_000);
  try {
    let buffer = "";
    let greeted = false;
    for await (const chunk of socket) {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 64 * 1024)
        throw new Error("Control reply exceeds the size limit.");
      const end = buffer.indexOf("\n");
      if (end === -1) continue;
      if (end !== buffer.length - 1) throw new Error("Unexpected data after a control message.");
      const message = JSON.parse(buffer.slice(0, end));
      buffer = "";
      if (!greeted) {
        if (message?.instanceId !== session.instanceId)
          throw new Error("The control socket belongs to a different session.");
        greeted = true;
        socket.write(JSON.stringify(command) + "\n");
      } else {
        if (message?.ok !== true) throw new Error(message?.error ?? "Control command failed.");
        return message.result;
      }
    }
    throw new Error("The session closed before completing the control command.");
  } finally {
    clearTimeout(timeout);
    socket.destroy();
  }
}

export async function control(args, file = sessionPath) {
  let session;
  try {
    session = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error("No ready local V4 session. Start make play first.");
    throw error;
  }
  return controlSession(args, session);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    console.log(JSON.stringify(await control(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
