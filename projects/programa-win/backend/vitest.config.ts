import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    reporters: ["verbose"],
    env: {
      NODE_ENV: "test",
      AUTH_TEST_MODE: "true",
      // Gate do Rules Pack: sem aprovador nomeado as regras decididas ficam 'proposed'.
      // Nos testes o aprovador e sinteticamente identificado, nunca uma pessoa real.
      WIN_DECISION_APPROVER: "Aprovador Sintetico (fixture de teste)",
      DB_DRIVER: "pglite",
      APP_TIMEZONE: "America/Sao_Paulo",
      LOG_LEVEL: "silent",
      RATE_LIMIT_MAX: "100000",
      SESSION_SECRET: "test-secret-test-secret-test-secret-1234",
    },
  },
});
