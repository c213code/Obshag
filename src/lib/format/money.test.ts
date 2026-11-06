import { describe, expect, it } from "vitest";
import { formatTenge } from "./money";

const NBSP = " ";

describe("formatTenge", () => {
  it("formats zero", () => {
    expect(formatTenge(0)).toBe(`0${NBSP}₸`);
  });
  it("formats hundreds without separator", () => {
    expect(formatTenge(200)).toBe(`200${NBSP}₸`);
  });
  it("formats thousands with nbsp separator", () => {
    expect(formatTenge(1500)).toBe(`1${NBSP}500${NBSP}₸`);
    expect(formatTenge(6000)).toBe(`6${NBSP}000${NBSP}₸`);
  });
  it("adds plus sign when sign option is set", () => {
    expect(formatTenge(7550, { sign: true })).toBe(`+7${NBSP}550${NBSP}₸`);
  });
  it("uses a real minus for negatives", () => {
    expect(formatTenge(-1200)).toBe(`−1${NBSP}200${NBSP}₸`);
    expect(formatTenge(-1200, { sign: true })).toBe(`−1${NBSP}200${NBSP}₸`);
  });
  it("does not sign zero", () => {
    expect(formatTenge(0, { sign: true })).toBe(`0${NBSP}₸`);
  });
  it("handles large numbers", () => {
    expect(formatTenge(12345678)).toBe(`12${NBSP}345${NBSP}678${NBSP}₸`);
  });
  it("always ends with the tenge sign", () => {
    expect(formatTenge(42).endsWith("₸")).toBe(true);
  });
  it("rounds non-integers", () => {
    expect(formatTenge(199.6)).toBe(`200${NBSP}₸`);
  });
});
