import { expect, type Page } from "@playwright/test";

/** The page goes to the background and comes back, like a user returning from the Kaspi app. */
export async function returnFromKaspi(page: Page) {
  await page.evaluate(() => {
    const set = (state: string) => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    set("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    set("visible");
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/**
 * Slice 17 replaces «Я оплатил»: tap «Перевести …» (opens kaspi.kz/transfers and records the prompt), come back to the
 * app, and answer the «Ты перевёл …?» sheet. Resolves when the mock store accepted the answer.
 */
export async function payViaKaspi(page: Page, answer: "yes" | "no" = "yes") {
  const context = page.context();
  await context.route("https://kaspi.kz/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>kaspi</title>" }));
  const popup = context.waitForEvent("page");
  const opened = page.waitForResponse((r) => r.url().includes("/api/settle/opened") && r.request().method() === "POST");
  await page.getByRole("button", { name: /^Перевести / }).click();
  const kaspi = await popup;
  expect((await opened).status()).toBe(200);
  await kaspi.close();
  await returnFromKaspi(page);
  const sheet = page.getByTestId("paid-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Ты перевёл");
  const saved = page.waitForResponse((r) => r.url().includes("/api/mock-store") && r.request().method() === "PUT" && r.status() === 204);
  await page.getByTestId(answer === "yes" ? "paid-yes" : "paid-no").click();
  await saved;
  await expect(sheet).toHaveCount(0);
}
