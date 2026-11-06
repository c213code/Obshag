import { describe, expect, it } from "vitest";
import { guardRedirect, stageOf } from "./guard";

describe("stageOf", () => {
  it("derives the onboarding stage", () => {
    expect(stageOf({ hasSession: false, hasProfile: false, householdCount: 0 })).toBe(0);
    expect(stageOf({ hasSession: true, hasProfile: false, householdCount: 0 })).toBe(1);
    expect(stageOf({ hasSession: true, hasProfile: true, householdCount: 0 })).toBe(2);
    expect(stageOf({ hasSession: true, hasProfile: true, householdCount: 2 })).toBe(3);
  });
});

describe("guardRedirect", () => {
  it("sends signed-out users to /login from anywhere inside", () => {
    expect(guardRedirect(0, "app")).toBe("/login");
    expect(guardRedirect(0, "onboarding")).toBe("/login");
    expect(guardRedirect(0, "household")).toBe("/login");
    expect(guardRedirect(0, "login")).toBeNull();
  });
  it("sends users without a profile to /onboarding", () => {
    expect(guardRedirect(1, "app")).toBe("/onboarding");
    expect(guardRedirect(1, "household")).toBe("/onboarding");
    expect(guardRedirect(1, "login")).toBe("/onboarding");
    expect(guardRedirect(1, "onboarding")).toBeNull();
  });
  it("sends users without a household to /household", () => {
    expect(guardRedirect(2, "app")).toBe("/household");
    expect(guardRedirect(2, "onboarding")).toBe("/household");
    expect(guardRedirect(2, "login")).toBe("/household");
    expect(guardRedirect(2, "household")).toBeNull();
  });
  it("lets complete users in, and keeps them out of the setup screens", () => {
    expect(guardRedirect(3, "app")).toBeNull();
    expect(guardRedirect(3, "household")).toBeNull();
    expect(guardRedirect(3, "login")).toBe("/");
    expect(guardRedirect(3, "onboarding")).toBe("/");
  });
});
