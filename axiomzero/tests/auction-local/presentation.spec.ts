import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
]) {
  test(`catalogue, lot and collector account at ${viewport.width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    // The disposable chain creates new artwork seeds, before the remote renderer runs.
    // Only the image response uses an existing collection work; all contract data is real.
    await page.route(
      "**/images/new/cosmicsignature/**/images/web/*.webp",
      (route) =>
        route.fulfill({
          contentType: "image/webp",
          path: resolve(
            process.cwd(),
            "src/components/auctions/collection-31.webp",
          ),
        }),
    );
    await page.goto("/auctions?view=all");
    const lots = page.getByRole("link", {
      name: /^(?:View auction for|Place a bid on) Cosmic Signature #/,
    });
    await expect(lots).toHaveCount(8);
    await expect(lots.last().getByRole("img")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    for (const view of ["catalogue", "artwork", "account"]) {
      if (view === "artwork") await lots.last().click();
      if (view === "account")
        await page
          .getByRole("link", { name: "Collector account", exact: true })
          .first()
          .click();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (view === "artwork")
        await expect(page.getByLabel("Auction bidding")).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(audit.violations).toEqual([]);
      const shot = info.outputPath(`${view}-${viewport.width}.png`);
      await page.screenshot({
        path: shot,
        fullPage: true,
        animations: "disabled",
      });
      await info.attach(`${view}-${viewport.width}`, {
        path: shot,
        contentType: "image/png",
      });
    }
  });
}
