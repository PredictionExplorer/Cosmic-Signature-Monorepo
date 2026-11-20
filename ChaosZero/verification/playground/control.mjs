// The stable file contains a fresh session capability and is readable only by the local user.
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const sessionPath = fileURLToPath(
  new URL("../../../.local/v4-playground/session.json", import.meta.url),
);

export function commandPath(args) {
  const [command, argument, ...rest] = args;
  if (!rest.length && argument === undefined && ["status", "stop"].includes(command))
    return "/" + command;
  if (!rest.length && /^\d+$/.test(argument ?? "")) {
    const value = Number(argument);
    if (
      (command === "bots" && value <= 3) ||
      (command === "advance" && value > 0 && value <= 31 * 86400)
    )
      return "/" + command + "/" + value;
  }
  throw new Error("Use status, stop, bots 0..3, or advance SECONDS (1 through 2678400).");
}

export async function control(args, file = sessionPath) {
  const route = commandPath(args);
  let session;
  try {
    session = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error("No ready local V4 session. Start make play first.");
    throw error;
  }
  const url = new URL(session.controlUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.origin !== session.controlUrl)
    throw new Error("Invalid local session control origin.");
  const response = await fetch(url.origin + route, {
    method: route === "/status" ? "GET" : "POST",
    headers: { authorization: "Bearer " + session.controlToken },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Control command failed");
  return body;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    console.log(JSON.stringify(await control(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
