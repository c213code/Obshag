import { describe, expect, it } from "vitest";
import { heroState, payablePairs, payTarget } from "./hero";

type Dir = "i_pay" | "they_pay";
const c = (userId: string, direction: Dir, net: number, active = true) => ({ userId, direction, net, active });

describe("heroState", () => {
  it("owe first: any payable debt of mine wins, the sum of what I owe", () => {
    expect(heroState([c("a", "they_pay", 5000), c("b", "i_pay", 300), c("d", "i_pay", 150)])).toEqual({ kind: "owe", amount: 450 });
  });
  it("then owed: the sum owed to me", () => {
    expect(heroState([c("a", "they_pay", 555), c("b", "they_pay", 100)])).toEqual({ kind: "owed", amount: 655 });
  });
  it("else «Всё ровно»", () => {
    expect(heroState([])).toEqual({ kind: "even" });
  });
  it("pairs under 100 ₸ are ignored in both directions", () => {
    expect(heroState([c("a", "i_pay", 99), c("b", "they_pay", 59)])).toEqual({ kind: "even" });
    expect(heroState([c("a", "i_pay", 99), c("b", "they_pay", 555)])).toEqual({ kind: "owed", amount: 555 });
    expect(heroState([c("a", "i_pay", 100), c("b", "i_pay", 40), c("d", "they_pay", 59)])).toEqual({ kind: "owe", amount: 100 });
  });
  it("a neighbour who left is not payable", () => {
    expect(heroState([c("a", "i_pay", 800, false), c("b", "they_pay", 300)])).toEqual({ kind: "owed", amount: 300 });
    expect(heroState([c("a", "they_pay", 800, false)])).toEqual({ kind: "even" });
  });
});

describe("payablePairs / payTarget", () => {
  it("keeps active pairs of 100 ₸ and up", () => {
    expect(payablePairs([c("a", "i_pay", 100), c("b", "i_pay", 99), c("d", "they_pay", 300, false)]).map((p) => p.userId)).toEqual(["a"]);
  });
  it("one person to pay: straight to them; several or none: null", () => {
    expect(payTarget([c("a", "i_pay", 300), c("b", "i_pay", 50), c("d", "they_pay", 900)])).toBe("a");
    expect(payTarget([c("a", "i_pay", 300), c("b", "i_pay", 150)])).toBeNull();
    expect(payTarget([c("a", "they_pay", 300)])).toBeNull();
  });
});
