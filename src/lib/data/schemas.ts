import { z } from "zod";

/**
 * Shared input validation. The mock repo uses it today; the Supabase repo and its
 * server actions reuse it in slice 1 so both implementations reject the same inputs.
 */
const tenge = z.number().int().positive();

export const newPurchaseSchema = z
  .object({
    household_id: z.string().min(1),
    amount: tenge,
    description: z.string().trim().min(1, "Description is required").max(200),
    merchant: z.string().trim().max(100).nullish(),
    source: z.enum(["apple_pay", "manual", "monthly"]).optional(),
    status: z.enum(["pending", "shared", "personal"]).optional(),
    payer_id: z.string().min(1).optional(),
    shares: z
      .array(z.object({ debtor_id: z.string().min(1), amount: z.number().int().nonnegative() }))
      .min(1, "At least one share is required"),
  })
  .superRefine((p, ctx) => {
    const total = p.shares.reduce((sum, s) => sum + s.amount, 0);
    if (total !== p.amount) {
      ctx.addIssue({ code: "custom", path: ["shares"], message: `Shares sum to ${total}, expected ${p.amount}` });
    }
    if (new Set(p.shares.map((s) => s.debtor_id)).size !== p.shares.length) {
      ctx.addIssue({ code: "custom", path: ["shares"], message: "Duplicate debtor" });
    }
  });

export const householdNameSchema = z.string().trim().min(1, "Household name is required").max(60);
