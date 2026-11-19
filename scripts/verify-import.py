"""Check recorded import trees against the Git objects shipped in a full clone."""

import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def main():
    sources = json.loads((ROOT / "docs/migration/sources.json").read_text())
    for component, source in sources.items():
        commit = source["importCommit"]
        subprocess.run(["git", "merge-base", "--is-ancestor", commit, "HEAD"], cwd=ROOT, check=True)
        tree = git("rev-parse", f"{commit}:{component}")
        if tree != source["importedTree"]:
            raise SystemExit(f"{component}: import differs from recorded upstream and local work")
        print(f"{component}  {tree}")
    for ref in ("legacy/game-v3", "legacy/game-main"):
        git("rev-parse", "--verify", f"refs/tags/{ref}^{{commit}}")
    print("Verified all component imports and historical comparison tags.")


if __name__ == "__main__":
    main()
