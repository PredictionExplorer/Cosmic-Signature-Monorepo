"""Exercise the repository rules against synthetic data without logging values."""

import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
# The reviewed exceptions all predate the first monorepo development commit.
IMPORTED_HISTORY = "e82c7d1570049cb3e05b40c22d6cd416bd27fa0b"


def check_historical_fingerprints(executable, sample):
    registry = ROOT.parent / ".github/security/reviewed-history.gitleaksignore"
    lines = [line for line in registry.read_text().splitlines() if line and not line.startswith("#")]
    if len(set(lines)) != len(lines) or not all(
        re.fullmatch(r"[0-9a-f]{40}:.+:[a-z0-9-]+:[1-9][0-9]*", item) for item in lines
    ):
        raise SystemExit("Historical exceptions must identify one exact version, file, rule and line")
    imported_commits = set(subprocess.check_output(
        ["git", "-C", str(ROOT), "rev-list", IMPORTED_HISTORY], text=True
    ).splitlines())
    # A Solidity method-name false positive also occurs on the original game-main tag,
    # whose history diverged before the monorepo V4 cutover.
    imported_commits.add("30728ff05f85ccd6e83494667a7f74b6d84837bd")
    if any(item.split(":", 1)[0] not in imported_commits for item in lines):
        raise SystemExit("A historical exception points outside the reviewed imported history")

    with tempfile.TemporaryDirectory() as temp:
        repo = Path(temp)
        git = ["git", "-c", "user.name=Scanner fixture", "-c", "user.email=fixture@example.invalid",
               "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false", "-C", temp]
        subprocess.run([*git, "init", "-q"], check=True)
        path = repo / "input.txt"

        def add_version(quote):
            path.write_text(f"PRIVATE_KEY={quote}0x{sample}{quote}\n")
            subprocess.run([*git, "add", path.name], check=True)
            subprocess.run([*git, "commit", "-qm", "Test scanner history"], check=True)
            return subprocess.check_output([*git, "rev-parse", "HEAD"], text=True).strip()

        first = add_version('"')
        second = add_version("'")
        ignored = repo / "reviewed"
        ignored.write_text(f"{first}:{path.name}:evm-private-key:1\n")
        scan = subprocess.run(
            [executable, "git", "--config", str(ROOT / ".gitleaks.toml"), "--redact=100",
             "--no-banner", "--ignore-gitleaks-allow", "--gitleaks-ignore-path", str(ignored),
             "--log-opts=--diff-merges=first-parent --all HEAD", "--report-format=json",
             "--report-path=-", temp], stdout=subprocess.PIPE, check=False,
        )
        if scan.returncode != 1:
            raise SystemExit("A later commit must not inherit an earlier fingerprint exception")
        versions = {row["Commit"] for row in json.loads(scan.stdout) if row["RuleID"] == "evm-private-key"}
        if versions != {second}:
            raise SystemExit("The historical exception must apply only to the reviewed commit")


def main(executable):
    # The same 32 bytes are public data in one context and a credential in another.
    sample = hashlib.sha256(b"Chaos Zero disposable scanner fixture").hexdigest()
    check_historical_fingerprints(executable, sample)
    cases = {
        "config.env": (f'DEPLOYER_PRIVATE_KEY="0x{sample}"', "evm-private-key"),
        "command.sh": (f"forge script --private-key {sample}", "evm-private-key"),
        "rpc.env": (f"RPC=https://arb-mainnet.g.alchemy.com/v2/{sample}", "rpc-provider-url-key"),
        "ankr.env": (f"RPC=https://rpc.ankr.com/arbitrum/{sample}", "rpc-provider-url-key"),
        "block.txt": (f"blockHash=0x{sample}", None),
        "public.env": ("RPC=https://arb1.arbitrum.io/rpc", None),
    }
    with tempfile.TemporaryDirectory() as directory:
        for name, (content, _) in cases.items():
            (Path(directory) / name).write_text(content + "\n")
        scan = subprocess.run(
            [
                executable, "dir", "--config", str(ROOT / ".gitleaks.toml"),
                "--redact=100", "--no-banner", "--ignore-gitleaks-allow",
                "--gitleaks-ignore-path", "/dev/null", "--report-format", "json",
                "--report-path", "-", directory,
            ],
            stdout=subprocess.PIPE,
            check=False,
        )
    if scan.returncode != 1:
        raise SystemExit(f"Expected the scanner to detect synthetic credentials, got {scan.returncode}")
    findings = {(Path(item["File"]).name, item["RuleID"]) for item in json.loads(scan.stdout)}
    for name, (_, rule) in cases.items():
        if rule and (name, rule) not in findings:
            raise SystemExit(f"{rule} missed {name}")
        if not rule and any(file == name for file, _ in findings):
            raise SystemExit(f"Public fixture {name} produced a credential finding")


if __name__ == "__main__":
    main(sys.argv[1])
