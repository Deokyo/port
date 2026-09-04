import { describe, expect, it } from "vitest";
import { loadEnv, ConfigurationError } from "../../src/config/env";

const base = { APP_TIMEZONE: "America/Sao_Paulo" } as NodeJS.ProcessEnv;

describe("Fase 1 — recusa de inicializacao insegura", () => {
  it("recusa producao sem DATABASE_URL, segredo forte, https e OIDC", () => {
    let error: ConfigurationError | null = null;
    try {
      loadEnv({ ...base, NODE_ENV: "production" });
    } catch (e) {
      error = e as ConfigurationError;
    }
    expect(error).toBeInstanceOf(ConfigurationError);
    const problems = error!.problems.join(" | ");
    expect(problems).toContain("DATABASE_URL");
    expect(problems).toContain("SESSION_SECRET");
    expect(problems).toContain("https");
    expect(problems).toContain("OIDC_ISSUER");
  });

  it("recusa AUTH_TEST_MODE fora de NODE_ENV=test", () => {
    expect(() => loadEnv({ ...base, NODE_ENV: "development", AUTH_TEST_MODE: "true" }))
      .toThrow(/AUTH_TEST_MODE/);
    expect(() => loadEnv({ ...base, NODE_ENV: "production", AUTH_TEST_MODE: "true" }))
      .toThrow(ConfigurationError);
  });

  it("recusa bootstrap de administrador sem provedor de identidade", () => {
    expect(() => loadEnv({ ...base, ADMIN_BOOTSTRAP_ENABLED: "true" }))
      .toThrow(/Bootstrap de administrador exige OIDC/);
  });

  it("aceita producao completa e marca oidcConfigured", () => {
    const cfg = loadEnv({
      ...base,
      NODE_ENV: "production",
      DB_DRIVER: "pg",
      DATABASE_URL: "postgres://win_app:x@db:5432/win",
      SESSION_SECRET: "0123456789012345678901234567890123456789",
      APP_BASE_URL: "https://win.example.invalid",
      OIDC_ISSUER: "https://idp.example.invalid",
      OIDC_CLIENT_ID: "id",
      OIDC_CLIENT_SECRET: "secret",
    });
    expect(cfg.isProductionLike).toBe(true);
    expect(cfg.oidcConfigured).toBe(true);
  });

  it("recusa timezone invalido", () => {
    expect(() => loadEnv({ APP_TIMEZONE: "Marte/Olympus" })).toThrow(/APP_TIMEZONE/);
  });
});
