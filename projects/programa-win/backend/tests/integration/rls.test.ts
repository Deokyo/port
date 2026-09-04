import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db, type ActorContext } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { seedAll } from "../../src/db/seed";

let db: Db;
let participant: ActorContext;
let other: ActorContext;
const director: ActorContext = {
  identityId: null, staffId: null, roles: ["diretoria"], label: "director:test",
};
const admin: ActorContext = {
  identityId: null, staffId: null, roles: ["administrador"], label: "admin:test",
};

beforeAll(async () => {
  db = await createDb({ pgliteMemory: true });
  await runMigrations(db);
  await seedAll(db, { synthetic: true });
  const staff = await db.query<{ id: string; external_code: string }>(
    `select id, external_code from staff_member order by external_code limit 2`,
  );
  participant = { identityId: null, staffId: staff[0]!.id, roles: ["participante"], label: "p1" };
  other = { identityId: null, staffId: staff[1]!.id, roles: ["participante"], label: "p2" };
});
afterAll(async () => { await db.close(); });

describe("BD-11 — Row Level Security aplicada no banco", () => {
  it("o participante enxerga apenas as proprias indicacoes", async () => {
    const mine = await db.tx(participant, (t) =>
      t.query<{ c: number }>("select count(*)::int c from referral"));
    const theirs = await db.tx(other, (t) =>
      t.query<{ c: number }>("select count(*)::int c from referral"));
    const all = await db.tx(admin, (t) =>
      t.query<{ c: number }>("select count(*)::int c from referral"));

    expect(mine[0]!.c).toBeGreaterThan(0);
    expect(all[0]!.c).toBe(96);
    expect(mine[0]!.c).toBeLessThan(all[0]!.c);
    expect(mine[0]!.c + theirs[0]!.c).toBeLessThanOrEqual(all[0]!.c);

    const foreign = await db.tx(participant, (t) =>
      t.query<{ c: number }>("select count(*)::int c from referral where staff_id = $1", [other.staffId]));
    expect(foreign[0]!.c).toBe(0);
  });

  it("a RLS resiste a consulta que tenta enderecar a linha alheia diretamente", async () => {
    const [target] = await db.tx(admin, (t) =>
      t.query<{ id: string }>("select id from referral where staff_id = $1 limit 1", [other.staffId]));
    const attempt = await db.tx(participant, (t) =>
      t.query<{ id: string }>("select id from referral where id = $1", [target!.id]));
    expect(attempt).toEqual([]);
  });

  it("participante nao le a trilha de auditoria; administrador le", async () => {
    await db.txAsOwner(async (t) => {
      await t.query(
        `insert into audit_event (actor_label, action, resource_type, outcome)
         values ('system:test','probe','system','allowed')`,
      );
    });
    const asParticipant = await db.tx(participant, (t) =>
      t.query<{ c: number }>("select count(*)::int c from audit_event"));
    const asAdmin = await db.tx(admin, (t) =>
      t.query<{ c: number }>("select count(*)::int c from audit_event"));
    expect(asParticipant[0]!.c).toBe(0);
    expect(asAdmin[0]!.c).toBeGreaterThan(0);
  });

  it("importacao e area exclusivamente administrativa mesmo no nivel do banco", async () => {
    const rows = await db.tx(participant, (t) =>
      t.query<{ c: number }>("select count(*)::int c from import_job"));
    expect(rows[0]!.c).toBe(0);
  });

  it("conflitos de titularidade ficam invisiveis ao participante e visiveis a Diretoria", async () => {
    const [referral] = await db.tx(admin, (t) =>
      t.query<{ id: string }>("select id from referral limit 1"));
    await db.tx(admin, (t) =>
      t.query(
        `insert into duplicate_check (fingerprint, referral_id, rule_version, decision)
         values ('rls-conflict-test', $1, 'RULE_DUPLICATE_KEY@3', 'pending')`,
        [referral!.id],
      ));

    const [participantCount] = await db.tx(participant, (t) =>
      t.query<{ c: number }>("select count(*)::int c from duplicate_check"));
    const [directorCount] = await db.tx(director, (t) =>
      t.query<{ c: number }>("select count(*)::int c from duplicate_check"));
    expect(participantCount!.c).toBe(0);
    expect(directorCount!.c).toBeGreaterThan(0);
  });

  it("Diretoria consegue ler staff e indicacao necessarios para decidir titularidade", async () => {
    const [staff] = await db.tx(director, (t) =>
      t.query<{ c: number }>("select count(*)::int c from staff_member"));
    const [referrals] = await db.tx(director, (t) =>
      t.query<{ c: number }>("select count(*)::int c from referral"));
    expect(staff!.c).toBeGreaterThan(0);
    expect(referrals!.c).toBeGreaterThan(0);
  });

  it("BD-08: a role da aplicacao nao consegue apagar historico nem com SQL direto", async () => {
    await expect(db.tx(admin, async (t) => {
      await t.query("delete from referral_stage_event");
    })).rejects.toThrow();
  });

  it("a view de saldo respeita a RLS (security_invoker)", async () => {
    const [balanceAsOther] = await db.tx(other, (t) =>
      t.query<{ c: number }>(
        "select count(*)::int c from points_balance where staff_id = $1", [participant.staffId],
      ));
    expect(balanceAsOther!.c).toBe(0);
  });
});
