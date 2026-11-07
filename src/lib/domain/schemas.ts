import { isAllowedPushEndpoint } from "./pushEndpoint";
import { z } from "zod";

/**
 * Input validation shared by mockRepo, supabaseRepo and (later) server actions,
 * so every implementation rejects exactly the same inputs.
 */
export const MAX_AMOUNT = 10_000_000;

export const tengeSchema = z.number().int().min(1).max(MAX_AMOUNT);

/** "8 (700) 123-45-67", "7001234567" and "+7 700 123 45 67" all become "+77001234567". */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) return `+${digits}`; // explicit country code: keep it, the schema checks it
  if (digits.length === 11 && (digits.startsWith("8") || digits.startsWith("7"))) return `+7${digits.slice(1)}`;
  if (digits.length === 10) return `+7${digits}`;
  return raw.trim();
}

export const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .pipe(z.string().regex(/^\+7\d{10}$/, "Phone must look like +7XXXXXXXXXX"));

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(120));

export const MIN_PASSWORD = 8;
/** Supabase hashes with bcrypt, which only looks at the first 72 bytes. */
export const passwordSchema = z.string().min(MIN_PASSWORD, "Password is shorter than 8 characters").max(72, "Password is too long");

export const profileSchema = z.object({
  display_name: z.string().trim().min(1, "Name is required").max(40),
  kaspi_phone: phoneSchema,
});
export type ProfileInput = z.input<typeof profileSchema>;

/** Case, spaces and dashes are ignored: "kv42-ab7k 9m3x" -> "KV42AB7K9M3X". */
export const inviteCodeSchema = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, "").toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{10,32}$/, "Invalid invite code"));

export const householdNameSchema = z.string().trim().min(1, "Household name is required").max(60);

export const MAX_PARTICIPANTS = 50;

export const createPurchaseSchema = z
  .object({
    household_id: z.string().min(1),
    amount: tengeSchema,
    description: z.string().trim().min(1, "Description is required").max(200),
    merchant: z.string().trim().max(120).nullish(),
    participant_ids: z
      .array(z.string().min(1))
      .min(1, "At least one participant is required")
      .max(MAX_PARTICIPANTS, "Too many participants")
      .refine((ids) => new Set(ids).size === ids.length, "Duplicate participant"),
  })
  // nobody may owe 0 tenge: SQL create_purchase_with_shares enforces the same rule
  .refine((p) => p.amount >= p.participant_ids.length, {
    path: ["amount"],
    message: "Amount is smaller than the number of participants",
  });
export type CreatePurchaseInput = z.input<typeof createPurchaseSchema>;

/** Custom split: explicit amounts that sum to the total; at least one entry is not the payer (checked where the payer is known). */
export const createPurchaseCustomSchema = z
  .object({
    household_id: z.string().min(1),
    amount: tengeSchema,
    description: z.string().trim().min(1, "Description is required").max(200),
    merchant: z.string().trim().max(120).nullish(),
    shares: z
      .array(z.object({ user_id: z.string().min(1), amount: z.number().int().min(0).max(MAX_AMOUNT) }))
      .min(1, "At least one entry is required")
      .max(MAX_PARTICIPANTS, "Too many participants")
      .refine((rows) => new Set(rows.map((r) => r.user_id)).size === rows.length, "Duplicate participant"),
  })
  .refine((p) => p.shares.reduce((sum, r) => sum + r.amount, 0) === p.amount, { path: ["shares"], message: "Amounts must add up to the total" });
export type CreatePurchaseCustomInput = z.input<typeof createPurchaseCustomSchema>;

export const descriptionSchema = z.string().trim().min(1, "Description is required").max(200);

/** The body of POST /api/remind. */
export const remindBodySchema = z.object({ household_id: z.string().min(1).max(64), debtor_id: z.string().min(1).max(64) }).strict();

export const RESOLVE_DESCRIPTION_MAX = 200;

/** resolve_pending input. Shared needs participants (the payer included, like a new purchase); personal ignores them. */
export const resolvePendingSchema = z
  .object({
    shared: z.boolean(),
    description: z.string().trim().max(RESOLVE_DESCRIPTION_MAX).optional(),
    participant_ids: z
      .array(z.string().min(1))
      .max(MAX_PARTICIPANTS, "Too many participants")
      .refine((ids) => new Set(ids).size === ids.length, "Duplicate participant")
      .optional(),
  })
  .refine((r) => !r.shared || (r.participant_ids?.length ?? 0) >= 1, { message: "At least one participant is required", path: ["participant_ids"] });
export type ResolvePendingInput = z.input<typeof resolvePendingSchema>;

/** The body an iOS Shortcut posts to /api/capture. `amount` is parsed leniently by parseAmount. */
export const captureBodySchema = z.object({
  token: z.string().min(20).max(200),
  amount: z.union([z.string().max(64), z.number()]),
  merchant: z.string().max(120).nullish(),
});

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(isAllowedPushEndpoint, "push endpoint host is not allowed"),
  p256dh: z.string().min(1).max(256),
  auth: z.string().min(1).max(256),
});
