import { execFileSync } from "node:child_process";
import { copyFileSync, lstatSync, mkdirSync, readlinkSync, symlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

// Use Git for the file list so ignored build products and wallet state stay out,
// but read the working files, including edits and new source files, from disk.
export function stageFrontend(source, destination) {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "."],
    { cwd: source, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  const excluded =
    /^(?:\.env[^/]*|\.npmrc|\.sentryclirc|node_modules|\.harness|\.git|\.vercel)$|\.(?:pem|key|p12)$/i;
  const files = new Set(
    output
      .split("\0")
      .filter((file) => file && !file.split("/").some((part) => excluded.test(part))),
  );
  for (const file of files) {
    const from = join(source, file);
    const stat = lstatSync(from, { throwIfNoEntry: false });
    if (!stat) continue; // Tracked file deleted in this worktree.
    const to = join(destination, file);
    mkdirSync(dirname(to), { recursive: true });
    if (stat.isSymbolicLink()) {
      const link = readlinkSync(from);
      const target = relative(source, resolve(dirname(from), link))
        .split(sep)
        .join("/");
      if (isAbsolute(link) || !files.has(target)) {
        throw new Error(`Frontend symlink must target another included file: ${file}`);
      }
      symlinkSync(link, to);
    } else if (stat.isFile()) {
      copyFileSync(from, to);
    } else {
      throw new Error(`Unsupported frontend source entry: ${file}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  stageFrontend(resolve(process.argv[2]), resolve(process.argv[3]));
}
