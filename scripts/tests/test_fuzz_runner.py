"""Check shared seed routing without launching real chains or package managers."""

import json
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest

ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "scripts/run-fuzz.mjs"

# Exercise the real runner process, including its working directories, argv and exit status.
RECORD_CALL = """#!/usr/bin/env python3
import json, os, sys
from pathlib import Path

tool = Path(sys.argv[0]).name
call = [tool, str(Path.cwd()), sys.argv[1:], os.getenv('FUZZ_SEED'), os.getenv('FOUNDRY_FUZZ_SEED')]
with open(os.environ['FUZZ_RUNNER_TEST_LOG'], 'a') as stream:
    print(json.dumps(call), file=stream)
sys.exit(7 if tool == os.getenv('FAIL_FUZZ_TOOL') else 0)
"""


class FuzzRunnerTests(unittest.TestCase):
    def test_routes_same_seed_bits_to_native_suites_and_stops_on_failure(self):
        with TemporaryDirectory() as temp:
            directory = Path(temp)
            log = directory / "calls"
            for name in ("npx", "forge", "npm", "pnpm"):
                executable = directory / name
                executable.write_text(RECORD_CALL)
                executable.chmod(0o755)
            env = {
                **os.environ,
                "PATH": temp + os.pathsep + os.environ["PATH"],
                "FUZZ_SEED": "-1",
                "FUZZ_RUNNER_TEST_LOG": str(log),
            }
            for key in ("FUZZ_PATH", "FUZZ_FACTOR", "FOUNDRY_FUZZ_SEED", "FAIL_FUZZ_TOOL"):
                env.pop(key, None)
            subprocess.run(["node", RUNNER], env=env, cwd=ROOT, capture_output=True, check=True)
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            self.assertEqual(
                [Path(call[1]).relative_to(ROOT).as_posix() for call in calls],
                [
                    "Cosmic-Signature",
                    "Cosmic-Signature",
                    "ChaosZero",
                    "Cosmic-Signature-frontend",
                    "ChaosZero/frontend",
                    "axiomzero",
                    "axiomzero",
                ],
            )
            self.assertEqual(calls[0][3], "0xffffffff")
            self.assertEqual(calls[0][2][calls[0][2].index("--network") + 1], "hardhat")
            self.assertEqual([call[4] for call in calls[1:3]], ["0xffffffff"] * 2)
            self.assertEqual([call[3] for call in calls[3:]], ["-1"] * 4)
            self.assertIn("test:auction:local", calls[-1][2])

            log.write_text("")
            result = subprocess.run(
                ["node", RUNNER, "frontends"],
                env={**env, "FAIL_FUZZ_TOOL": "npm"},
                cwd=ROOT,
                capture_output=True,
            )
            self.assertEqual(result.returncode, 7)
            self.assertEqual(len(log.read_text().splitlines()), 1)

    def test_rejects_invalid_seeds_and_unfiltered_shrink_paths_before_running(self):
        for extra in ({"FUZZ_SEED": "2147483648"}, {"FUZZ_SEED": "0", "FUZZ_PATH": "0:2"}):
            with self.subTest(extra=extra):
                result = subprocess.run(
                    ["node", RUNNER], env={**os.environ, **extra}, cwd=ROOT, capture_output=True
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, b"")
