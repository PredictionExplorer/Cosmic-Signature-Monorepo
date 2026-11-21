"""Verify CI counts completed test work and preserves actionable failures."""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("nightly_fuzz", ROOT / "scripts/ci/nightly-fuzz.py")
nightly = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(nightly)


class NightlyFuzzTests(unittest.TestCase):
    def campaign(self, mode, outcomes, seeds):
        scratch = TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        report_dir = Path(scratch.name) / "results"
        summary = Path(scratch.name) / "summary.md"
        elapsed = 0
        outputs = iter(outcomes)
        seed_values = iter(seeds)

        def next_seed():
            # Artificial scheduling/reporting delays must not satisfy the budget.
            nonlocal elapsed
            elapsed += 6 * 60 * 60_000
            return next(seed_values)

        def run(seed, profile, path):
            nonlocal elapsed
            live = json.loads((report_dir / "campaign.json").read_text())
            self.assertEqual(live["passes"][-1]["seed"], seed)
            self.assertEqual(live["passes"][-1]["status"], "running")
            self.assertEqual(live["profile"], profile)
            duration, outcome = next(outputs)
            elapsed += duration
            path.write_text(f"Native output for {seed}")
            if isinstance(outcome, BaseException):
                raise outcome
            return outcome

        env = {
            "GITHUB_SHA": "abc123",
            "GITHUB_EVENT_NAME": "schedule",
            "GITHUB_STEP_SUMMARY": str(summary),
        }
        try:
            with patch.dict(os.environ, env), contextlib.ExitStack() as stack:
                stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
                stack.enter_context(contextlib.redirect_stderr(io.StringIO()))
                code = nightly.run_campaign(
                    report_dir, mode, run=run, clock=lambda: elapsed, new_seed=next_seed
                )
        except KeyboardInterrupt:
            code = 130
        report = json.loads((report_dir / "campaign.json").read_text())
        self.assertIn(f"**{report['status']}**", summary.read_text())
        self.assertEqual(
            (report_dir / "last-pass.log").read_text(),
            f"Native output for {report['passes'][-1]['seed']}",
        )
        return code, report

    def test_full_budget_counts_only_active_successful_passes_and_finishes_last_pass(self):
        minute = 60_000
        code, report = self.campaign(
            "full", [(85 * minute, 0), (90 * minute, 0), (15 * minute, 0)], [12, 12, -3, 4]
        )
        self.assertEqual(code, 0)
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["targetMs"], 180 * minute)
        self.assertEqual(report["passedMs"], 190 * minute)
        self.assertEqual([p["seed"] for p in report["passes"]], [12, -3, 4])
        self.assertTrue(all(p["status"] == "passed" for p in report["passes"]))

    def test_smoke_completes_one_pass(self):
        code, report = self.campaign("smoke", [(42, 0)], [0])
        self.assertEqual(code, 0)
        self.assertEqual(report["passedMs"], 42)
        self.assertEqual(len(report["passes"]), 1)

    def test_failure_timeout_and_cancellation_keep_failed_seed_without_counting_partial_work(self):
        outcomes = [
            (7, "failed", 7),
            (subprocess.TimeoutExpired("fuzz", 1), "failed", 1),
            (KeyboardInterrupt(), "cancelled", 130),
        ]
        for outcome, status, expected in outcomes:
            with self.subTest(outcome=outcome):
                code, report = self.campaign("full", [(10, 0), (20, outcome)], [29, -7])
                self.assertEqual(code, expected)
                self.assertEqual(report["commit"], "abc123")
                self.assertEqual(report["status"], status)
                self.assertEqual(report["passedMs"], 10)
                self.assertEqual(report["passes"][-1]["elapsedMs"], 20)

    def test_cancellation_remains_cancellation_if_the_process_group_ignores_sigterm(self):
        with TemporaryDirectory() as temp, contextlib.ExitStack() as stack:
            spawn = stack.enter_context(patch.object(nightly.subprocess, "Popen"))
            signal_group = stack.enter_context(patch.object(nightly.os, "killpg"))
            worker = spawn.return_value
            worker.pid = 97
            worker.wait.side_effect = [KeyboardInterrupt(), subprocess.TimeoutExpired("fuzz", 5), -9]
            with self.assertRaises(KeyboardInterrupt):
                nightly.run_pass(0, nightly.FULL_PROFILE, Path(temp) / "last-pass.log")
            self.assertEqual(
                [call.args for call in signal_group.call_args_list],
                [(97, signal.SIGTERM), (97, signal.SIGKILL)],
            )
            self.assertEqual(worker.wait.call_count, 3)

    def test_native_process_gets_profile_and_propagates_its_exit_code(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            executable = root / "node"
            executable.write_text(
                "#!/bin/sh\n"
                "printf '%s %s %s\\n' \"$FUZZ_SEED\" \"$FUZZ_FACTOR\" \"$2\"\n"
                "exit 23\n"
            )
            executable.chmod(0o755)
            log = root / "last-pass.log"
            with patch.dict(os.environ, {"PATH": temp + os.pathsep + os.environ["PATH"]}):
                self.assertEqual(nightly.run_pass(-87, nightly.FULL_PROFILE, log), 23)
            self.assertEqual(log.read_text(), "-87 10 all\n")
