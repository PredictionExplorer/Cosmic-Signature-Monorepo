"""Exercise the shared hooks against real staged paths, empty pushes and new Git branches."""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class HookTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.repo = Path(scratch.name)
        self.log = self.repo / ".git" / "hook-test.log"
        self.git("init", "-q", "-b", "V4")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        shutil.copytree(ROOT / ".githooks", self.repo / ".githooks")
        (self.repo / "scripts").mkdir()
        shutil.copy2(
            ROOT / "scripts/install-hooks", self.repo / "scripts/install-hooks"
        )
        for component, hook in (
            ("ChaosZero", ".githooks/pre-push"),
            ("ChaosZero", ".githooks/pre-commit"),
            ("cosmicgame-frontend", ".husky/pre-commit"),
            ("cosmicgame-frontend", ".husky/commit-msg"),
        ):
            path = self.repo / component / hook
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(
                f'#!/bin/sh\nprintf "%s\\n" "{component}/{path.name}" >> "$HOOK_TEST_LOG"\n'
            )
            path.chmod(0o755)
        self.git("add", ".")
        self.git("commit", "-qm", "initial")
        self.base = self.git("rev-parse", "HEAD")
        self.git("update-ref", "refs/remotes/origin/V4", self.base)
        subprocess.run(
            [self.repo / "scripts/install-hooks"],
            cwd=self.repo,
            check=True,
            capture_output=True,
        )

    def git(self, *args):
        return subprocess.check_output(
            ["git", *args],
            cwd=self.repo,
            env={**os.environ, "HOOK_TEST_LOG": str(self.log)},
            text=True,
        ).strip()

    def test_mixed_commit_invokes_only_touched_components(self):
        for name in ("ChaosZero", "cosmicgame-frontend"):
            (self.repo / name / "a file").write_text("test\n")
        self.git("add", ".")
        self.git("commit", "-qm", "mixed commit")
        self.assertEqual(
            self.log.read_text().splitlines(),
            [
                "cosmicgame-frontend/pre-commit",
                "ChaosZero/pre-commit",
                "cosmicgame-frontend/commit-msg",
            ],
        )

    def test_new_branch_and_deletion(self):
        (self.repo / "ChaosZero" / "code").write_text("test\n")
        self.git("add", ".")
        self.git("commit", "-qm", "chaos only")
        self.log.unlink()
        head = self.git("rev-parse", "HEAD")
        zero = "0" * len(head)
        data = f"refs/heads/feature {head} refs/heads/feature {zero}\n(delete) {zero} refs/heads/old {self.base}\n"
        subprocess.run(
            [self.repo / ".githooks/pre-push", "origin", "unused"],
            cwd=self.repo,
            input=data,
            text=True,
            env={**os.environ, "HOOK_TEST_LOG": str(self.log)},
            check=True,
        )
        self.assertEqual(self.log.read_text().splitlines(), ["ChaosZero/pre-push"])


if __name__ == "__main__":
    unittest.main()
