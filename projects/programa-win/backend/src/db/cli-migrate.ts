import { createDb } from "./client";
import { runMigrations } from "./migrate";

const db = await createDb();
const result = await runMigrations(db);
console.log(`migrations aplicadas: ${result.applied.length}, ja existentes: ${result.skipped.length}`);
for (const f of result.applied) console.log(`  + ${f}`);
await db.close();
