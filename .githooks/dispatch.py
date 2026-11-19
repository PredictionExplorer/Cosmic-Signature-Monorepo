"""Dispatch installed, component-specific hooks for this monorepo."""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COSMIC_WEB = "Cosmic-Signature-frontend"
CHAOS = "ChaosZero"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def changed_paths(*args):
    data = git("diff", "--no-renames", "--name-only", "-z", *args)
    return {os.fsdecode(name) for name in data.split(b"\0") if name}


def remote_base(remote, commit):
    # A new feature branch normally shares history with the default or V4 branch.
    for branch in ("HEAD", "V4", "main"):
        target = f"refs/remotes/{remote}/{branch}"
        result = subprocess.run(
            ["git", "merge-base", commit, target],
            cwd=ROOT,
            capture_output=True,
            check=False,
        )
        if result.returncode == 0:
            return result.stdout.strip().decode("ascii")
    return None


def affected_components(paths):
    components = {path.split("/", 1)[0] for path in paths}
    if ".gitmodules" in paths:
        components.add(CHAOS)
    return components


def push_paths(updates, remote):
    """Compare each published tree with its actual remote base. Unknown bases check all paths."""
    paths = set()
    chaos_updates = []
    for line in updates.splitlines():
        _, local_id, _, remote_id = line.split()
        if not local_id.strip(b"0"):  # deletion
            continue
        local = local_id.decode("ascii") + "^{commit}"
        base = (
            remote_id.decode("ascii") + "^{commit}"
            if remote_id.strip(b"0")
            else remote_base(remote, local)
        )
        if (
            not base
            or subprocess.run(
                ["git", "cat-file", "-e", base],
                cwd=ROOT,
                stderr=subprocess.DEVNULL,
                check=False,
            ).returncode
        ):
            # New branch/tag or a shallow clone without the remote object.
            data = git("ls-tree", "--name-only", "-r", "-z", local)
            modified = {os.fsdecode(name) for name in data.split(b"\0") if name}
        else:
            modified = changed_paths(base, local)
        affected = affected_components(modified)
        if affected.intersection({COSMIC_WEB, CHAOS}) and git(
            "rev-parse", local
        ) != git("rev-parse", "HEAD"):
            sys.exit(
                "Check out the revision to push before running its component checks."
            )
        if CHAOS in affected:
            chaos_updates.append(line + b"\n")
        paths.update(modified)
    return paths, b"".join(chaos_updates)


def main(stage, args):
    if stage == "pre-push":
        paths, updates = push_paths(sys.stdin.buffer.read(), args[0])
    else:
        updates = None
        paths = changed_paths("--cached")
    components = affected_components(paths)
    message = str(Path(args[0]).resolve()) if stage == "commit-msg" else None

    # A subdirectory chdir must not change the meaning of Git's temporary index/worktree.
    for name in ("GIT_INDEX_FILE", "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"):
        if os.environ.get(name):
            os.environ[name] = os.path.abspath(os.environ[name])

    if COSMIC_WEB in components:
        hook = ROOT / COSMIC_WEB / ".husky" / stage
        subprocess.run(
            ["sh", str(hook), *([message] if message else [])],
            cwd=ROOT / COSMIC_WEB,
            check=True,
        )
    if CHAOS in components and stage in {"pre-commit", "pre-push"}:
        subprocess.run(
            [str(ROOT / CHAOS / ".githooks" / stage)],
            cwd=ROOT / CHAOS,
            check=True,
            input=updates,
        )


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2:])
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode)
    except FileNotFoundError as error:
        sys.exit(f"{error}. Install the dependencies for the changed component.")
