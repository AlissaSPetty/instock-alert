import { z } from "zod";
import { loadWorkspaceEnv } from "@pricechecker/shared/env";

loadWorkspaceEnv();

const isTest = process.env.VITEST === "true" || process.env.NODE_ENV === "test";

/** Parses typical env truthiness without treating the string "false" as true (unlike z.coerce.boolean()). */
function booleanFromEnv(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === undefined || value === null || value === "") {
    return false;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

const envSchema = z
  .object({
    SUPABASE_URL: isTest
      ? z.string().url().default("https://example.supabase.co")
      : z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: isTest
      ? z.string().min(1).default("test-service-role-key")
      : z.string().min(1),
    WORKER_RUN_ONCE: z.preprocess(booleanFromEnv, z.boolean()).default(false),
    WORKER_POLL_MS: z.coerce.number().default(5000),
    WORKER_BATCH_SIZE: z.coerce.number().default(10),
    EMAIL_NOTIFICATIONS_ENABLED: z.preprocess(booleanFromEnv, z.boolean()).default(false),
    RESEND_API_KEY: z.string().default(""),
    RESEND_FROM_EMAIL: z.string().default(""),
  })
  .refine(
    (data) =>
      !data.EMAIL_NOTIFICATIONS_ENABLED ||
      (data.RESEND_API_KEY.length > 0 && data.RESEND_FROM_EMAIL.length > 0),
    {
      message:
        "When EMAIL_NOTIFICATIONS_ENABLED is true, set RESEND_API_KEY and RESEND_FROM_EMAIL (e.g. Pricechecker <alerts@yourdomain.com>).",
    },
  );

export const config = envSchema.parse(process.env);
