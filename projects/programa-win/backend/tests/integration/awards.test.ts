import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { createDb, type Db, type ActorContext } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { seedAll } from "../../src/db/seed";
import {
  approvePayoutBatch, awardStatement, recordRevenue, registerQualifiedMeeting,
  situationFor, validateOpportunity, withinFirstTwelveMonths,
} from "../../src/domain/awards";

/**
 * Politica LOCTL CORP COML 001 revisao 03 — Anexo I:
 *   reuniao qualificada .................... R$ 50,00 (colaborador)
 *   novo servico / cross-sell / up-sell .... 1,50% colaborador + 0,50% gestor
 *   novo cliente por indicacao/networking .. 3,00% colaborador
 *   novo cliente originado pelo gestor ..... 3,00% gestor
 * Base: receita liquida EFETIVAMENTE RECEBIDA (secao 5), com teto de 12 meses no recorrente.
 */

let db: Db;
let comercial: ActorContext;
let diretoria: ActorContext;
let financeiro: ActorContext;
let colaboradorId: string;
let gestorId: string;

async function novaOportunidade(options: {
  tipo: "new_client" | "new_service" | "cross_sell" | "up_sell";
  comGestor?: boolean;
  originadaPeloGestor?: boolean;
  recorrente?: boolean;
  inicioPrestacao?: string;
}): Promise<string> {
  return db.txAsOwner(async (t) => {
    const dono = options.originadaPeloGestor ? gestorId : colaboradorId;
    const [row] = await t.query<{ id: string }>(
      `insert into referral
         (staff_id, service_id, client_company, current_stage, occurred_at, source,
          opportunity_type, manager_staff_id, contract_billing, contract_signed_at,
          service_started_at)
       values ($1, (select id from service where slug = 'fiscal'), 'Empresa Teste (ficticia)',
               'sale_won', '2026-09-01T12:00:00Z', 'manual', $2::opportunity_type, $3,
               $4::contract_billing, $5, $5)
       returning id`,
      [
        dono, options.tipo,
        options.originadaPeloGestor ? gestorId : (options.comGestor ? gestorId : null),
        options.recorrente ? "recurring" : "one_off",
        options.inicioPrestacao ?? "2026-09-01T12:00:00Z",
      ],
    );
    return row!.id;
  });
}

async function validar(referralId: string): Promise<void> {
  await db.tx(comercial, (t) =>
    validateOpportunity(t, comercial, { referralId, decision: "eligible" }));
}

beforeEach(async () => {
  db = await createDb({ pgliteMemory: true });
  await runMigrations(db);
  await seedAll(db, { synthetic: true });
  const ids = await db.txAsOwner(async (t) => {
    const [c] = await t.query<{ id: string }>(
      `select id from staff_member where external_code = 'WIN-0001'`);
    const [g] = await t.query<{ id: string }>(
      `select id from staff_member where external_code = 'WIN-0007'`);
    const [i] = await t.query<{ id: string }>(
      `insert into auth_identity (issuer, subject) values ('urn:test','comercial') returning id`);
    const [d] = await t.query<{ id: string }>(
      `insert into auth_identity (issuer, subject) values ('urn:test','diretoria') returning id`);
    const [f] = await t.query<{ id: string }>(
      `insert into auth_identity (issuer, subject) values ('urn:test','financeiro') returning id`);
    return { c: c!.id, g: g!.id, i: i!.id, d: d!.id, f: f!.id };
  });
  colaboradorId = ids.c;
  gestorId = ids.g;
  comercial = {
    identityId: ids.i, staffId: null, roles: ["validador_comercial"], label: "Comercial de Teste",
  };
  diretoria = {
    identityId: ids.d, staffId: null, roles: ["diretoria"], label: "Diretoria de Teste",
  };
  // Secao 5/8: o registro da receita recebida e ato financeiro/administrativo, nao do Comercial.
  financeiro = {
    identityId: ids.f, staffId: null, roles: ["administrador"], label: "Financeiro de Teste",
  };
});
afterEach(async () => { await db.close(); });

describe("Secao 4 — reuniao qualificada", () => {
  it("paga R$ 50,00 quando os requisitos sao atendidos e registra a origem interna", async () => {
    const id = await novaOportunidade({ tipo: "new_client" });
    await validar(id);
    const result = await db.tx(comercial, (t) =>
      registerQualifiedMeeting(t, comercial, {
        referralId: id,
        heldAt: new Date("2026-09-02T12:00:00Z"),
        requisites: {
          icpFit: true, decisionMaker: true, potentialIdentified: true, commercialValidated: true,
        },
      }));
    expect(result.awarded).toBe(true);
    expect(result.amount).toBe("50.00");
    expect(result.registrationSource).toBe("programa_win");

    const extrato = await db.tx(financeiro, (t) => awardStatement(t, colaboradorId));
    expect(extrato.balance).toBe("50.00");
    expect(extrato.currency).toBe("BRL");
  });

  it("registra a reuniao SEM premiacao quando falta requisito, e diz qual faltou", async () => {
    const id = await novaOportunidade({ tipo: "new_client" });
    await validar(id);
    const result = await db.tx(comercial, (t) =>
      registerQualifiedMeeting(t, comercial, {
        referralId: id,
        heldAt: new Date("2026-09-02T12:00:00Z"),
        requisites: {
          icpFit: true, decisionMaker: false, potentialIdentified: true, commercialValidated: true,
        },
      }));
    expect(result.awarded).toBe(false);
    expect(result.missing).toEqual(["participacao de decisor ou influenciador relevante"]);

    const [ledger] = await db.tx(financeiro, (t) =>
      t.query<{ c: number }>("select count(*)::int c from award_ledger"));
    expect(ledger?.c).toBe(0);
  });

  it("a mesma oportunidade nao gera duas reunioes qualificadas", async () => {
    const id = await novaOportunidade({ tipo: "new_client" });
    await validar(id);
    const requisites = {
      icpFit: true, decisionMaker: true, potentialIdentified: true, commercialValidated: true,
    };
    await db.tx(comercial, (t) =>
      registerQualifiedMeeting(t, comercial, {
        referralId: id, heldAt: new Date("2026-09-02T12:00:00Z"), requisites,
      }));
    await expect(
      db.tx(comercial, (t) =>
        registerQualifiedMeeting(t, comercial, {
          referralId: id, heldAt: new Date("2026-09-03T12:00:00Z"), requisites,
        })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("Anexo I — percentuais sobre a receita liquida recebida", () => {
  it("novo cliente por indicacao paga 3,00% ao colaborador", async () => {
    const id = await novaOportunidade({ tipo: "new_client" });
    await validar(id);
    const result = await db.tx(financeiro, (t) =>
      recordRevenue(t, financeiro, {
        referralId: id, kind: "receipt", netAmount: "10000.00",
        receivedAt: new Date("2026-09-10T12:00:00Z"), competenceDate: "2026-09-10",
      }));
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.amount).toBe("300.00");
    expect(result.entries[0]?.beneficiary).toBe("collaborator");
    expect(result.entries[0]?.situation).toBe("new_client_referral");
  });

  it("novo servico paga 1,50% ao colaborador e 0,50% ao gestor", async () => {
    const id = await novaOportunidade({
      tipo: "new_service", comGestor: true,
    });
    await validar(id);
    const result = await db.tx(financeiro, (t) =>
      recordRevenue(t, financeiro, {
        referralId: id, kind: "receipt", netAmount: "20000.00",
        receivedAt: new Date("2026-09-10T12:00:00Z"), competenceDate: "2026-09-10",
      }));
    const porPapel = Object.fromEntries(result.entries.map((e) => [e.beneficiary, e.amount]));
    expect(porPapel.collaborator).toBe("300.00");  // 1,50%
    expect(porPapel.manager).toBe("100.00");       // 0,50%
  });

  it("novo cliente originado diretamente pelo gestor paga 3,00% AO GESTOR", async () => {
    const id = await novaOportunidade({
      tipo: "new_client", originadaPeloGestor: true,
    });
    await validar(id);
    const result = await db.tx(financeiro, (t) =>
      recordRevenue(t, financeiro, {
        referralId: id, kind: "receipt", netAmount: "50000.00",
        receivedAt: new Date("2026-09-10T12:00:00Z"), competenceDate: "2026-09-10",
      }));
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.beneficiary).toBe("manager");
    expect(result.entries[0]?.amount).toBe("1500.00");
    expect(result.entries[0]?.situation).toBe("new_client_by_manager");
  });

  it("sem gestor vinculado a parcela do gestor simplesmente nao e apurada", async () => {
    const id = await novaOportunidade({ tipo: "cross_sell" });
    await validar(id);
    const result = await db.tx(financeiro, (t) =>
      recordRevenue(t, financeiro, {
        referralId: id, kind: "receipt", netAmount: "1000.00",
        receivedAt: new Date("2026-09-10T12:00:00Z"), competenceDate: "2026-09-10",
      }));
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.beneficiary).toBe("collaborator");
    expect(result.skipped.join(" ")).toContain("gestor");
  });

  it("o mapeamento de situacao segue o Anexo I, nao o tipo isolado", () => {
    expect(situationFor("new_client", false)).toBe("new_client_referral");
    expect(situationFor("new_client", true)).toBe("new_client_by_manager");
    expect(situationFor("up_sell", true)).toBe("new_service_cross_up_sell");
  });
});

describe("Secao 5 — base de calculo e teto de 12 meses", () => {
  it("nao apura percentual sem assinatura e inicio da prestacao registrados", async () => {
    const id = await novaOportunidade({ tipo: "new_client" });
    await db.txAsOwner((t) => t.query(
      `update referral set contract_signed_at = null, service_started_at = null where id = $1`,
      [id],
    ));
    await validar(id);
    await expect(
      db.tx(financeiro, (t) => recordRevenue(t, financeiro, {
        referralId: id, kind: "receipt", netAmount: "1000.00",
        receivedAt: new Date("2026-09-10T12:00:00Z"), competenceDate: "2026-09-10",
      })),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("contrato recorrente nao premia receita recebida apos 12 meses", async () => {
    const id = await novaOportunidade({
      tipo: "new_service", recorrente: true,
      inicioPrestacao: "2026-01-01T12:00:00Z",
    });
    await validar(id);
    const dentro = await db.tx(financeiro, (t) =>
      recordRevenue(t, financeiro, {
        referralId: id, kind: "receipt", netAmount: "1000.00",
        receivedAt: new Date("2026-06-01T12:00:00Z"), competenceDate: "2026-06-01",
      }));
    expect(dentro.entries).toHaveLength(1);

    const fora = await db.tx(financeiro, (t) =>
      recordRevenue(t, financeiro, {
        referralId: id, kind: "receipt", netAmount: "1000.00",
        receivedAt: new Date("2027-06-01T12:00:00Z"), competenceDate: "2027-06-01",
      }));
    expect(fora.entries).toHaveLength(0);
    expect(fora.skipped.join(" ")).toContain("12 meses");
    // A receita continua registrada como fato, mesmo sem gerar premiacao.
    const [eventos] = await db.tx(financeiro, (t) =>
      t.query<{ c: number }>("select count(*)::int c from revenue_event"));
    expect(eventos?.c).toBe(2);
  });

  it("projeto com faturamento unico nao tem teto de janela", () => {
    const semTeto = withinFirstTwelveMonths(
      { contract_billing: "one_off", contract_signed_at: null, service_started_at: null },
      new Date("2030-01-01T00:00:00Z"),
    );
    expect(semTeto.ok).toBe(true);
  });

  it("recorrente sem inicio registrado nao apura: a politica exige a referencia", () => {
    const semReferencia = withinFirstTwelveMonths(
      { contract_billing: "recurring", contract_signed_at: null, service_started_at: null },
      new Date("2026-09-10T00:00:00Z"),
    );
    expect(semReferencia.ok).toBe(false);
  });
});

describe("Secoes 6 e 8 — validacao, estorno e pagamento", () => {
  it("sem validacao da Area Comercial nao se apura nada", async () => {
    const id = await novaOportunidade({ tipo: "new_client" });
    await expect(
      db.tx(financeiro, (t) =>
        recordRevenue(t, financeiro, {
          referralId: id, kind: "receipt", netAmount: "1000.00",
          receivedAt: new Date("2026-09-10T12:00:00Z"), competenceDate: "2026-09-10",
        })),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("recusa de elegibilidade exige motivo e fica registrada", async () => {
    const id = await novaOportunidade({ tipo: "new_client" });
    await expect(
      db.tx(comercial, (t) =>
        validateOpportunity(t, comercial, { referralId: id, decision: "ineligible" })),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    const result = await db.tx(comercial, (t) =>
      validateOpportunity(t, comercial, {
        referralId: id, decision: "ineligible",
        ineligibilityReason: "Oportunidade ja estava em negociacao pela Area Comercial (secao 7).",
      }));
    expect(result.eligibilityStatus).toBe("ineligible");
  });

  it("estorno gera lancamento compensatorio negativo, nunca reescrita", async () => {
    const id = await novaOportunidade({ tipo: "new_client" });
    await validar(id);
    const recebimento = await db.tx(financeiro, (t) =>
      recordRevenue(t, financeiro, {
        referralId: id, kind: "receipt", netAmount: "10000.00",
        receivedAt: new Date("2026-09-10T12:00:00Z"), competenceDate: "2026-09-10",
        sourceReference: "NF-1",
      }));
    const estorno = await db.tx(financeiro, (t) =>
      recordRevenue(t, financeiro, {
        referralId: id, kind: "reversal", netAmount: "10000.00",
        receivedAt: new Date("2026-10-05T12:00:00Z"), competenceDate: "2026-10-05",
        sourceReference: "NF-1-CANCEL",
        reversesEventId: recebimento.revenueEventId,
      }));
    expect(estorno.entries[0]?.amount).toBe("-300.00");

    const repetido = await db.tx(financeiro, (t) =>
      recordRevenue(t, financeiro, {
        referralId: id, kind: "reversal", netAmount: "10000.00",
        receivedAt: new Date("2026-10-05T12:00:00Z"), competenceDate: "2026-10-05",
        sourceReference: "NF-1-CANCEL",
        reversesEventId: recebimento.revenueEventId,
      }));
    expect(repetido.skipped).toContain("IDEMPOTENT_REPLAY");

    const extrato = await db.tx(financeiro, (t) => awardStatement(t, colaboradorId));
    expect(extrato.balance).toBe("0.00");
    expect(extrato.entryCount).toBe(2);   // os dois lancamentos permanecem no historico
  });

  it("registrar a mesma receita duas vezes nao duplica premiacao", async () => {
    const id = await novaOportunidade({ tipo: "new_client" });
    await validar(id);
    const input = {
      referralId: id, kind: "receipt" as const, netAmount: "1000.00",
      receivedAt: new Date("2026-09-10T12:00:00Z"), competenceDate: "2026-09-10",
      sourceReference: "NF-9",
    };
    await db.tx(financeiro, (t) => recordRevenue(t, financeiro, input));
    const repetido = await db.tx(financeiro, (t) => recordRevenue(t, financeiro, input));
    expect(repetido.skipped).toContain("IDEMPOTENT_REPLAY");

    const [ledger] = await db.tx(financeiro, (t) =>
      t.query<{ c: number }>("select count(*)::int c from award_ledger"));
    expect(ledger?.c).toBe(1);
  });

  it("o ledger monetario e append-only", async () => {
    const id = await novaOportunidade({ tipo: "new_client" });
    await validar(id);
    await db.tx(financeiro, (t) =>
      recordRevenue(t, financeiro, {
        referralId: id, kind: "receipt", netAmount: "1000.00",
        receivedAt: new Date("2026-09-10T12:00:00Z"), competenceDate: "2026-09-10",
      }));
    await expect(db.exec("update award_ledger set amount = 1")).rejects.toThrow(
      /APPEND_ONLY_VIOLATION/,
    );
    await expect(db.exec("delete from award_ledger")).rejects.toThrow(/APPEND_ONLY_VIOLATION/);
  });

  it("so a Diretoria aprova o lote de pagamento (secao 8)", async () => {
    const referralId = await novaOportunidade({ tipo: "new_client" });
    await validar(referralId);
    await db.tx(financeiro, (t) =>
      recordRevenue(t, financeiro, {
        referralId, kind: "receipt", netAmount: "1000.00",
        receivedAt: new Date("2026-09-10T12:00:00Z"), competenceDate: "2026-09-10",
      }));
    const [batch] = await db.tx(diretoria, (t) =>
      t.query<{ id: string }>(
        `insert into payout_batch
           (label, payroll_reference, competence_from, competence_to, created_by, created_by_label)
         values ('folha-2026-09', '2026-09', '2026-09-01', '2026-09-30', $1, $2)
         returning id`,
        [diretoria.identityId, diretoria.label],
      ));
    await db.tx(diretoria, (t) =>
      t.query(
        `insert into payout_item (batch_id, award_entry_id)
         select $1, id from award_ledger where referral_id = $2`,
        [batch!.id, referralId],
      ));

    await expect(
      db.tx(comercial, (t) => approvePayoutBatch(t, comercial, batch!.id)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const aprovado = await db.tx(diretoria, (t) =>
      approvePayoutBatch(t, diretoria, batch!.id));
    expect(aprovado.status).toBe("approved");
  });

  it("nem a Diretoria aprova lote vazio ou sem saldo positivo", async () => {
    const [batch] = await db.tx(diretoria, (t) =>
      t.query<{ id: string }>(
        `insert into payout_batch
           (label, payroll_reference, competence_from, competence_to, created_by, created_by_label)
         values ('folha-vazia-2026-09', '2026-09', '2026-09-01', '2026-09-30', $1, $2)
         returning id`,
        [diretoria.identityId, diretoria.label],
      ));
    await expect(
      db.tx(diretoria, (t) => approvePayoutBatch(t, diretoria, batch!.id)),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("Correcoes de revisao — estorno, competencia e titularidade", () => {
  it("estorno sem apontar o recebimento revertido e recusado", async () => {
    const id = await novaOportunidade({ tipo: "new_client" });
    await validar(id);
    await db.tx(financeiro, (t) =>
      recordRevenue(t, financeiro, {
        referralId: id, kind: "receipt", netAmount: "1000.00",
        receivedAt: new Date("2026-09-10T12:00:00Z"), competenceDate: "2026-09-10",
      }));
    await expect(
      db.tx(financeiro, (t) =>
        recordRevenue(t, financeiro, {
          referralId: id, kind: "reversal", netAmount: "1000.00",
          receivedAt: new Date("2026-10-10T12:00:00Z"), competenceDate: "2026-10-10",
        })),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("estorno nao pode ultrapassar o total recebido, mesmo variando data e referencia", async () => {
    const id = await novaOportunidade({ tipo: "new_client" });
    await validar(id);
    const recebimento = await db.tx(financeiro, (t) =>
      recordRevenue(t, financeiro, {
        referralId: id, kind: "receipt", netAmount: "1000.00",
        receivedAt: new Date("2026-09-10T12:00:00Z"), competenceDate: "2026-09-10",
        sourceReference: "NF-A",
      }));

    const primeiro = await db.tx(financeiro, (t) =>
      recordRevenue(t, financeiro, {
        referralId: id, kind: "reversal", netAmount: "400.00",
        receivedAt: new Date("2026-10-01T12:00:00Z"), competenceDate: "2026-10-01",
        sourceReference: "CANC-1", reversesEventId: recebimento.revenueEventId,
      }));
    expect(primeiro.entries[0]?.amount).toBe("-12.00");

    const segundo = await db.tx(financeiro, (t) =>
      recordRevenue(t, financeiro, {
        referralId: id, kind: "reversal", netAmount: "600.00",
        receivedAt: new Date("2026-10-02T12:00:00Z"), competenceDate: "2026-10-02",
        sourceReference: "CANC-2", reversesEventId: recebimento.revenueEventId,
      }));
    expect(segundo.entries[0]?.amount).toBe("-18.00");

    // Depois do estorno integral, o recebimento nao possui saldo disponivel.
    await expect(
      db.tx(financeiro, (t) =>
        recordRevenue(t, financeiro, {
          referralId: id, kind: "reversal", netAmount: "1.00",
          receivedAt: new Date("2026-10-03T12:00:00Z"), competenceDate: "2026-10-03",
          sourceReference: "CANC-3", reversesEventId: recebimento.revenueEventId,
        })),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    // O saldo nao pode ficar negativo por empilhamento de estornos.
    const extrato = await db.tx(financeiro, (t) => awardStatement(t, colaboradorId));
    expect(Number(extrato.balance)).toBe(0);
  });

  it("lote de pagamento respeita a competencia e nao nasce vazio", async () => {
    const id = await novaOportunidade({ tipo: "new_client" });
    await validar(id);
    await db.tx(financeiro, (t) =>
      recordRevenue(t, financeiro, {
        referralId: id, kind: "receipt", netAmount: "1000.00",
        receivedAt: new Date("2026-09-10T12:00:00Z"), competenceDate: "2026-09-10",
      }));

    const naCompetencia = await db.tx(financeiro, (t) =>
      t.query<{ c: number }>(
        `select count(*)::int c from award_ledger
          where effective_at >= '2026-09-01' and effective_at < '2026-10-01'`));
    expect(naCompetencia[0]?.c).toBe(1);

    const foraDaCompetencia = await db.tx(financeiro, (t) =>
      t.query<{ c: number }>(
        `select count(*)::int c from award_ledger
          where effective_at >= '2026-10-01' and effective_at < '2026-11-01'`));
    expect(foraDaCompetencia[0]?.c).toBe(0);
  });
});
