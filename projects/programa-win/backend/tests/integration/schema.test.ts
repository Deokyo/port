import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdir } from "node:fs/promises";
import { createDb, type Db } from "../../src/db/client";
import { runMigrations, MIGRATIONS_DIR } from "../../src/db/migrate";
import { seedAll } from "../../src/db/seed";
import { resetEnvCache } from "../../src/config/env";

let db: Db;

beforeAll(async () => {
  db = await createDb({ pgliteMemory: true });
});
afterAll(async () => { await db.close(); });

describe("Fase 3 — migrations reproduziveis", () => {
  it("cria o banco do zero e e idempotente na segunda execucao", async () => {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql"));
    const first = await runMigrations(db);
    expect(first.applied.length).toBe(files.length);
    const second = await runMigrations(db);
    expect(second.applied).toEqual([]);
    expect(second.skipped.length).toBe(files.length);
  });

  it("cria todas as tabelas do modelo exigido", async () => {
    const rows = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const tables = new Set(rows.map((r) => r.table_name));
    for (const required of [
      "staff_member", "auth_identity", "role", "permission", "role_permission", "identity_role",
      "territory", "service", "subproduct", "referral", "referral_stage_event", "duplicate_check",
      "points_rule", "points_ledger", "achievement", "achievement_grant", "ranking_cycle",
      "ranking_snapshot", "cross_sell_opportunity", "notification", "import_job", "import_row",
      "audit_event",
    ]) {
      expect(tables, `tabela ausente: ${required}`).toContain(required);
    }
  });

  it("recusa migration ja aplicada que tenha sido alterada", async () => {
    await db.txAsOwner(async (t) => {
      await t.query(`update schema_migration set checksum = 'alterado' where filename = $1`, [
        "0001_base.sql",
      ]);
    });
    await expect(runMigrations(db)).rejects.toThrow(/imutaveis/);
    await db.txAsOwner(async (t) => {
      await t.query(`delete from schema_migration where filename = $1`, ["0001_base.sql"]);
    });
  });

  it("aplica constraints e chaves estrangeiras reais", async () => {
    await seedAll(db, { synthetic: false });
    // FK: indicacao sem funcionario existente e recusada
    await expect(db.txAsOwner(async (t) => {
      await t.query(
        `insert into referral (staff_id, service_id, client_company, occurred_at)
         values (gen_random_uuid(), (select id from service limit 1), 'X', now())`,
      );
    })).rejects.toThrow();
    // CHECK: matricula unica
    await db.txAsOwner(async (t) => {
      await t.query(`insert into staff_member (external_code, display_name) values ('DUP-1','A')`);
    });
    await expect(db.txAsOwner(async (t) => {
      await t.query(`insert into staff_member (external_code, display_name) values ('DUP-1','B')`);
    })).rejects.toThrow();
  });

  it("ALTO-05: nao permite marcar regra como aprovada sem aprovador e vigencia", async () => {
    await expect(db.txAsOwner(async (t) => {
      await t.query(
        `update business_rule set status = 'approved' where rule_key = 'RULE_POINTS_ACCRUAL'`,
      );
    })).rejects.toThrow();
  });

  it("so ficam aprovadas as regras que a politica assinada realmente fundamenta", async () => {
    const [counts] = await db.query<{ approved: number; ledger: number; award: number }>(
      `select (select count(*) from business_rule where status = 'approved')::int approved,
              (select count(*) from points_ledger)::int ledger,
              (select count(*) from award_ledger)::int award`,
    );
    // A politica LOCTL CORP COML 001 rev. 03 tem aprovadores identificaveis: por isso as regras
    // que ela cobre entram como 'approved'. As demais continuam sem aprovacao.
    expect(counts?.approved).toBeGreaterThan(0);
    // Nada e apurado so por existir regra: sem receita registrada, os dois ledgers ficam vazios.
    expect(counts?.ledger).toBe(0);
    expect(counts?.award).toBe(0);
  });

  it("nao existem duas versoes aprovadas da mesma regra ao mesmo tempo", async () => {
    const ambiguas = await db.query<{ rule_key: string }>(
      `select rule_key from business_rule where status = 'approved'
        group by rule_key having count(*) > 1`,
    );
    expect(ambiguas).toEqual([]);

    const aposentadas = await db.query<{ c: number }>(
      `select count(*)::int c from business_rule where status = 'retired'`,
    );
    expect(aposentadas[0]!.c).toBeGreaterThan(0);   // o historico permanece
  });

  it("toda regra aprovada tem aprovador, data e vigencia identificaveis", async () => {
    const orfas = await db.query<{ rule_key: string }>(
      `select rule_key from business_rule
        where status = 'approved'
          and (approver_name is null or approved_at is null or effective_from is null)`,
    );
    expect(orfas).toEqual([]);
    const [assinada] = await db.query<{ approver_name: string; source: string }>(
      `select approver_name, source from business_rule
        where rule_key = 'RULE_FINANCIAL_BONUS' and status = 'approved'`,
    );
    // O aprovador identificavel e o DOCUMENTO: nomes de signatarios nao ficam no codigo.
    expect(assinada?.approver_name).toContain("LOCTL CORP COML 001");
    expect(assinada?.approver_name).not.toMatch(/CPF|@|https?:/);
    expect(assinada?.source).toContain("LOCTL CORP COML 001");
  });

  it("sem aprovador configurado, as regras de decisao NAO entram como aprovadas", async () => {
    const semAprovador = await createDb({ pgliteMemory: true });
    try {
      await runMigrations(semAprovador);
      const anterior = process.env.WIN_DECISION_APPROVER;
      process.env.WIN_DECISION_APPROVER = "";
      resetEnvCache();
      try {
        await seedAll(semAprovador, { synthetic: false });
        const aprovadas = await semAprovador.query<{ rule_key: string }>(
          `select rule_key from business_rule
            where status = 'approved' and rule_key = 'RULE_POINTS_ACCRUAL'`,
        );
        // Gate do Rules Pack: aprovacao anonima nao entra no registro.
        expect(aprovadas).toEqual([]);
      } finally {
        process.env.WIN_DECISION_APPROVER = anterior;
        resetEnvCache();
      }
    } finally {
      await semAprovador.close();
    }
  });

  it("as regras sem decisao registrada continuam sem aprovacao", async () => {
    const semDecisao = await db.query<{ rule_key: string }>(
      `select rule_key from business_rule
        where rule_key in ('RULE_TERRITORY_THRESHOLD', 'RULE_TERRITORY_RETENTION',
                           'RULE_RANKING_CYCLE', 'RULE_ANTIFRAUD',
                           'RULE_RETENTION_INACTIVATION', 'RULE_POINTS_DISPUTE')
          and status = 'approved'`,
    );
    // Territorio, ranking, antifraude e retencao continuam sem fonte: nada e ligado por conta propria.
    expect(semDecisao).toEqual([]);
  });

  it("as decisoes de 2026-09-03 estao aprovadas com aprovador nomeado", async () => {
    const decididas = await db.query<{ rule_key: string; version: number; approver_name: string }>(
      `select rule_key, version, approver_name from business_rule
        where status = 'approved'
          and rule_key in ('RULE_POINTS_ACCRUAL', 'RULE_DUPLICATE_KEY',
                           'RULE_REFERRAL_STATE_MACHINE', 'RULE_OPERATING_MODEL')
        order by rule_key`,
    );
    // Uma unica versao vigente por regra: a anterior foi aposentada, nao apagada.
    expect(decididas).toHaveLength(4);
    expect(decididas.map((r) => r.rule_key)).toEqual([
      "RULE_DUPLICATE_KEY", "RULE_OPERATING_MODEL", "RULE_POINTS_ACCRUAL",
      "RULE_REFERRAL_STATE_MACHINE",
    ]);
    // O aprovador vem de configuracao (WIN_DECISION_APPROVER), nunca embutido no codigo.
    for (const regra of decididas) {
      expect(regra.approver_name).toBe("Aprovador Sintetico (fixture de teste)");
    }

    // Pontuacao cumulativa: a tabela de pontos da versao vigente vale 210 no funil completo.
    const [soma] = await db.query<{ total: number }>(
      `select sum(points)::int total from points_rule p
        join business_rule b on b.rule_key = p.rule_key and b.version = p.rule_version
       where b.rule_key = 'RULE_POINTS_ACCRUAL' and b.status = 'approved'`,
    );
    expect(soma?.total).toBe(210);
  });

  it("MED-02: catalogo confirmado modelado como dado, com aliases explicitos", async () => {
    const [counts] = await db.query<{ territories: number; services: number; aliases: number }>(
      `select (select count(*) from territory)::int territories,
              (select count(*) from service)::int services,
              (select count(*) from service_alias)::int aliases`,
    );
    expect(counts?.territories).toBe(4);
    expect(counts?.services).toBe(12);
    expect(counts!.aliases).toBeGreaterThan(12);
  });
});
