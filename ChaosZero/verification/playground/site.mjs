import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

async function main() {
  const [, , kind, port] = process.argv;
  if (!["axiom", "chaos"].includes(kind) || !/^[1-9]\d{0,4}$/.test(port))
    throw new Error("Expected a test site and port.");
  const root = kind === "chaos" ? process.env.CHAOS_ZERO_ROOT : process.env.AXIOM_ZERO_ROOT;
  if (!root) throw new Error("Missing V4 sibling site checkout for " + kind);
  const source = resolve(root, kind === "chaos" ? "frontend" : ".");
  const temp = await mkdtemp(join(dirname(process.env.V4_PLAYGROUND_MANIFEST), kind + "-"));
  try {
    const site = join(temp, "site");
    await mkdir(site);
    await Promise.all(
      [
        "src",
        "public",
        "package.json",
        "tsconfig.json",
        "next-env.d.ts",
        "postcss.config.mjs",
        "next.config.ts",
      ].map((file) => cp(join(source, file), join(site, file), { recursive: true })),
    );
    await symlink(join(source, "node_modules"), join(site, "node_modules"), "dir");
    if (kind === "chaos") {
      await mkdir(join(temp, "deployment"));
      await cp(
        resolve(root, "deployment/arbitrum-round-2-baseline.json"),
        join(temp, "deployment/arbitrum-round-2-baseline.json"),
      );
    }

    // Serve system fonts during functional tests without fetching from Google.
    const fonts = join(temp, "fonts.cjs");
    await writeFile(
      fonts,
      `module.exports = new Proxy({}, { get(_, url) {
      const family = new URL(url).searchParams.get('family').split(':')[0];
      return "@font-face {font-family: '" + family + "'; src: local('Arial');}";
    } });`,
    );
    const child = spawn(
      process.execPath,
      [
        join(source, "node_modules/next/dist/bin/next"),
        "dev",
        "--webpack",
        "--hostname",
        "127.0.0.1",
        "--port",
        port,
      ],
      {
        cwd: site,
        stdio: "inherit",
        env: {
          ...process.env,
          NEXT_TELEMETRY_DISABLED: "1",
          NEXT_FONT_GOOGLE_MOCKED_RESPONSES: fonts,
        },
      },
    );
    const stop = () => child.kill("SIGTERM");
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    try {
      const code = await new Promise((ok, reject) => {
        child.once("error", reject);
        child.once("exit", ok);
      });
      if (code) process.exitCode = code;
    } finally {
      process.off("SIGTERM", stop);
      process.off("SIGINT", stop);
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

await main();
