import { describe, expect, it } from "vitest";
import {
  createPurchaseSchema,
  emailSchema,
  householdNameSchema,
  inviteCodeSchema,
  normalizePhone,
  passwordSchema,
  profileSchema,
} from "./schemas";

describe("normalizePhone", () => {
  it("accepts common Kazakh formats", () => {
    expect(normalizePhone("+7 700 123 45 67")).toBe("+77001234567");
    expect(normalizePhone("8 (700) 123-45-67")).toBe("+77001234567");
    expect(normalizePhone("7001234567")).toBe("+77001234567");
    expect(normalizePhone("77001234567")).toBe("+77001234567");
  });
  it("leaves junk for the schema to reject", () => {
    expect(normalizePhone("123")).toBe("123");
  });
});

describe("profileSchema", () => {
  it("accepts a name and +7XXXXXXXXXX phone", () => {
    expect(profileSchema.parse({ display_name: "  Ерасыл ", kaspi_phone: "+7 700 123 45 67" })).toEqual({
      display_name: "Ерасыл",
      kaspi_phone: "+77001234567",
    });
  });
  it("rejects bad phones and empty names", () => {
    expect(profileSchema.safeParse({ display_name: "A", kaspi_phone: "+7700123" }).success).toBe(false);
    expect(profileSchema.safeParse({ display_name: "A", kaspi_phone: "+87001234567" }).success).toBe(false);
    expect(profileSchema.safeParse({ display_name: "  ", kaspi_phone: "+77001234567" }).success).toBe(false);
    expect(profileSchema.safeParse({ display_name: "x".repeat(41), kaspi_phone: "+77001234567" }).success).toBe(false);
  });
});

describe("auth schemas", () => {
  it("validates email and a 6 digit code", () => {
    expect(emailSchema.parse("  A@Mail.com ")).toBe("a@mail.com");
    expect(emailSchema.safeParse("nope").success).toBe(false);
    expect(passwordSchema.safeParse("password123").success).toBe(true);
    expect(passwordSchema.safeParse("1234567").success).toBe(false);
    expect(passwordSchema.safeParse("12345678").success).toBe(true);
    expect(passwordSchema.safeParse("x".repeat(73)).success).toBe(false);
  });
  it("normalizes invite codes and rejects junk", () => {
    expect(inviteCodeSchema.parse(" kv42-ab7k 9m3x ")).toBe("KV42AB7K9M3X");
    expect(inviteCodeSchema.safeParse("short").success).toBe(false);
    expect(inviteCodeSchema.safeParse("a".repeat(40)).success).toBe(false);
  });
  it("trims household names", () => {
    expect(householdNameSchema.parse("  Квартира 42 ")).toBe("Квартира 42");
    expect(householdNameSchema.safeParse("   ").success).toBe(false);
    expect(householdNameSchema.safeParse("x".repeat(61)).success).toBe(false);
  });
});

describe("createPurchaseSchema", () => {
  const base = { household_id: "h1", amount: 6000, description: " Хлеб ", participant_ids: ["a", "b"] };
  it("accepts a valid purchase and trims text", () => {
    expect(createPurchaseSchema.parse(base)).toMatchObject({ description: "Хлеб", amount: 6000 });
  });
  it("bounds the amount to 1..10_000_000 integers", () => {
    expect(createPurchaseSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(createPurchaseSchema.safeParse({ ...base, amount: 10_000_001 }).success).toBe(false);
    expect(createPurchaseSchema.safeParse({ ...base, amount: 10_000_000 }).success).toBe(true);
    expect(createPurchaseSchema.safeParse({ ...base, amount: 1.5 }).success).toBe(false);
  });
  it("requires a description and unique participants", () => {
    expect(createPurchaseSchema.safeParse({ ...base, description: "  " }).success).toBe(false);
    expect(createPurchaseSchema.safeParse({ ...base, participant_ids: [] }).success).toBe(false);
    expect(createPurchaseSchema.safeParse({ ...base, participant_ids: ["a", "a"] }).success).toBe(false);
  });
  it("rejects an amount smaller than the number of people (no 0 tenge shares)", () => {
    const three = { ...base, participant_ids: ["a", "b", "c"] };
    expect(createPurchaseSchema.safeParse({ ...three, amount: 2 }).success).toBe(false);
    expect(createPurchaseSchema.safeParse({ ...three, amount: 3 }).success).toBe(true);
    const r = createPurchaseSchema.safeParse({ ...three, amount: 2 });
    expect(!r.success && r.error.issues[0].path).toEqual(["amount"]);
  });
  it("caps participants at 50 and merchant at 120", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`);
    expect(createPurchaseSchema.safeParse({ ...base, participant_ids: ids(50) }).success).toBe(true);
    expect(createPurchaseSchema.safeParse({ ...base, participant_ids: ids(51) }).success).toBe(false);
    expect(createPurchaseSchema.safeParse({ ...base, merchant: "m".repeat(120) }).success).toBe(true);
    expect(createPurchaseSchema.safeParse({ ...base, merchant: "m".repeat(121) }).success).toBe(false);
  });
});
