import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveRule, asAdmin, asParticipant, asValidator, buildCsv, createTestContext,
  multipart, type TestContext,
} from "../helpers/app";
import { FORBIDDEN_PUBLIC_KEYS } from "../../src/dto";

let ctx: TestContext;
let admin: string;
let validator: string;
let participant: string;

beforeAll(async () => {
  ctx = await createTestContext();
  admin = await asAdmin(ctx.app);
  validator = await asValidator(ctx.app);
  participant = await asParticipant(ctx.app);
});
afterAll(async () => { await ctx.close(); });

describe("ALTO-06 — WIN Board e painel na mesma fonte", () => {
  it("o board devolve numeros derivados do banco, nao valores fixos", async () => {
    const response = await ctx.app.inject({
      method: "GET", url: "/api/v1/board/summary", headers: { cookie: participant },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.totals.referrals).toBeGreaterThan(0);
    expect(body.territories).toHaveLength(4);
    expect(body.territories.map((t: { name: string }) => t.name).sort())
      .toEqual(["Expansao", "Governanca", "Performance", "Pessoas"]);

    const [dbCount] = await ctx.db.query<{ c: number }>(
      `select count(*)::int c from referral where status = 'active'
        and occurred_at between $1 and $2`,
      [body.cycle.start, body.cycle.end],
    );
    expect(body.totals.referrals).toBe(dbCount!.c);
  });

  it("D-03: com a pontuacao aprovada o placar deixa de ter aviso, mas nao inventa numero", async () => {
    const body = (await ctx.app.inject({
      method: "GET", url: "/api/v1/board/summary", headers: { cookie: participant },
    })).json();
    expect(body.rules.pointsApproved).toBe(true);
    expect(body.rules.notice).toBeNull();
    // A base sintetica nao lanca pontos: o placar so sobe com fato registrado.
    expect(body.totals.points).toBe(0);
    // Territorio continua bloqueado: RULE_TERRITORY_THRESHOLD segue sem decisao.
    for (const territory of body.territories) {
      expect(territory.state).toBe("locked");
      expect(territory.stateRuleApproved).toBe(false);
    }
  });

  it("o DTO do board nao carrega empresa cliente, ID interno nem dado administrativo", async () => {
    const body = (await ctx.app.inject({
      method: "GET", url: "/api/v1/board/summary", headers: { cookie: participant },
    })).json();
    const serialized = JSON.stringify(body.ranking);
    for (const key of FORBIDDEN_PUBLIC_KEYS) {
      expect(serialized, `chave proibida no ranking: ${key}`).not.toContain(`"${key}"`);
    }
    expect(serialized).not.toContain("Empresa");
    expect(serialized).not.toContain("WIN-000");
  });

  it("o mesmo dado alimenta o painel administrativo", async () => {
    const board = (await ctx.app.inject({
      method: "GET", url: "/api/v1/board/summary", headers: { cookie: admin },
    })).json();
    const adminList = (await ctx.app.inject({
      method: "GET", url: "/api/v1/admin/referrals?pageSize=1", headers: { cookie: admin },
    })).json();
    expect(adminList.total).toBeGreaterThanOrEqual(board.totals.referrals);
    // D-12: a empresa cliente nao sai do backend; a referencia administrativa e explicita.
    expect(adminList.items[0]).not.toHaveProperty("clientCompany");
    expect(adminList.items[0]).toHaveProperty("reference");
    expect(adminList.items[0]).not.toHaveProperty("ploomesId");
    expect(JSON.stringify(adminList)).not.toContain("ficticia");
  });

  it("o painel de regras mostra somente as revisoes vigentes do piloto", async () => {
    const response = await ctx.app.inject({
      method: "GET", url: "/api/v1/admin/rules", headers: { cookie: admin },
    });
    expect(response.statusCode).toBe(200);
    const content = JSON.stringify(response.json());
    expect(content).not.toMatch(/ploomes|\bcrm\b/i);
    expect(content).toContain("Programa WIN");
    expect(content).toContain("referencia operacional");
  });
});

describe("Fase 6 — CRUD, transicoes e alcada", () => {
  let referralId: string;

  it("administrador cria funcionario e indicacao", async () => {
    const staff = await ctx.app.inject({
      method: "POST", url: "/api/v1/admin/staff", headers: { cookie: admin },
      payload: { externalCode: "WIN-9100", displayName: "Iris Sintetica", businessUnit: "Comercial" },
    });
    expect(staff.statusCode).toBe(201);

    const referral = await ctx.app.inject({
      method: "POST", url: "/api/v1/admin/referrals", headers: { cookie: admin },
      payload: {
        staffExternalCode: "WIN-9100", serviceSlug: "fiscal",
        clientCompany: "Empresa Omega (ficticia)", occurredAt: "2026-08-20",
      },
    });
    expect(referral.statusCode).toBe(201);
    referralId = referral.json().id;
  });

  it("D-03: o avanco de etapa lanca a pontuacao aprovada, derivada no servidor", async () => {
    const permitida = await ctx.app.inject({
      method: "POST", url: `/api/v1/admin/referrals/${referralId}/transitions`,
      headers: { cookie: admin },
      payload: { toStage: "meeting_scheduled", occurredAt: "2026-08-21" },
    });
    expect(permitida.statusCode).toBe(200);
    expect(permitida.json().stage).toBe("meeting_scheduled");
    expect(permitida.json().pointsRuleApproved).toBe(true);

    const [lancamento] = await ctx.db.query<{ amount: number; stage: string; actor_label: string }>(
      `select amount, stage::text, actor_label from points_ledger where referral_id = $1`,
      [referralId],
    );
    expect(lancamento?.amount).toBe(20);          // 'Reuniao agendada' na tabela aprovada
    expect(lancamento?.stage).toBe("meeting_scheduled");
    expect(lancamento?.actor_label).toBe("admin-teste@example.invalid");
  });

  it("D-06: pular etapa e permitido, retroceder nao", async () => {
    // A sequencia aprovada permite salto para frente (a planilha nem sempre traz todas as etapas).
    const salto = await ctx.app.inject({
      method: "POST", url: `/api/v1/admin/referrals/${referralId}/transitions`,
      headers: { cookie: admin },
      payload: { toStage: "sale_won", occurredAt: "2026-08-22" },
    });
    expect(salto.statusCode).toBe(200);

    // Cumulativo: 20 da reuniao agendada + 100 da venda = 120. A etapa pulada nao paga.
    const [saldo] = await ctx.db.query<{ total: number }>(
      `select coalesce(sum(amount), 0)::int total from points_ledger where referral_id = $1`,
      [referralId],
    );
    expect(saldo?.total).toBe(120);

    const retrocesso = await ctx.app.inject({
      method: "POST", url: `/api/v1/admin/referrals/${referralId}/transitions`,
      headers: { cookie: admin },
      payload: { toStage: "meeting_held", occurredAt: "2026-08-23" },
    });
    expect(retrocesso.statusCode).toBe(422);
    expect(retrocesso.json().error.message).toContain("Transicao nao permitida");
  });

  it("repetir a mesma transicao nao duplica evento", async () => {
    const repeat = await ctx.app.inject({
      method: "POST", url: `/api/v1/admin/referrals/${referralId}/transitions`,
      headers: { cookie: admin },
      payload: { toStage: "meeting_scheduled", occurredAt: "2026-08-21" },
    });
    // A maquina de estados recusa antes mesmo da chave de idempotencia: nao ha retrocesso
    // nem repeticao de etapa ja atingida.
    expect(repeat.statusCode).toBe(422);
    const [events] = await ctx.db.query<{ c: number }>(
      `select count(*)::int c from referral_stage_event
        where referral_id = $1 and to_stage = 'meeting_scheduled'`, [referralId],
    );
    expect(events!.c).toBe(1);

    // A idempotencia tambem esta garantida no banco pela constraint (referral_id, chave).
    await expect(ctx.db.txAsOwner(async (t) => {
      const [existing] = await t.query<{ idempotency_key: string }>(
        `select idempotency_key from referral_stage_event where referral_id = $1 limit 1`,
        [referralId],
      );
      await t.query(
        `insert into referral_stage_event
           (referral_id, to_stage, occurred_at, actor_label, idempotency_key)
         values ($1, 'lost', now(), 'system:test', $2)`,
        [referralId, existing!.idempotency_key],
      );
    })).rejects.toThrow();
  });

  it("D-07: a alcada aprovada e a da politica — validar e pagar, nao o funil do prototipo", async () => {
    await approveRule(ctx.db, "RULE_TRANSITION_AUTHORITY");
    // A versao 2 de RULE_TRANSITION_AUTHORITY (aprovada pela politica assinada) define alcada de
    // VALIDACAO e de PAGAMENTO. Ela nao trata das etapas do funil do prototipo, entao o servidor
    // nao inventa restricao por etapa: a barreira do funil e a permissao referral:transition.
    const [regra] = await ctx.db.query<{ definition: Record<string, unknown> }>(
      `select definition from business_rule
        where rule_key = 'RULE_TRANSITION_AUTHORITY' and status = 'approved'
        order by version desc limit 1`,
    );
    expect(regra?.definition).toHaveProperty("validate");
    expect(regra?.definition).toHaveProperty("approvePayout");
    expect(regra?.definition).not.toHaveProperty("byStage");

    // Alcada que a politica REALMENTE define: quem valida a elegibilidade.
    const participanteTentaValidar = await ctx.app.inject({
      method: "POST", url: `/api/v1/admin/opportunities/${referralId}/validation`,
      headers: { cookie: participant },
      payload: { decision: "eligible" },
    });
    expect(participanteTentaValidar.statusCode).toBe(403);

    const comercialValida = await ctx.app.inject({
      method: "POST", url: `/api/v1/admin/opportunities/${referralId}/validation`,
      headers: { cookie: validator },
      payload: { decision: "eligible" },
    });
    expect(comercialValida.statusCode).toBe(200);
    expect(comercialValida.json().eligibilityStatus).toBe("eligible");
  });

  it("a autoria registrada e a da sessao, nunca um literal fixo (ALTO-01)", async () => {
    const events = await ctx.db.query<{ actor_label: string }>(
      `select distinct actor_label from referral_stage_event where referral_id = $1`, [referralId],
    );
    const labels = events.map((e) => e.actor_label);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label).toBe("admin-teste@example.invalid");
  });

  it("inativacao exige motivo e preserva o historico", async () => {
    const [staff] = await ctx.db.query<{ id: string }>(
      `select id from staff_member where external_code = 'WIN-9100'`,
    );
    const semMotivo = await ctx.app.inject({
      method: "PATCH", url: `/api/v1/admin/staff/${staff!.id}`, headers: { cookie: admin },
      payload: { status: "inactive" },
    });
    expect(semMotivo.statusCode).toBe(422);

    const comMotivo = await ctx.app.inject({
      method: "PATCH", url: `/api/v1/admin/staff/${staff!.id}`, headers: { cookie: admin },
      payload: { status: "inactive", inactivationReason: "desligamento sintetico de teste" },
    });
    expect(comMotivo.statusCode).toBe(200);
    const [referrals] = await ctx.db.query<{ c: number }>(
      `select count(*)::int c from referral where staff_id = $1`, [staff!.id],
    );
    expect(referrals!.c).toBe(1);   // soft delete: nada e apagado
  });
});

describe("Fase 5 — importacao ponta a ponta pela API", () => {
  const header = ["MATRICULA", "NOME", "EMPRESA", "PRODUTO", "STATUS", "DATA", "PONTOS"];
  const file = buildCsv([
    header,
    ["WIN-0005", "Elisa", "Empresa Sigma (ficticia)", "Folha", "Venda realizada", "2026-08-14", "5000"],
  ]);

  it("valida, mostra previa e nao aplica nada sem confirmacao", async () => {
    const form = multipart(
      { referenceDate: "2026-08-31" },
      { field: "file", filename: "ciclo.csv", content: file, contentType: "text/csv" },
    );
    const upload = await ctx.app.inject({
      method: "POST", url: "/api/v1/admin/imports",
      headers: { cookie: admin, ...form.headers }, payload: form.body,
    });
    expect(upload.statusCode).toBe(201);
    const job = upload.json();
    expect(job.status).toBe("awaiting_confirmation");

    const preview = await ctx.app.inject({
      method: "GET", url: `/api/v1/admin/imports/${job.id}/preview`, headers: { cookie: admin },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().canConfirm).toBe(true);
    // Com D-03 decidida, a previa deixa de ser simulacao: mostra o que sera lancado de fato.
    expect(preview.json().points.simulated).toBe(false);
    expect(preview.json().points.ruleApproved).toBe(true);
    expect(preview.json().points.total).toBeGreaterThan(0);

    // A previa por si so nao aplica NADA: e este o ponto do teste.
    const antes = await ctx.db.query<{ c: number }>(
      "select count(*)::int c from referral where source = 'import'");
    expect(antes[0]?.c).toBe(0);

    // Confirmar SEM atestar a conferencia e recusado: a regra operacional a exige (D-27).
    const semAtestacao = await ctx.app.inject({
      method: "POST", url: `/api/v1/admin/imports/${job.id}/confirm`,
      headers: { cookie: admin }, payload: { attestConference: false },
    });
    expect(semAtestacao.statusCode).toBe(422);
    expect(semAtestacao.json().error.ruleKey).toBe("RULE_OPERATING_MODEL");

    // A confirmacao COM atestacao e o unico caminho para consolidar.
    const confirm = await ctx.app.inject({
      method: "POST", url: `/api/v1/admin/imports/${job.id}/confirm`,
      headers: { cookie: admin },
      payload: { attestConference: true, conferenceNote: "Conferido pelo relatorio do ciclo." },
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().status).toBe("completed");

    const depois = await ctx.db.query<{ c: number }>(
      "select count(*)::int c from referral where source = 'import'");
    expect(depois[0]?.c).toBeGreaterThan(0);

    // Os pontos sao lancados pela etapa informada; a premiacao em dinheiro NAO — ela nasce do
    // recebimento da receita, nunca da planilha (politica, secao 8).
    const [ledgers] = await ctx.db.query<{ pontos: number; premiacao: number }>(
      `select (select count(*) from points_ledger)::int pontos,
              (select count(*) from award_ledger)::int premiacao`);
    expect(ledgers?.pontos).toBeGreaterThan(0);
    expect(ledgers?.premiacao).toBe(0);
  });

  it("reenviar o mesmo arquivo devolve o mesmo job com 200 (idempotencia)", async () => {
    const form = multipart(
      { referenceDate: "2026-08-31" },
      { field: "file", filename: "ciclo.csv", content: file, contentType: "text/csv" },
    );
    const again = await ctx.app.inject({
      method: "POST", url: "/api/v1/admin/imports",
      headers: { cookie: admin, ...form.headers }, payload: form.body,
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().replay).toBe(true);
  });

  it("participante nao consegue enviar planilha", async () => {
    const form = multipart(
      { referenceDate: "2026-08-31" },
      { field: "file", filename: "x.csv", content: file, contentType: "text/csv" },
    );
    const response = await ctx.app.inject({
      method: "POST", url: "/api/v1/admin/imports",
      headers: { cookie: participant, ...form.headers }, payload: form.body,
    });
    expect(response.statusCode).toBe(403);
  });
});

describe("MED-03 — exportacao neutralizada", () => {
  it("celula com formula sai neutralizada no CSV", async () => {
    await ctx.app.inject({
      method: "POST", url: "/api/v1/admin/staff", headers: { cookie: admin },
      payload: { externalCode: "WIN-9200", displayName: "=HYPERLINK(\"http://x\",\"clique\")" },
    });
    await ctx.app.inject({
      method: "POST", url: "/api/v1/admin/referrals", headers: { cookie: admin },
      payload: {
        staffExternalCode: "WIN-9200", serviceSlug: "auditoria",
        // D-12: a empresa cliente nao vai para a exportacao. A formula entra pelo campo que vai:
        clientCompany: "Empresa Sigma (ficticia)", clientReference: "@SUM(A1:A9)",
        occurredAt: "2026-08-20",
      },
    });
    const response = await ctx.app.inject({
      method: "GET", url: "/api/v1/admin/export/referrals.csv", headers: { cookie: admin },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers["content-disposition"]).toContain("relatorio-indicacoes-win.csv");
    expect(response.body).toContain("MATRICULA;NOME;SERVICO;TERRITORIO;STATUS;DATA;REFERENCIA");
    expect(response.body).not.toContain("PLOOMES");
    expect(response.body).toContain("Oportunidade identificada");
    expect(response.body).toContain(`"'=HYPERLINK`);
    expect(response.body).toContain(`"'@SUM(A1:A9)"`);
    // D-12: a exportacao nao carrega a empresa cliente.
    expect(response.body).not.toContain("Empresa Sigma");
    expect(response.body).not.toMatch(/;=HYPERLINK/);
    expect(response.body).not.toMatch(/;@SUM/);
  });
});

describe("Gate de ajustes manuais", () => {
  it("nao permite criar pontos discricionarios sem regra aprovada", async () => {
    const response = await ctx.app.inject({
      method: "POST", url: "/api/v1/admin/points/adjustments", headers: { cookie: admin },
      payload: {
        staffExternalCode: "WIN-0001", amount: 50,
        reason: "Ajuste sintetico para verificar o gate de aprovacao.",
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("PENDING_BUSINESS_RULE");
    expect(response.json().error.ruleKey).toBe("RULE_POINTS_ADJUSTMENT");
  });
});

describe("Auditoria com autoria", () => {
  it("as acoes administrativas ficam registradas com o autor da sessao", async () => {
    const response = await ctx.app.inject({
      method: "GET", url: "/api/v1/admin/audit?pageSize=100", headers: { cookie: admin },
    });
    expect(response.statusCode).toBe(200);
    const actions = response.json().items.map((i: { action: string }) => i.action);
    expect(actions).toContain("staff.created");
    expect(actions).toContain("referral.created");
    expect(actions).toContain("import.staged");
    expect(actions).toContain("export.created");

    const labels = new Set(response.json().items.map((i: { actor_label: string }) => i.actor_label));
    expect(labels.has("admin-teste@example.invalid")).toBe(true);
    for (const label of labels) expect(String(label).trim()).not.toBe("");

    // Nenhum evento carrega PII no metadata (redaction obrigatoria).
    const serialized = JSON.stringify(response.json().items);
    expect(serialized).not.toContain("Empresa Omega");
    expect(serialized).not.toContain("Empresa Sigma");
  });
});

describe("BE-09 — conquistas do participante", () => {
  it("o endpoint existe e declara honestamente que a concessao esta bloqueada", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/me/achievements",
      headers: { cookie: participant },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      items: unknown[]; ruleApproved: boolean; notice: string | null;
    };
    expect(body.items).toEqual([]);
    expect(body.ruleApproved).toBe(false);
    expect(String(body.notice)).toContain("RULE_TERRITORY_THRESHOLD");
  });
});

describe("Gate de titularidade no cadastro manual", () => {
  it("recusa nova indicacao quando a regra de duplicidade nao esta vigente", async () => {
    await ctx.db.txAsOwner((t) => t.query(
      `update business_rule set status = 'proposed', approver_name = null,
              approved_at = null, effective_from = null
        where rule_key = 'RULE_DUPLICATE_KEY'`,
    ));
    const response = await ctx.app.inject({
      method: "POST", url: "/api/v1/admin/referrals", headers: { cookie: admin },
      payload: {
        staffExternalCode: "WIN-0001", serviceSlug: "fiscal",
        clientCompany: "Empresa Gate (ficticia)", occurredAt: "2026-09-04",
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.ruleKey).toBe("RULE_DUPLICATE_KEY");
  });
});
