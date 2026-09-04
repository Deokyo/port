import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { createDb, type Db, type ActorContext } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { seedAll } from "../../src/db/seed";
import { approveRule, buildCsv } from "../helpers/app";
import { confirmImport, createImportJob, previewImport } from "../../src/import/pipeline";

let db: Db;
let admin: ActorContext;

const HEADER = ["MATRICULA", "NOME", "EMPRESA", "PRODUTO", "STATUS", "DATA", "PONTOS", "REFERENCIA"];

function csvFile(rows: string[][]): Buffer {
  return buildCsv([HEADER, ...rows]);
}

const validRows = [
  ["WIN-0001", "Ana Exemplo", "Empresa Alfa (ficticia)", "Fiscal", "Venda realizada", "2026-08-10", "9999", "REF-001"],
  ["WIN-0002", "Bruno Ficticio", "Empresa Beta (ficticia)", "Auditoria", "Proposta enviada", "2026-08-11", "-500", "REF-002"],
];

beforeEach(async () => {
  db = await createDb({ pgliteMemory: true });
  await runMigrations(db);
  await seedAll(db, { synthetic: true });
  const [identity] = await db.txAsOwner((t) =>
    t.query<{ id: string }>(
      `insert into auth_identity (issuer, subject, email) values ('urn:test','admin-import',null)
       returning id`,
    ));
  admin = {
    identityId: identity!.id, staffId: null, roles: ["administrador"], label: "Admin de Teste",
  };
});
afterEach(async () => { await db.close(); });

describe("Fase 5 — pipeline de importacao", () => {
  it("faz staging sem aplicar nada e IGNORA a coluna PONTOS (ALTO-02)", async () => {
    const job = await createImportJob(db, admin, {
      filename: "ciclo.csv", buffer: csvFile(validRows), referenceDate: "2026-08-31",
    });
    expect(job.status).toBe("awaiting_confirmation");
    expect(job.validRows).toBe(2);
    expect(job.createdByLabel).toBe("Admin de Teste");   // ALTO-01: autoria da sessao
    expect(String(job.summary.warnings)).toContain("PONTOS");

    const [counts] = await db.txAsOwner((t) =>
      t.query<{ referrals: number; ledger: number }>(
        `select (select count(*) from referral where source = 'import')::int referrals,
                (select count(*) from points_ledger)::int ledger`));
    expect(counts).toEqual({ referrals: 0, ledger: 0 });
  });

  it("ALTO-04: reenviar o mesmo arquivo devolve o mesmo job (idempotencia)", async () => {
    const buffer = csvFile(validRows);
    const first = await createImportJob(db, admin, {
      filename: "ciclo.csv", buffer, referenceDate: "2026-08-31",
    });
    const second = await createImportJob(db, admin, {
      filename: "ciclo.csv", buffer, referenceDate: "2026-08-31",
    });
    expect(second.id).toBe(first.id);
    expect(second.replay).toBe(true);
    const [jobs] = await db.tx(admin, (t) =>
      t.query<{ c: number }>("select count(*)::int c from import_job"));
    expect(jobs!.c).toBe(1);
  });

  it("classifica erro por linha sem vazar conteudo da planilha", async () => {
    const job = await createImportJob(db, admin, {
      filename: "erros.csv",
      buffer: csvFile([
        ["WIN-9999", "Fantasma", "Empresa X", "Fiscal", "Venda realizada", "2026-08-10", ""],
        ["WIN-0001", "Ana", "Empresa Alfa", "Servico Inexistente", "Venda realizada", "2026-08-10", ""],
        ["WIN-0001", "Ana", "Empresa Alfa", "Fiscal", "Etapa Inventada", "2026-08-10", ""],
        ["WIN-0001", "Ana", "Empresa Alfa", "Fiscal", "Venda realizada", "10-08-2026", ""],
        ["", "Sem matricula", "Empresa Alfa", "Fiscal", "Venda realizada", "2026-08-10", ""],
      ]),
      referenceDate: "2026-08-31",
    });
    expect(job.validRows).toBe(0);
    expect(job.invalidRows).toBe(5);
    expect(job.status).toBe("rejected");

    const preview = await previewImport(db, admin, job.id);
    const codes = preview.errors.map((e) => e.error_code).sort();
    expect(codes).toEqual([
      "INVALID_DATE_UNRECOGNIZED_FORMAT", "MISSING_STAFF_CODE",
      "UNKNOWN_SERVICE", "UNKNOWN_STAFF", "UNKNOWN_STATUS",
    ]);
    // A amostra devolve numero da linha e codigo — nunca o dado da planilha.
    const sampleKeys = new Set(preview.sampleRows.flatMap((r) => Object.keys(r)));
    expect([...sampleKeys].sort()).toEqual(["error_code", "error_field", "row_number"]);
    expect(JSON.stringify(preview)).not.toContain("Empresa Alfa");
  });

  it("recusa cabecalho sem as colunas obrigatorias", async () => {
    await expect(createImportJob(db, admin, {
      filename: "ruim.csv",
      buffer: buildCsv([["NOME", "PONTOS"], ["Ana", "10"]]),
      referenceDate: "2026-08-31",
    })).rejects.toThrow(/Colunas obrigatorias ausentes/);
  });

  it("recusa arquivo cuja extensao nao bate com o conteudo", async () => {
    await expect(createImportJob(db, admin, {
      filename: "falso.xlsx", buffer: csvFile(validRows), referenceDate: "2026-08-31",
    })).rejects.toThrow(/nao e um ZIP\/XLSX/);
  });

  it("ALTO-05: sem regra de titularidade aprovada a confirmacao continua bloqueada", async () => {
    // A politica assinada aprovou RULE_DUPLICATE_KEY v2. Este teste remove a aprovacao para
    // provar que a trava continua existindo se a regra for revogada ou revisada.
    await db.txAsOwner((t) =>
      t.query(`update business_rule set status = 'proposed', approver_name = null,
                      approved_at = null, effective_from = null
                where rule_key = 'RULE_DUPLICATE_KEY'`));

    const job = await createImportJob(db, admin, {
      filename: "ciclo.csv", buffer: csvFile(validRows), referenceDate: "2026-08-31",
    });
    const preview = await previewImport(db, admin, job.id);
    expect(preview.canConfirm).toBe(false);
    expect(preview.blockedBy).toEqual(["RULE_DUPLICATE_KEY"]);

    await expect(confirmImport(db, admin, job.id, { attested: true })).rejects.toMatchObject({
      code: "PENDING_BUSINESS_RULE",
      status: 422,
    });
    const [after] = await db.tx(admin, (t) =>
      t.query<{ c: number }>("select count(*)::int c from referral where source = 'import'"));
    expect(after!.c).toBe(0);

    const [denial] = await db.tx(admin, (t) =>
      t.query<{ reason_code: string }>(
        `select reason_code from audit_event where action = 'import.confirm' and outcome = 'denied'`));
    expect(denial!.reason_code).toBe("RULE_DUPLICATE_KEY_PENDING");
  });

  it("consolida transacionalmente e pontua pela tabela aprovada, nunca pela planilha", async () => {
    const job = await createImportJob(db, admin, {
      filename: "ciclo.csv", buffer: csvFile(validRows), referenceDate: "2026-08-31",
    });
    const result = await confirmImport(db, admin, job.id, { attested: true });
    expect(result.status).toBe("completed");
    expect(result.created).toBe(2);
    expect(result.ledgerEntries).toBe(2);

    const [counts] = await db.tx(admin, (t) =>
      t.query<{ referrals: number; events: number; pontos: number }>(
        `select (select count(*) from referral where source = 'import')::int referrals,
                (select count(*) from referral_stage_event where actor_label = 'Admin de Teste')::int events,
                (select coalesce(sum(amount), 0) from points_ledger)::int pontos`));
    // 'Venda realizada' = 100 e 'Proposta enviada' = 50. A planilha trazia 9999 e -500: ignorados.
    expect(counts).toEqual({ referrals: 2, events: 2, pontos: 150 });
  });

  it("com pontuacao aprovada, o servidor deriva os pontos — nunca o valor da planilha", async () => {
    await approveRule(db, "RULE_DUPLICATE_KEY");
    await approveRule(db, "RULE_POINTS_ACCRUAL");
    const job = await createImportJob(db, admin, {
      filename: "ciclo.csv", buffer: csvFile(validRows), referenceDate: "2026-08-31",
    });
    const result = await confirmImport(db, admin, job.id, { attested: true });
    expect(result.ledgerEntries).toBe(2);
    const rows = await db.tx(admin, (t) =>
      t.query<{ amount: number; stage: string }>(
        `select amount, stage from points_ledger order by amount desc`));
    // 100 para venda realizada, 50 para proposta enviada — a planilha pedia 9999 e -500.
    expect(rows.map((r) => r.amount).sort((a, b) => b - a)).toEqual([100, 50]);
  });

  it("confirmar duas vezes gera conflito, nao duplicacao", async () => {
    await approveRule(db, "RULE_DUPLICATE_KEY");
    const job = await createImportJob(db, admin, {
      filename: "ciclo.csv", buffer: csvFile(validRows), referenceDate: "2026-08-31",
    });
    await confirmImport(db, admin, job.id, { attested: true });
    await expect(confirmImport(db, admin, job.id, { attested: true })).rejects.toMatchObject({ status: 409 });
    const [counts] = await db.tx(admin, (t) =>
      t.query<{ c: number }>("select count(*)::int c from referral where source = 'import'"));
    expect(counts!.c).toBe(2);
  });

  it("duas confirmacoes concorrentes: uma vence, a outra falha, nada duplica", async () => {
    await approveRule(db, "RULE_DUPLICATE_KEY");
    const job = await createImportJob(db, admin, {
      filename: "ciclo.csv", buffer: csvFile(validRows), referenceDate: "2026-08-31",
    });
    const results = await Promise.allSettled([
      confirmImport(db, admin, job.id, { attested: true }),
      confirmImport(db, admin, job.id, { attested: true }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const [counts] = await db.tx(admin, (t) =>
      t.query<{ c: number }>("select count(*)::int c from referral where source = 'import'"));
    expect(counts!.c).toBe(2);
  });

  it("a referencia nao substitui a chave aprovada de empresa e servico", async () => {
    const job = await createImportJob(db, admin, {
      filename: "referencias.csv",
      buffer: csvFile([
        ["WIN-0001", "Ana", "Empresa Alfa (ficticia)", "Fiscal", "Venda realizada", "2026-08-10", "", "REF-777"],
        ["WIN-0002", "Bruno", "Empresa Beta (ficticia)", "Fiscal", "Venda realizada", "2026-08-12", "", "REF-777"],
      ]),
      referenceDate: "2026-08-31",
    });
    expect(job.validRows).toBe(2);
    expect(job.duplicateRows).toBe(0);

    const result = await confirmImport(db, admin, job.id, { attested: true });
    expect(result.created).toBe(2);
    const referencias = await db.tx(admin, (t) =>
      t.query<{ client_reference: string }>(
        `select client_reference from referral where source = 'import' order by client_reference`));
    expect(referencias.map((row) => row.client_reference)).toEqual(["REF-777", "REF-777"]);
  });

  it("D-28: no piloto, a titularidade e por empresa cliente + servico", async () => {
    const job = await createImportJob(db, admin, {
      filename: "sem-crm.csv",
      buffer: csvFile([
        ["WIN-0001", "Ana", "Empresa Alfa (ficticia)", "Fiscal", "Venda realizada", "2026-08-10", "", ""],
        // Mesmo cliente e mesmo servico, outro colaborador: quem registrou primeiro leva.
        ["WIN-0002", "Bruno", "  empresa   ALFA (ficticia) ", "Fiscal", "Venda realizada", "2026-08-12", "", ""],
        // Servico diferente: oportunidade distinta.
        ["WIN-0002", "Bruno", "Empresa Alfa (ficticia)", "Auditoria", "Venda realizada", "2026-08-12", "", ""],
      ]),
      referenceDate: "2026-08-31",
    });
    expect(job.validRows).toBe(2);
    expect(job.duplicateRows).toBe(1);
    const result = await confirmImport(db, admin, job.id, { attested: true });
    expect(result.titularityConflicts).toBe(1);
    const [conflict] = await db.tx(admin, (t) => t.query<{
      decision: string; import_row_id: string; referral_id: string;
    }>(`select decision, import_row_id, referral_id from duplicate_check`));
    expect(conflict).toMatchObject({ decision: "pending" });
    expect(conflict?.import_row_id).toBeTruthy();
    expect(conflict?.referral_id).toBeTruthy();
  });
});

describe("D-27 — planilha com conferencia manual atestada", () => {
  it("sem atestacao a confirmacao e RECUSADA: a regra operacional a exige", async () => {
    const job = await createImportJob(db, admin, {
      filename: "ciclo.csv", buffer: csvFile(validRows), referenceDate: "2026-08-31",
    });
    await expect(confirmImport(db, admin, job.id)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });

    // Nada foi consolidado e nada foi pontuado.
    const [depois] = await db.tx(admin, (t) =>
      t.query<{ indicacoes: number; pontos: number }>(
        `select (select count(*) from referral where source = 'import')::int indicacoes,
                (select count(*) from points_ledger)::int pontos`));
    expect(depois).toEqual({ indicacoes: 0, pontos: 0 });

    // A recusa fica na trilha, com o motivo.
    const [negacao] = await db.tx(admin, (t) =>
      t.query<{ reason_code: string }>(
        `select reason_code from audit_event
          where action = 'import.confirm' and outcome = 'denied'`));
    expect(negacao?.reason_code).toBe("CONFERENCE_NOT_ATTESTED");
  });

  it("com atestacao, registra a conferencia sem substituir a validacao comercial", async () => {
    const job = await createImportJob(db, admin, {
      filename: "ciclo.csv", buffer: csvFile(validRows), referenceDate: "2026-08-31",
    });
    const result = await confirmImport(db, admin, job.id, {
      attested: true, note: "Conferencia manual registrada em 03/09.",
    });
    expect(result.conference.attested).toBe(true);
    expect(result.conference.conferred).toBe(2);
    expect(result.conference.stillPending).toBe(2);

    const elegiveis = await db.tx(admin, (t) =>
      t.query<{ validated_by: string; eligibility_status: string }>(
        `select validated_by, eligibility_status from referral where source = 'import'`));
    expect(elegiveis).toHaveLength(2);
    for (const linha of elegiveis) {
      expect(linha.eligibility_status).toBe("pending_validation");
      expect(linha.validated_by).toBeNull();
    }

    const [trilha] = await db.tx(admin, (t) =>
      t.query<{ actor_label: string; metadata: Record<string, unknown> }>(
        `select actor_label, metadata from audit_event
          where action = 'import.conference.attested'`));
    expect(trilha?.actor_label).toBe("Admin de Teste");
    expect(trilha?.metadata.conferred).toBe(2);
    expect(trilha?.metadata.pendingCommercialValidation).toBe(2);
  });

  it("D-28: no piloto por planilha a atestacao cobre todas as linhas", async () => {
    const job = await createImportJob(db, admin, {
      filename: "misto.csv",
      buffer: csvFile([
        ["WIN-0001", "Ana", "Empresa Alfa (ficticia)", "Fiscal", "Venda realizada", "2026-08-10", "", "REF-500"],
        ["WIN-0002", "Bruno", "Empresa Beta (ficticia)", "Auditoria", "Proposta enviada", "2026-08-11", "", ""],
      ]),
      referenceDate: "2026-08-31",
    });
    const result = await confirmImport(db, admin, job.id, { attested: true });
    // A evidencia operacional e a atestacao da conferencia manual.
    expect(result.conference.conferred).toBe(2);
    expect(result.conference.stillPending).toBe(2);
  });
});

describe("D-03 / D-28 — pontos cumulativos com planilha por ciclo", () => {
  it("a etapa informada pontua conforme a tabela aprovada", async () => {
    const job = await createImportJob(db, admin, {
      filename: "ciclo1.csv",
      buffer: csvFile([
        ["WIN-0001", "Ana", "Empresa Alfa (ficticia)", "Fiscal", "Reuniao agendada", "2026-08-10", "", ""],
      ]),
      referenceDate: "2026-08-31",
    });
    const result = await confirmImport(db, admin, job.id, { attested: true });
    expect(result.created).toBe(1);

    const [saldo] = await db.tx(admin, (t) =>
      t.query<{ total: number }>(
        `select coalesce(sum(amount), 0)::int total from points_ledger`));
    expect(saldo?.total).toBe(20);   // 'Reuniao agendada' = 20 pontos
  });

  it("a planilha do ciclo seguinte PROGRIDE a mesma oportunidade e soma os pontos", async () => {
    await confirmImport(db, admin, (await createImportJob(db, admin, {
      filename: "ciclo1.csv",
      buffer: csvFile([
        ["WIN-0001", "Ana", "Empresa Alfa (ficticia)", "Fiscal", "Reuniao agendada", "2026-08-10", "", ""],
      ]),
      referenceDate: "2026-08-31",
    })).id, { attested: true });

    // Mesmo colaborador, mesma empresa e servico, etapa mais avancada: e a MESMA oportunidade.
    const ciclo2 = await createImportJob(db, admin, {
      filename: "ciclo2.csv",
      buffer: csvFile([
        ["WIN-0001", "Ana", "Empresa Alfa (ficticia)", "Fiscal", "Venda realizada", "2026-09-10", "", ""],
      ]),
      referenceDate: "2026-09-30",
    });
    const result = await confirmImport(db, admin, ciclo2.id, { attested: true });
    expect(result.created).toBe(0);
    expect(result.progressed).toBe(1);

    // Cumulativo: 20 (reuniao agendada) + 100 (venda realizada) = 120.
    const [saldo] = await db.tx(admin, (t) =>
      t.query<{ total: number }>(
        `select coalesce(sum(amount), 0)::int total from points_ledger`));
    expect(saldo?.total).toBe(120);

    // Uma unica indicacao, com o historico completo das duas etapas.
    const [indicacoes] = await db.tx(admin, (t) =>
      t.query<{ c: number }>("select count(*)::int c from referral where source = 'import'"));
    expect(indicacoes?.c).toBe(1);
    const [eventos] = await db.tx(admin, (t) =>
      t.query<{ c: number }>(
        `select count(*)::int c from referral_stage_event e
           join referral r on r.id = e.referral_id where r.source = 'import'`));
    expect(eventos?.c).toBe(2);
  });

  it("reenviar o mesmo ciclo nao pontua de novo", async () => {
    const linhas = [
      ["WIN-0001", "Ana", "Empresa Alfa (ficticia)", "Fiscal", "Venda realizada", "2026-08-10", "", ""],
    ];
    await confirmImport(db, admin, (await createImportJob(db, admin, {
      filename: "c1.csv", buffer: csvFile(linhas), referenceDate: "2026-08-31",
    })).id, { attested: true });

    // Mesmo conteudo, arquivo com outro nome e outra data: toda linha ja existe e nao avancou.
    const repetido = await createImportJob(db, admin, {
      filename: "c1-reenvio.csv", buffer: csvFile(linhas), referenceDate: "2026-09-30",
    });
    expect(repetido.duplicateRows).toBe(1);
    expect(repetido.validRows).toBe(0);
    expect(repetido.status).toBe("rejected");
    // Sem linha valida nao ha o que confirmar — e o job nem chega a alterar a base.
    await expect(confirmImport(db, admin, repetido.id, { attested: true })).rejects.toMatchObject({
      code: "CONFLICT",
    });

    const [saldo] = await db.tx(admin, (t) =>
      t.query<{ total: number }>(
        `select coalesce(sum(amount), 0)::int total from points_ledger`));
    expect(saldo?.total).toBe(100);
  });

  it("etapa anterior a atual nao retrocede a oportunidade nem pontua", async () => {
    await confirmImport(db, admin, (await createImportJob(db, admin, {
      filename: "a.csv",
      buffer: csvFile([
        ["WIN-0001", "Ana", "Empresa Alfa (ficticia)", "Fiscal", "Venda realizada", "2026-08-10", "", ""],
      ]),
      referenceDate: "2026-08-31",
    })).id, { attested: true });

    const volta = await createImportJob(db, admin, {
      filename: "b.csv",
      buffer: csvFile([
        ["WIN-0001", "Ana", "Empresa Alfa (ficticia)", "Fiscal", "Reuniao agendada", "2026-09-10", "", ""],
      ]),
      referenceDate: "2026-09-30",
    });
    expect(volta.status).toBe("rejected");   // retrocesso nao gera linha valida

    const [etapa] = await db.tx(admin, (t) =>
      t.query<{ current_stage: string }>(
        "select current_stage from referral where source = 'import'"));
    expect(etapa?.current_stage).toBe("sale_won");
  });

  it("outro colaborador na mesma empresa e servico vira conflito, nao progressao", async () => {
    await confirmImport(db, admin, (await createImportJob(db, admin, {
      filename: "x.csv",
      buffer: csvFile([
        ["WIN-0001", "Ana", "Empresa Alfa (ficticia)", "Fiscal", "Reuniao agendada", "2026-08-10", "", ""],
      ]),
      referenceDate: "2026-08-31",
    })).id, { attested: true });

    const outro = await createImportJob(db, admin, {
      filename: "y.csv",
      buffer: csvFile([
        ["WIN-0002", "Bruno", "Empresa Alfa (ficticia)", "Fiscal", "Venda realizada", "2026-09-10", "", ""],
      ]),
      referenceDate: "2026-09-30",
    });
    expect(outro.duplicateRows).toBe(1);
    expect(outro.validRows).toBe(0);
  });
});
