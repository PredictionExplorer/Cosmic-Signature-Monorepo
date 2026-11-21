"""Run fresh, complete V4 fuzz passes until their measured run time meets the budget."""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
NIGHTLY_MS = 180 * 60_000
PASS_TIMEOUT_SECONDS = 45 * 60
FULL_PROFILE = {
    "FUZZ_FACTOR": "10",
    "FOUNDRY_FUZZ_RUNS": "4096",
    "FOUNDRY_INVARIANT_RUNS": "128",
    "FOUNDRY_INVARIANT_DEPTH": "128",
}
SMOKE_PROFILE = {
    "FUZZ_FACTOR": "1",
    "FOUNDRY_FUZZ_RUNS": "1000",
    "FOUNDRY_INVARIANT_RUNS": "64",
    "FOUNDRY_INVARIANT_DEPTH": "64",
}


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def monotonic_ms():
    return time.monotonic_ns() // 1_000_000


def signed_seed():
    return int.from_bytes(secrets.token_bytes(4), "big", signed=True)


def run_pass(seed, profile, log_path, *, timeout=PASS_TIMEOUT_SECONDS):
    command = ["node", str(ROOT / "scripts/run-fuzz.mjs"), "all"]
    env = {**os.environ, **profile, "FUZZ_SEED": str(seed)}
    with log_path.open("w", encoding="utf-8") as stream:
        child = subprocess.Popen(
            command, cwd=ROOT, env=env, stdout=stream, stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            return child.wait(timeout=timeout)
        except (KeyboardInterrupt, subprocess.TimeoutExpired):
            # The Node runner starts native tools and the auction rehearsal starts
            # a disposable chain. Cancel the whole process group before returning.
            try:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            finally:
                child.wait()
            raise


def run_campaign(directory, mode, *, run=run_pass, clock=monotonic_ms, new_seed=signed_seed):
    directory.mkdir(parents=True)
    target = NIGHTLY_MS if mode == "full" else 0
    profile = FULL_PROFILE if mode == "full" else SMOKE_PROFILE
    report = {
        "status": "running",
        "commit": os.getenv("GITHUB_SHA") or subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "event": os.getenv("GITHUB_EVENT_NAME", "local"),
        "mode": mode,
        "started": utc_now(),
        "targetMs": target,
        "passedMs": 0,
        "profile": profile,
        "passes": [],
    }

    def save():
        temporary = directory / "campaign.json.tmp"
        temporary.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        temporary.replace(directory / "campaign.json")

    used = set()
    try:
        while True:
            seed = new_seed()
            while seed in used:
                seed = new_seed()
            used.add(seed)
            item = {"seed": seed, "started": utc_now(), "status": "running"}
            report["passes"].append(item)
            save()
            print(
                f"Pass {len(used)} on {report['commit']} with FUZZ_SEED={seed}. "
                f"{report['passedMs'] // 1000}s completed.",
                flush=True,
            )
            start = clock()
            try:
                code = run(seed, profile, directory / "last-pass.log")
            except KeyboardInterrupt:
                item["status"] = "cancelled"
                raise
            except (OSError, subprocess.TimeoutExpired) as error:
                item["status"] = "failed"
                print(f"Fuzz pass could not finish: {error}", file=sys.stderr, flush=True)
                return 1
            finally:
                item["elapsedMs"] = clock() - start
            item["exitCode"] = code
            if code != 0:
                item["status"] = "failed"
                print(f"Fuzz pass failed. See last-pass.log and the counterexample files. "
                      f"Replay with FUZZ_SEED={seed} and the recorded profile.", file=sys.stderr)
                return code if code > 0 else 128 - code
            item["status"] = "passed"
            report["passedMs"] += item["elapsedMs"]
            if report["passedMs"] >= target:
                report["status"] = "passed"
                return 0
    except KeyboardInterrupt:
        report["status"] = "cancelled"
        raise
    finally:
        if report["status"] == "running":
            report["status"] = "failed"
        report["finished"] = utc_now()
        save()
        result = (f"**{report['status']}** · attempted passes: {len(report['passes'])} · "
                  f"{report['passedMs'] / 60_000:.2f} minutes in successful fuzz passes · "
                  f"{target // 60_000} minutes required")
        print(result, flush=True)
        summary = os.getenv("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a", encoding="utf-8") as stream:
                stream.write(f"## V4 fuzz campaign\n\n{result}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("full", "smoke"), default="full")
    parser.add_argument(
        "--output", type=Path, required=True,
        help="New directory for the report and most recent pass log",
    )
    args = parser.parse_args()

    def interrupt(_signal, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupt)
    try:
        sys.exit(run_campaign(args.output, args.mode))
    except KeyboardInterrupt:
        sys.exit(130)
