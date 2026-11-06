import { z } from "zod";

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);
const optional = <T extends z.ZodType>(s: T) => z.preprocess(emptyToUndefined, s.optional());

const schema = z
  .object({
    NEXT_PUBLIC_DATA_MODE: z.enum(["mock", "supabase"]).default("supabase"),
    /** Set to "1" only by the E2E harness: allows mock data in a production build. */
    NEXT_PUBLIC_E2E: optional(z.enum(["1"])),
    NEXT_PUBLIC_SUPABASE_URL: optional(z.url()),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: optional(z.string().min(1)),
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: optional(z.string().min(1)),
  })
  .superRefine((env, ctx) => {
    if (env.NEXT_PUBLIC_DATA_MODE === "mock") return;
    for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const) {
      if (!env[key]) {
        ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when NEXT_PUBLIC_DATA_MODE is not "mock"` });
      }
    }
  });

export type PublicEnv = z.infer<typeof schema>;

/** Pure validation, so it is testable with any source object. Only NEXT_PUBLIC_* values live here. */
export function parsePublicEnv(source: Record<string, string | undefined>, nodeEnv?: string): PublicEnv {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  const env = result.data;
  if (env.NEXT_PUBLIC_DATA_MODE === "mock" && nodeEnv === "production" && env.NEXT_PUBLIC_E2E !== "1") {
    throw new Error('NEXT_PUBLIC_DATA_MODE="mock" is not allowed in production (set NEXT_PUBLIC_E2E=1 only for E2E runs)');
  }
  return env;
}

/** Lazily validated. NEXT_PUBLIC_* must be read as literal `process.env.X` so Next can inline them. */
export function getPublicEnv(): PublicEnv {
  return parsePublicEnv(
    {
      NEXT_PUBLIC_DATA_MODE: process.env.NEXT_PUBLIC_DATA_MODE,
      NEXT_PUBLIC_E2E: process.env.NEXT_PUBLIC_E2E,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    },
    process.env.NODE_ENV,
  );
}

/** The dev gallery is hidden in production unless the E2E flag is on. */
export function isKitEnabled(nodeEnv: string | undefined, e2e: string | undefined): boolean {
  return nodeEnv !== "production" || e2e === "1";
}
