import { describe, expect, it } from "vitest";
import { dayKind, formatTime, formatWhen } from "./date";

const labels = { today: (t: string) => `сегодня ${t}`, yesterday: (t: string) => `вчера ${t}` };
const now = new Date(2026, 10, 7, 12, 0);
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();

describe("date helpers", () => {
  it("classifies local days", () => {
    expect(dayKind(at(7, 0, 5), now)).toBe("today");
    expect(dayKind(at(6, 23, 59), now)).toBe("yesterday");
    expect(dayKind(at(5, 12), now)).toBe("other");
    expect(dayKind(at(8, 1), now)).toBe("other");
  });
  it("formats times and the card label", () => {
    expect(formatTime(at(7, 18, 40))).toBe("18:40");
    expect(formatWhen(at(7, 18, 40), labels, now)).toBe("сегодня 18:40");
    expect(formatWhen(at(6, 9, 5), labels, now)).toBe("вчера 09:05");
    expect(formatWhen(at(3, 18, 40), labels, now)).toMatch(/^3 нояб\.? 18:40$/);
  });
});
