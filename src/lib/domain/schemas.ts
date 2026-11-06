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
