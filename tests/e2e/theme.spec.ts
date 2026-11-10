import { expect, test } from "@playwright/test";

/** Theme follows the phone's appearance: light «Белый + фиолет», dark unchanged, the island sheet black in both. */
const bg = (page: import("@playwright/test").Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

for (const [scheme, body, accent] of [
  ["light", "rgb(246, 246, 249)", "rgb(106, 63, 224)"],
  ["dark", "rgb(14, 15, 19)", "rgb(200, 242, 90)"],
] as const) {
  test(`${scheme}: page and accent colours`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/kit");
    await page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
    expect(await bg(page)).toBe(body);
    const lime = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-lime").trim());
    const probe = await page.evaluate((v) => {
      const el = document.createElement("i");
      el.style.color = v;
      document.body.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c;
    }, lime);
    expect(probe).toBe(accent);
  });
}

test("light: the island sheet stays black with light text", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/kit");
  await page.locator("html[data-hydrated='true']").waitFor({ state: "attached" });
  await page.getByRole("button", { name: /Apple Pay/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((el) => getComputedStyle(el.querySelector(".sheet-face")!).backgroundColor)).toBe("rgb(0, 0, 0)");
  expect(await dialog.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(242, 243, 245)");
});
