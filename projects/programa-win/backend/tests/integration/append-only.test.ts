import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { seedAll } from "../../src/db/seed";
import { appendLedgerEntry, ledgerIdempotencyKey } from "../../src/domain/points";

let db: Db;
let staffId: string;

beforeAll(async () => {
  db = await createDb({ pgliteMemory: true });
  await runMigrations(db);
  await seedAll(db, { synthetic: true });
  const [staff] = await db.query<{ id: string }>(
    `select id from staff_member where external_code = 'WIN-0001'`,
  );
  staffId = staff!.id;
  await db.txAsOwner((t) =>
    appendLedgerEntry(t, {
      staffId, amount: 50, kind: "adjustment", origin: "manual",
      ruleKey: "RULE_POINTS_ADJUSTMENT", ruleVersion: 1, effectiveAt: new Date(),
      actorIdentityId: null, actorLabel: "system:test",
      idempotencyKey: ledgerIdempotencyKey(["fixture", "1"]), reason: "lancamento de fixture",
    }));
});
afterAll(async () => { await db.close(); });

describe("BD-04 ledger append-only com linha real", () => {
  it("bloqueia UPDATE em lancamento existente", async () => {
    await expect(db.txAsOwner(async (t) => {
      await t.query(`update points_ledger set amount = 999 where staff_id = $1`, [staffId]);
    })).rejects.toThrow(/APPEND_ONLY_VIOLATION/);
  });

  it("bloqueia DELETE em lancamento existente", async () => {
    await expect(db.txAsOwner(async (t) => {
      await t.query(`delete from points_ledger where staff_id = $1`, [staffId]);
    })).rejects.toThrow(/APPEND_ONLY_VIOLATION/);
  });

  it("a correcao acontece por lancamento compensatorio, preservando o historico", async () => {
    const [original] = await db.query<{ id: string }>(
      `select id from points_ledger where staff_id = $1 order by recorded_at limit 1`, [staffId],
    );
    await db.txAsOwner((t) =>
      appendLedgerEntry(t, {
        staffId, amount: -50, kind: "correction", origin: "manual",
        ruleKey: "RULE_POINTS_ADJUSTMENT", ruleVersion: 1, effectiveAt: new Date(),
        actorIdentityId: null, actorLabel: "system:test",
        idempotencyKey: ledgerIdempotencyKey(["fixture", "estorno"]),
        correctionOfEntryId: original!.id, reason: "estorno de teste com motivo obrigatorio",
      }));
    const rows = await db.query<{ c: number; balance: number }>(
      `select count(*)::int c, coalesce(sum(amount),0)::int balance
         from points_ledger where staff_id = $1`, [staffId],
    );
    expect(rows[0]!.c).toBe(2);      // o lancamento original continua la
    expect(rows[0]!.balance).toBe(0);
  });

  it("correcao sem motivo e recusada", async () => {
    const [original] = await db.query<{ id: string }>(
      `select id from points_ledger where staff_id = $1 limit 1`, [staffId],
    );
    await expect(db.txAsOwner((t) =>
      appendLedgerEntry(t, {
        staffId, amount: -10, kind: "correction", origin: "manual",
        ruleKey: "RULE_POINTS_ADJUSTMENT", ruleVersion: 1, effectiveAt: new Date(),
        actorIdentityId: null, actorLabel: "system:test",
        idempotencyKey: ledgerIdempotencyKey(["fixture", "sem-motivo"]),
        correctionOfEntryId: original!.id,
      }))).rejects.toThrow(/motivo/);
  });

  it("a mesma chave de idempotencia nao duplica lancamento", async () => {
    const key = ledgerIdempotencyKey(["fixture", "idem"]);
    const first = await db.txAsOwner((t) => appendLedgerEntry(t, {
      staffId, amount: 7, kind: "adjustment", origin: "manual",
      ruleKey: "RULE_POINTS_ADJUSTMENT", ruleVersion: 1, effectiveAt: new Date(),
      actorIdentityId: null, actorLabel: "system:test", idempotencyKey: key, reason: "x",
    }));
    const second = await db.txAsOwner((t) => appendLedgerEntry(t, {
      staffId, amount: 7, kind: "adjustment", origin: "manual",
      ruleKey: "RULE_POINTS_ADJUSTMENT", ruleVersion: 1, effectiveAt: new Date(),
      actorIdentityId: null, actorLabel: "system:test", idempotencyKey: key, reason: "x",
    }));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
  });

  it("auditoria e historico de etapas tambem sao append-only", async () => {
    await db.txAsOwner(async (t) => {
      await t.query(
        `insert into audit_event (actor_label, action, resource_type, outcome)
         values ('system:test','probe','system','allowed')`,
      );
    });
    await expect(db.txAsOwner(async (t) => {
      await t.query(`delete from audit_event`);
    })).rejects.toThrow(/APPEND_ONLY_VIOLATION/);
    await expect(db.txAsOwner(async (t) => {
      await t.query(`update referral_stage_event set actor_label = 'outro'`);
    })).rejects.toThrow(/APPEND_ONLY_VIOLATION/);
  });
});
