import { z } from "zod";

/**
 * Configuracao unica da aplicacao. Fase 1 do plano.
 * Regra dura: a aplicacao RECUSA iniciar quando faltar configuracao de seguranca
 * obrigatoria em staging/producao, e recusa qualquer modo de teste fora de NODE_ENV=test.
 */

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const PLACEHOLDER = /^__.*__$/;

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  APP_TIMEZONE: z.string().min(1).default("America/Sao_Paulo"),

  DB_DRIVER: z.enum(["pglite", "pg"]).default("pglite"),
  DB_PGLITE_PATH: z.string().default(".pgdata/win"),
  DATABASE_URL: z.string().optional(),

  SESSION_SECRET: z.string().default("dev-only-secret-dev-only-secret-dev-only"),
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(480),
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),

  OIDC_ISSUER: z.string().default(""),
  OIDC_CLIENT_ID: z.string().default(""),
  OIDC_CLIENT_SECRET: z.string().default(""),
  OIDC_SCOPES: z.string().default("openid profile email"),
  OIDC_REDIRECT_PATH: z.string().default("/auth/oidc/callback"),

  ADMIN_BOOTSTRAP_ENABLED: bool.default(false),
  ADMIN_BOOTSTRAP_TOKEN: z.string().default(""),

  IMPORT_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  IMPORT_MAX_UNCOMPRESSED_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  IMPORT_MAX_ROWS: z.coerce.number().int().positive().default(20_000),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  /**
   * Nome de quem responde pelas decisoes de negocio tomadas fora do documento assinado.
   * Sem este valor, as regras decididas por conversa ficam 'proposed' — o registro nunca
   * grava aprovacao anonima.
   */
  WIN_DECISION_APPROVER: z.string().default(""),

  AUTH_TEST_MODE: bool.default(false),
});

export type Env = z.infer<typeof schema> & {
  isProductionLike: boolean;
  oidcConfigured: boolean;
};

export class ConfigurationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Configuracao invalida:\n - ${problems.join("\n - ")}`);
    this.name = "ConfigurationError";
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigurationError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`),
    );
  }
  const env = parsed.data;
  const problems: string[] = [];
  const isProductionLike = env.NODE_ENV === "production" || env.NODE_ENV === "staging";

  if (env.AUTH_TEST_MODE && env.NODE_ENV !== "test") {
    problems.push("AUTH_TEST_MODE so pode ser ligado com NODE_ENV=test.");
  }

  if (isProductionLike) {
    if (env.DB_DRIVER !== "pg") problems.push("DB_DRIVER deve ser 'pg' em staging/producao.");
    if (!env.DATABASE_URL) problems.push("DATABASE_URL e obrigatoria em staging/producao.");
    if (
      env.SESSION_SECRET.length < 32 ||
      PLACEHOLDER.test(env.SESSION_SECRET) ||
      env.SESSION_SECRET.startsWith("dev-only")
    ) {
      problems.push("SESSION_SECRET precisa ter 32+ caracteres e nao pode ser o valor de exemplo.");
    }
    if (!env.APP_BASE_URL.startsWith("https://")) {
      problems.push("APP_BASE_URL precisa usar https em staging/producao.");
    }
    if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET) {
      problems.push(
        "OIDC_ISSUER, OIDC_CLIENT_ID e OIDC_CLIENT_SECRET sao obrigatorios: sem provedor de " +
          "identidade nao existe autoria auditavel (CRIT-03).",
      );
    }
    if (env.ADMIN_BOOTSTRAP_ENABLED && !env.ADMIN_BOOTSTRAP_TOKEN) {
      problems.push("ADMIN_BOOTSTRAP_ENABLED exige ADMIN_BOOTSTRAP_TOKEN.");
    }
  }

  if (env.DB_DRIVER === "pg" && !env.DATABASE_URL) {
    problems.push("DB_DRIVER=pg exige DATABASE_URL.");
  }
  if (env.ADMIN_BOOTSTRAP_ENABLED && !env.OIDC_ISSUER) {
    problems.push("Bootstrap de administrador exige OIDC configurado (AP-03).");
  }

  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: env.APP_TIMEZONE });
  } catch {
    problems.push(`APP_TIMEZONE invalido: ${env.APP_TIMEZONE}`);
  }

  if (problems.length) throw new ConfigurationError(problems);

  return {
    ...env,
    isProductionLike,
    oidcConfigured: Boolean(env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET),
  };
}

let cached: Env | null = null;
export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}
export function resetEnvCache(): void {
  cached = null;
}
