import { describe, expect, it } from "vitest";
import { peopleAfterNa } from "./plural";

describe("peopleAfterNa", () => {
  it("declines after 'на N'", () => {
    const f = (n: number) => `на ${n} ${peopleAfterNa(n)}`;
    expect(f(1)).toBe("на 1 человека");
    expect(f(2)).toBe("на 2 человека");
    expect(f(3)).toBe("на 3 человека");
    expect(f(4)).toBe("на 4 человека");
    expect(f(5)).toBe("на 5 человек");
    expect(f(11)).toBe("на 11 человек");
    expect(f(12)).toBe("на 12 человек");
    expect(f(21)).toBe("на 21 человека");
    expect(f(25)).toBe("на 25 человек");
  });
});
