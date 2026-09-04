import { env, ConfigurationError } from "./config/env";
import { createDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { buildServer } from "./http/server";
import { logger } from "./lib/logger";

async function main(): Promise<void> {
  const cfg = env();
  const db = await createDb();
  if (!cfg.isProductionLike) {
    // Em producao, migrations sao passo explicito de deploy — nunca automaticas.
    await runMigrations(db);
  }
  const app = await buildServer(db);
  const host = cfg.NODE_ENV === "test" && cfg.AUTH_TEST_MODE ? "127.0.0.1" : "0.0.0.0";
  await app.listen({ port: cfg.PORT, host });
  logger.info("server.started", { port: cfg.PORT, host, env: cfg.NODE_ENV, oidc: cfg.oidcConfigured });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void (async () => {
        await app.close();
        await db.close();
        process.exit(0);
      })();
    });
  }
}

main().catch((error) => {
  if (error instanceof ConfigurationError) {
    console.error("\nA aplicacao recusou iniciar por configuracao insegura ou incompleta:\n");
    for (const problem of error.problems) console.error(`  - ${problem}`);
    console.error("\nVeja .env.example e docs/SEGURANCA_E_PRIVACIDADE.md.\n");
    process.exit(78); // EX_CONFIG
  }
  console.error(error);
  process.exit(1);
});
