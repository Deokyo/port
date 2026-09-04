import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, type Db, type ActorContext } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { seedAll } from "../../src/db/seed";
import { readXlsx } from "../../src/import/xlsx";
import { confirmImport, createImportJob } from "../../src/import/pipeline";
import { stageFromSheetLabel } from "../../src/domain/referral-stages";
import { normalizeKey } from "../../src/lib/text";

/**
 * Testes contra o GABARITO OFICIAL entregue pela Locatelli
 * (BASE_IMPORTACAO_WIN_MELHORADA.xlsx, aba IMPORTAR_ADMIN).
 *
 * Existe porque o leitor endurecido reprovou o arquivo real na primeira tentativa: o gabarito
 * usa prefixo de namespace (<x:sheet>, <x:row>), que as regex originais nao reconheciam. Um
 * parser que so aceita o dialeto do Excel nao serve para arquivo gerado por biblioteca.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const OFICIAL = readFileSync(join(HERE, "../fixtures/base-importacao-win.xlsx"));

let db: Db;
let admin: ActorContext;

beforeEach(async () => {
  db = await createDb({ pgliteMemory: true });
  await runMigrations(db);
  await seedAll(db, { synthetic: true });
  const [identity] = await db.txAsOwner((t) =>
    t.query<{ id: string }>(
      `insert into auth_identity (issuer, subject) values ('urn:test','admin-oficial') returning id`,
    ));
  admin = { identityId: identity!.id, staffId: null, roles: ["administrador"], label: "Admin" };
});
afterEach(async () => { await db.close(); });

describe("Gabarito oficial da Locatelli", () => {
  it("o modelo baixado no painel e exatamente o fixture validado", () => {
    const download = readFileSync(join(HERE, "../../web/assets/BASE_IMPORTACAO_WIN.xlsx"));
    expect(download.equals(OFICIAL)).toBe(true);
  });

  it("le o arquivo real, com prefixo de namespace OOXML", () => {
    const read = readXlsx(OFICIAL, { maxUncompressedBytes: 50_000_000, maxRows: 20_000 });
    expect(read.sheetName).toBe("IMPORTAR_ADMIN");
    expect(read.availableSheets).toEqual(["IMPORTAR_ADMIN", "RESUMO", "GUIA", "LISTAS"]);
    // Quatro abas, mas a escolha nao foi chute: veio da convencao do gabarito.
    expect(read.selectionMethod).toBe("convention");
  });

  it("o cabecalho oficial e integralmente reconhecido pelo pipeline", async () => {
    const read = readXlsx(OFICIAL, { maxUncompressedBytes: 50_000_000, maxRows: 20_000 });
    expect(read.rows[0]).toEqual([
      "MATRICULA", "NOME", "EMPRESA", "PRODUTO", "TIPO", "GESTOR", "STATUS", "DATA",
      "REFERENCIA", "PONTOS",
    ]);

    // Enviado ao pipeline, nenhuma coluna obrigatoria falta e nenhuma fica "desconhecida".
    const job = await createImportJob(db, admin, {
      filename: "BASE_IMPORTACAO_WIN.xlsx", buffer: OFICIAL, referenceDate: "2026-09-30",
    });
    const warnings = (job.summary.warnings ?? []) as string[];
    expect(warnings.join(" ")).not.toContain("Colunas desconhecidas");
    expect(warnings.join(" ")).toContain("PONTOS");        // ignorada, como manda o GUIA
    expect(warnings.join(" ")).toContain("por convencao");
    // Gabarito vem vazio: 200 linhas em branco nao viram linha invalida.
    expect(job.totalRows).toBe(0);
    expect(job.status).toBe("rejected");
  });

  it("os STATUS da aba LISTAS batem com as etapas do dominio", () => {
    const listas = readXlsx(OFICIAL, {
      maxUncompressedBytes: 50_000_000, maxRows: 5000, sheetName: "LISTAS",
    }).rows;
    const statusDaPlanilha = listas
      .map((linha) => String(linha[0] ?? "").trim())
      .filter((v) => v && v !== "STATUS" && !v.startsWith("LISTAS"));

    expect(statusDaPlanilha).toEqual([
      "Oportunidade identificada", "Reunião agendada", "Reunião realizada",
      "Proposta enviada", "Venda realizada", "Perdida",
    ]);
    // Acentuacao inclusa: nenhum rotulo do gabarito pode cair como etapa desconhecida.
    for (const rotulo of statusDaPlanilha) {
      expect(stageFromSheetLabel(rotulo), `status sem mapeamento: ${rotulo}`).not.toBeNull();
    }
  });

  it("os PONTOS da aba LISTAS batem com a tabela aprovada no banco", async () => {
    const listas = readXlsx(OFICIAL, {
      maxUncompressedBytes: 50_000_000, maxRows: 5000, sheetName: "LISTAS",
    }).rows;
    const daPlanilha = new Map<string, number>();
    for (const linha of listas) {
      const rotulo = String(linha[0] ?? "").trim();
      const stage = rotulo ? stageFromSheetLabel(rotulo) : null;
      if (stage && typeof linha[1] === "number") daPlanilha.set(stage, linha[1]);
    }

    const doBanco = await db.txAsOwner((t) =>
      t.query<{ stage: string; points: number }>(
        `select p.stage::text, p.points from points_rule p
           join business_rule b on b.rule_key = p.rule_key and b.version = p.rule_version
          where b.rule_key = 'RULE_POINTS_ACCRUAL' and b.status = 'approved'`));

    expect(doBanco.length).toBeGreaterThan(0);
    for (const linha of doBanco) {
      // A planilha e apenas previa; o banco e a autoridade. Divergir aqui e erro de gabarito.
      expect(daPlanilha.get(linha.stage), `divergencia na etapa ${linha.stage}`)
        .toBe(linha.points);
    }
  });

  it("os PRODUTOS da aba LISTAS existem no catalogo, com acento e '&'", async () => {
    const listas = readXlsx(OFICIAL, {
      maxUncompressedBytes: 50_000_000, maxRows: 5000, sheetName: "LISTAS",
    }).rows;
    const produtos = listas
      .map((linha) => String(linha[4] ?? "").trim())
      .filter((v) => v && v !== "PRODUTO");
    expect(produtos).toContain("Contábil");
    expect(produtos).toContain("Tributária");
    expect(produtos).toContain("M&A");
    expect(produtos).toContain("Representação Legal");

    const aliases = await db.txAsOwner((t) =>
      t.query<{ alias_key: string }>(`select alias_key from service_alias`));
    const conhecidos = new Set(aliases.map((a) => a.alias_key));
    for (const produto of produtos) {
      expect(conhecidos.has(normalizeKey(produto)), `produto sem alias: ${produto}`).toBe(true);
    }
  });

  it("uma linha preenchida no formato oficial atravessa o pipeline inteiro", async () => {
    // Mesmo cabecalho do gabarito, com acentuacao e rotulos exatamente como a LISTAS manda.
    const linhas = [
      ["MATRICULA", "NOME", "EMPRESA", "PRODUTO", "TIPO", "GESTOR", "STATUS", "DATA", "REFERENCIA", "PONTOS"],
      ["WIN-0001", "Ana Exemplo", "Empresa Alfa (ficticia)", "Contábil", "Novo cliente",
       "WIN-0007", "Reunião agendada", "2026-09-10", "12.345.678/0001-90", "9999"],
      ["WIN-0002", "Bruno Ficticio", "Empresa Beta (ficticia)", "Representação Legal", "Cross-sell",
       "", "Venda realizada", "2026-09-11", "", ""],
    ];
    const csv = Buffer.from(
      "\uFEFF" + linhas.map((l) => l.map((c) => `"${c}"`).join(";")).join("\r\n"), "utf8");

    const job = await createImportJob(db, admin, {
      filename: "ciclo-oficial.csv", buffer: csv, referenceDate: "2026-09-30",
    });
    expect(job.invalidRows).toBe(0);
    expect(job.validRows).toBe(2);

    const linhasStaged = await db.tx(admin, (t) =>
      t.query<{ stage: string; opportunity_type: string; service: string }>(
        `select ir.stage::text, (ir.raw->>'opportunityType') opportunity_type, s.slug service
           from import_row ir join service s on s.id = ir.service_id
          order by ir.row_number`));
    // Acento, "&", barra do CNPJ e rotulo com maiuscula/minuscula: tudo resolvido no servidor.
    expect(linhasStaged[0]).toMatchObject({
      stage: "meeting_scheduled", opportunity_type: "new_client", service: "contabil",
    });
    expect(linhasStaged[1]).toMatchObject({
      stage: "sale_won", opportunity_type: "cross_sell", service: "representacao-legal",
    });
  });

  it("os TIPOS da aba LISTAS batem com o enum do banco", async () => {
    const listas = readXlsx(OFICIAL, {
      maxUncompressedBytes: 50_000_000, maxRows: 5000, sheetName: "LISTAS",
    }).rows;
    const codigos = listas
      .map((linha) => String(linha[6] ?? "").trim())
      .filter((v) => v && v !== "CÓDIGO INTERNO");
    expect(codigos).toEqual(["new_client", "new_service", "cross_sell", "up_sell"]);

    const doBanco = await db.txAsOwner((t) =>
      t.query<{ valor: string }>(
        `select unnest(enum_range(null::opportunity_type))::text as valor`));
    expect(doBanco.map((r) => r.valor).sort()).toEqual([...codigos].sort());
  });

  it("o GUIA descreve o fluxo vigente sem depender de sistema externo", () => {
    const guia = readXlsx(OFICIAL, {
      maxUncompressedBytes: 50_000_000, maxRows: 5000, sheetName: "GUIA",
    }).rows.flat().join(" ");
    expect(guia).not.toMatch(/ploomes|\bcrm\b/i);
    expect(guia).toContain("Planilha validada no servidor");
    expect(guia).toContain("conferência manual atestada");
  });
});

describe("TIPO e GESTOR preenchidos errado invalidam a linha", () => {
  const cabecalho = ["MATRICULA", "NOME", "EMPRESA", "PRODUTO", "TIPO", "GESTOR", "STATUS", "DATA"];
  const csv = (linhas: string[][]) =>
    Buffer.from(
      "\uFEFF" + [cabecalho, ...linhas].map((l) => l.map((c) => `"${c}"`).join(";")).join("\r\n"),
      "utf8",
    );

  async function erroDaLinha(linha: string[]) {
    const job = await createImportJob(db, admin, {
      filename: "t.csv", buffer: csv([linha]), referenceDate: "2026-09-30",
    });
    const [row] = await db.tx(admin, (t) =>
      t.query<{ status: string; error_code: string; error_field: string }>(
        `select status, error_code, error_field from import_row`));
    return { job, row };
  }

  it("TIPO preenchido com valor fora da lista invalida, em vez de virar null", async () => {
    const { job, row } = await erroDaLinha([
      "WIN-0001", "Ana", "Empresa Alfa (ficticia)", "Fiscal", "Renovacao de contrato", "",
      "Venda realizada", "2026-09-10",
    ]);
    expect(job.validRows).toBe(0);
    expect(row?.status).toBe("invalid");
    expect(row?.error_code).toBe("UNKNOWN_OPPORTUNITY_TYPE");
    expect(row?.error_field).toBe("TIPO");
  });

  it("TIPO vazio continua valido: e opcional, so nao gera percentual", async () => {
    const { job, row } = await erroDaLinha([
      "WIN-0001", "Ana", "Empresa Alfa (ficticia)", "Fiscal", "", "",
      "Venda realizada", "2026-09-10",
    ]);
    expect(job.validRows).toBe(1);
    expect(row?.status).toBe("valid");
  });

  it("GESTOR com matricula inexistente invalida a linha", async () => {
    const { job, row } = await erroDaLinha([
      "WIN-0001", "Ana", "Empresa Alfa (ficticia)", "Fiscal", "Novo cliente", "WIN-9999",
      "Venda realizada", "2026-09-10",
    ]);
    expect(job.validRows).toBe(0);
    expect(row?.error_code).toBe("UNKNOWN_MANAGER");
    expect(row?.error_field).toBe("GESTOR");
  });

  it("GESTOR igual ao participante representa oportunidade originada pelo gestor", async () => {
    const { job, row } = await erroDaLinha([
      "WIN-0001", "Ana", "Empresa Alfa (ficticia)", "Fiscal", "Novo cliente", "WIN-0001",
      "Venda realizada", "2026-09-10",
    ]);
    expect(job.validRows).toBe(1);
    expect(row?.status).toBe("valid");
    const confirmed = await confirmImport(db, admin, job.id, { attested: true });
    expect(confirmed.created).toBe(1);
    const [referral] = await db.tx(admin, (t) => t.query<{ originated_by_manager: boolean }>(
      `select manager_staff_id = staff_id originated_by_manager from referral where source = 'import'`,
    ));
    expect(referral?.originated_by_manager).toBe(true);
  });

  it("GESTOR valido entra na indicacao e habilita a parcela do gestor", async () => {
    const { job } = await erroDaLinha([
      "WIN-0001", "Ana", "Empresa Alfa (ficticia)", "Fiscal", "Novo servico", "WIN-0007",
      "Venda realizada", "2026-09-10",
    ]);
    expect(job.validRows).toBe(1);
    const jobConfirmado = await confirmImport(db, admin, job.id, { attested: true });
    expect(jobConfirmado.created).toBe(1);
    const [indicacao] = await db.tx(admin, (t) =>
      t.query<{ opportunity_type: string; manager: string }>(
        `select r.opportunity_type::text, m.external_code manager
           from referral r join staff_member m on m.id = r.manager_staff_id
          where r.source = 'import'`));
    expect(indicacao).toMatchObject({ opportunity_type: "new_service", manager: "WIN-0007" });
  });
});

describe("Rastro da aba escolhida", () => {
  it("o job registra sheetName e selectionMethod", async () => {
    const job = await createImportJob(db, admin, {
      filename: "BASE_IMPORTACAO_WIN.xlsx", buffer: OFICIAL, referenceDate: "2026-09-30",
    });
    expect(job.summary.sheetName).toBe("IMPORTAR_ADMIN");
    expect(job.summary.selectionMethod).toBe("convention");

    const [evento] = await db.tx(admin, (t) =>
      t.query<{ metadata: Record<string, unknown> }>(
        `select metadata from audit_event where action = 'import.staged'`));
    expect(evento?.metadata).toMatchObject({
      sheetName: "IMPORTAR_ADMIN", selectionMethod: "convention",
    });
  });
});
