import { z } from "zod";
import { APPROVED_ROLE } from "@pricechecker/shared";
import { loadWorkspaceEnv } from "@pricechecker/shared/env";

loadWorkspaceEnv();

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  APPROVED_ROLE: z.string().default(APPROVED_ROLE),
  SERPAPI_API_KEY: z.string().optional(),
  API_PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
});

export const config = envSchema.parse(process.env);
