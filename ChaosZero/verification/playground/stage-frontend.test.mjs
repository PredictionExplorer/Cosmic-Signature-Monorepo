import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stageFrontend } from "./stage-frontend.mjs";

test("three-site rehearsal stages the current frontend without other packages or local settings", (t) => {
  const root = mkdtempSync(join(tmpdir(), "stage-cosmic-frontend-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const site = join(root, "Cosmic-Signature-frontend");
  const staged = join(root, "staged");
  mkdirSync(site);
  execFileSync("git", ["init", "-q", root]);
  writeFileSync(join(root, "other-package.txt"), "unrelated");
  writeFileSync(join(site, ".gitignore"), "scratch/\n");
  writeFileSync(join(site, ".env.local"), "fixture only");
  writeFileSync(join(site, "entry.js"), "old");
  writeFileSync(join(site, "deleted.js"), "old");
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", site, "add", "--force", ".env.local"]);
  writeFileSync(join(site, "entry.js"), "working edit");
  writeFileSync(join(site, "space in name.js"), "new file");
  symlinkSync("space in name.js", join(site, "linked.js"));
  rmSync(join(site, "deleted.js"));
  mkdirSync(join(site, "scratch"));
  writeFileSync(join(site, "scratch", "ignored.js"), "ignored");
  stageFrontend(site, staged);
  assert.equal(readFileSync(join(staged, "entry.js"), "utf8"), "working edit");
  assert.equal(readFileSync(join(staged, "linked.js"), "utf8"), "new file");
  for (const file of [
    ".env.local",
    "other-package.txt",
    "Cosmic-Signature-frontend",
    "deleted.js",
    "scratch",
  ]) {
    assert.equal(existsSync(join(staged, file)), false);
  }
});
