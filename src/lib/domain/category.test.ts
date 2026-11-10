import { describe, expect, it } from "vitest";
import { categoryFor } from "./category";

const c = (description: string, merchant: string | null = null, bill_id: string | null = null) => categoryFor({ description, merchant, bill_id });

describe("categoryFor", () => {
  it.each([
    ["Хлеб, картошка", "bread"],
    ["нан", "bread"],
    ["Овощи", "carrot"],
    ["Пияз", "carrot"],
    ["Сабиз", "carrot"],
    ["Вода 19л", "drop"],
    ["су", "drop"],
    ["Молоко", "milk"],
    ["Мясо", "meat"],
    ["ет", "meat"],
    ["Ужин в кафе", "cart"],
  ])("%s -> %s", (text, expected) => expect(c(text)).toBe(expected));

  it("does not match short keywords inside other words", () => {
    expect(c("Суп")).toBe("cart");
    expect(c("Метр")).toBe("cart");
  });
  it("reads the merchant", () => {
    expect(c("Покупки", "Magnum")).toBe("store");
    expect(c("Покупки", "Small")).toBe("store");
  });
  it("monthly bills are home", () => expect(c("Интернет", null, "b1")).toBe("home"));
});
