import { z } from "zod";

const EnvSchema = z.object({
  PLUMRR_API_BASE_URL: z.string().url().default("http://host.docker.internal:8000"),
  MCP_PORT: z.coerce.number().int().positive().default(8001),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info")
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function getConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return EnvSchema.parse(env);
}
