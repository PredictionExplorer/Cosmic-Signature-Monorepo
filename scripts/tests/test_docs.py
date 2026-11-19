from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.check_docs import check


class DocumentationLinksTest(unittest.TestCase):
    def test_checks_relative_paths_from_each_document_with_exact_case(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "docs" / "(app)").mkdir(parents=True)
            (root / "docs" / "guide one.md").write_text(
                "[home](../README.md) [guide](../docs/guide%20one.md#section)"
            )
            (root / "README.md").write_text(
                '[directory](docs/) [guide](<docs/guide one.md>) [route](docs/(app)/ "app")\n'
                "[wrong case](Docs/guide%20one.md) and [missing](gone.md)\n"
                "[outside](../) and [file as directory](README.md/)"
            )
            self.assertEqual(check(root), [
                "README.md:2: invalid relative path Docs/guide one.md",
                "README.md:2: invalid relative path gone.md",
                "README.md:3: invalid relative path ../",
                "README.md:3: invalid relative path README.md/",
            ])

    def test_code_external_urls_and_same_page_fragments_are_ignored(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "README.md").write_text(
                "[external](https://example.com/) [section](#intro)\n"
                "`[sample](absent)` [mail](mailto:example@example.com)\n"
                "````md\n```\n[example](absent)\n````\n"
                "~~~sh\n[example](absent)\n~~~\n"
                "[must still be checked](absent)"
            )
            self.assertEqual(check(root), ["README.md:10: invalid relative path absent"])
