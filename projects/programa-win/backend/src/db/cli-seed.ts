import { createDb } from "./client";
import { seedAll } from "./seed";

const synthetic = !process.argv.includes("--no-synthetic");
const db = await createDb();
await seedAll(db, { synthetic });
const counts = await db.query<{ staff: number; referrals: number; rules: number }>(
  `select (select count(*) from staff_member)::int staff,
          (select count(*) from referral)::int referrals,
          (select count(*) from business_rule)::int rules`,
);
console.log("seed concluido:", counts[0]);
const [ledgers] = await db.query<{ pontos: number; premiacao: number }>(
  `select (select count(*) from points_ledger)::int pontos,
          (select count(*) from award_ledger)::int premiacao`,
);
console.log(
  `ledgers: ${ledgers?.pontos ?? 0} lancamento(s) de pontos, ` +
  `${ledgers?.premiacao ?? 0} de premiacao. A base sintetica nao lanca nada: ` +
  "pontos so nascem de etapa registrada e premiacao so nasce de receita recebida.",
);
await db.close();
