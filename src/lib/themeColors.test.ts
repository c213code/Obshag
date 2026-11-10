import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEME_COLOR_DARK, THEME_COLOR_LIGHT } from "./themeColors";

const css = readFileSync("src/styles/tokens.css", "utf8");

describe("themeColors", () => {
  it("dark matches the default --color-bg", () => {
    expect(css.match(/--color-bg:\s*(#[0-9a-f]{6})/i)?.[1]).toBe(THEME_COLOR_DARK);
  });
  it("light matches the light --color-bg", () => {
    const light = css.slice(css.indexOf("prefers-color-scheme: light"));
    expect(light.match(/--color-bg:\s*(#[0-9a-f]{6})/i)?.[1]).toBe(THEME_COLOR_LIGHT);
  });
});
