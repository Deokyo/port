import { rm } from "node:fs/promises";
import { env } from "../config/env";

const cfg = env();
if (cfg.isProductionLike) {
  console.error("db:reset e proibido em staging/producao.");
  process.exit(1);
}
if (cfg.DB_DRIVER !== "pglite") {
  console.error("db:reset so apaga o diretorio do PGlite. Para 'pg', use drop/create manual.");
  process.exit(1);
}
await rm(cfg.DB_PGLITE_PATH, { recursive: true, force: true });
console.log(`banco local removido: ${cfg.DB_PGLITE_PATH}`);
