import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./client";
import { logger } from "../lib/logger";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(HERE, "../../db/migrations");

export interface MigrationResult { applied: string[]; skipped: string[] }

export async function runMigrations(db: Db, dir = MIGRATIONS_DIR): Promise<MigrationResult> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  const skipped: string[] = [];

  // A tabela de controle vive na primeira migration; antes disso ela pode nao existir.
  const known = new Map<string, string>();
  try {
    const rows = await db.query<{ filename: string; checksum: string }>(
      "select filename, checksum from schema_migration",
    );
    for (const r of rows) known.set(r.filename, r.checksum);
  } catch {
    // primeira execucao: schema_migration ainda nao existe
  }

  for (const file of files) {
    const sql = await readFile(join(dir, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const previous = known.get(file);
    if (previous) {
      if (previous !== checksum) {
        throw new Error(
          `Migration ja aplicada foi alterada: ${file}. Migrations sao imutaveis; crie uma nova.`,
        );
      }
      skipped.push(file);
      continue;
    }
    await db.txAsOwner(async (t) => {
      await t.exec(sql);
      await t.query("insert into schema_migration (filename, checksum) values ($1, $2)", [
        file,
        checksum,
      ]);
    });
    applied.push(file);
    logger.info("migration.applied", { migration: file });
  }
  return { applied, skipped };
}
