"""Check relative inline link paths in the root guides, including exact spelling."""

from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit


# The root guides use inline Markdown links. Code samples can contain example paths.
LINK_START = re.compile(r"\]\(\s*")
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")


def link_destination(tail):
    if tail.startswith("<"):
        end = tail.find(">")
        return tail[1:end] if end != -1 else ""

    # Parentheses are common in Next.js route directories. A balanced pair
    # belongs to the destination. Whitespace introduces an optional title.
    depth = 0
    for index, char in enumerate(tail):
        if char.isspace() or (char == ")" and depth == 0):
            return tail[:index]
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
    return ""


def local_links(lines):
    fence = ""
    for number, line in enumerate(lines, start=1):
        if fence:
            closing = line.rstrip()
            if FENCE.fullmatch(closing) and closing.lstrip().startswith(fence):
                fence = ""
            continue
        opening = FENCE.match(line)
        if opening:
            fence = opening[1]
            continue
        line = re.sub(r"(`+).*?\1", "", line)
        for match in LINK_START.finditer(line):
            url = urlsplit(link_destination(line[match.end():]))
            if url.path and not (url.scheme or url.netloc):
                yield number, unquote(url.path)


def has_exact_path(root, document, target):
    """Use directory entries so the same capitalization rules apply on macOS and Linux."""
    if target.startswith("/"):
        return False
    current = document.parent
    for part in Path(target).parts:
        if part == "..":
            if current == root:
                return False
            current = current.parent
        elif current.is_dir() and part in {entry.name for entry in current.iterdir()}:
            current = current / part
        else:
            return False
    return current.exists() and (not target.endswith("/") or current.is_dir())


def check(root):
    documents = sorted([*root.glob("*.md"), *(root / "docs").rglob("*.md")])
    errors = []
    for document in documents:
        for number, target in local_links(document.read_text(encoding="utf-8").splitlines()):
            if not has_exact_path(root, document, target):
                errors.append(f"{document.relative_to(root)}:{number}: invalid relative path {target}")
    return errors


if __name__ == "__main__":
    problems = check(Path(__file__).resolve().parents[1])
    if problems:
        sys.exit("\n".join(problems))
    print("Verified relative link paths in the root guides and docs/.")
