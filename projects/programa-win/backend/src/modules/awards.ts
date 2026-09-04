import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { declarePolicy, principalOf, requirePermission, stripClientAuthorityFields } from "../auth/rbac";
import { actorFromRequest } from "./board";
import { recordAudit } from "./audit";
import { conflict, notFound, validationFailed } from "../lib/errors";
import { requireActiveRule } from "../domain/rules";
import {
  approvePayoutBatch, awardStatement, recordRevenue, registerQualifiedMeeting,
  validateOpportunity,
} from "../domain/awards";

/**
 * Fase 6 — APIs da premiacao (Politica LOCTL CORP COML 001 rev. 03).
 * A ordem das rotas espelha a ordem da politica: validar (secao 6) -> reuniao qualificada
 * (secao 4) -> receita recebida (secao 5) -> lote e aprovacao da Diretoria (secao 8).
 */

const idParam = z.object({ id: z.string().uuid() });
const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Use decimal com ate duas casas.");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const validationSchema = z.object({
  decision: z.enum(["eligible", "ineligible"]),
  ineligibilityReason: z.string().min(5).max(400).optional(),
  titularityNote: z.string().max(400).optional(),
}).strict();

const meetingSchema = z.object({
  heldAt: isoDate,
  icpFit: z.boolean(),
  decisionMaker: z.boolean(),
  potentialIdentified: z.boolean(),
  commercialValidated: z.boolean(),
  note: z.string().max(400).optional(),
}).strict();

const revenueSchema = z.object({
  kind: z.enum(["receipt", "reversal"]),
  netAmount: money,
  receivedAt: isoDate,
  competenceDate: isoDate,
  sourceReference: z.string().max(80).optional(),
  note: z.string().max(400).optional(),
  reversesEventId: z.string().uuid().optional(),
}).strict();

export async function registerAwardRoutes(app: FastifyInstance): Promise<void> {
  /* --------- Secao 6: validacao de elegibilidade pela Area Comercial --------- */
  app.post("/api/v1/admin/opportunities/:id/validation", {
    preHandler: requirePermission("opportunity:validate"),
    config: declarePolicy("POST", "/api/v1/admin/opportunities/:id/validation", {
      permission: "opportunity:validate",
    }),
  }, async (request) => {
    const { id } = idParam.parse(request.params);
    const body = validationSchema.parse(
      stripClientAuthorityFields(request.body as Record<string, unknown>),
    );
    const actor = actorFromRequest(request);
    return app.db.tx(actor, (t) =>
      validateOpportunity(t, actor, {
        referralId: id,
        decision: body.decision,
        ...(body.ineligibilityReason ? { ineligibilityReason: body.ineligibilityReason } : {}),
        ...(body.titularityNote ? { titularityNote: body.titularityNote } : {}),
      }));
  });

  /* ---------------- Secao 4: reuniao qualificada (R$ 50,00) ----------------- */
  app.post("/api/v1/admin/opportunities/:id/qualified-meeting", {
    preHandler: requirePermission("meeting:validate"),
    config: declarePolicy("POST", "/api/v1/admin/opportunities/:id/qualified-meeting", {
      permission: "meeting:validate",
    }),
  }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = meetingSchema.parse(
      stripClientAuthorityFields(request.body as Record<string, unknown>),
    );
    const actor = actorFromRequest(request);
    const result = await app.db.tx(actor, (t) =>
      registerQualifiedMeeting(t, actor, {
        referralId: id,
        heldAt: new Date(`${body.heldAt}T12:00:00Z`),
        requisites: {
          icpFit: body.icpFit,
          decisionMaker: body.decisionMaker,
          potentialIdentified: body.potentialIdentified,
          commercialValidated: body.commercialValidated,
        },
        ...(body.note ? { note: body.note } : {}),
      }));
    return reply.code(201).send({
      ...result,
      // Secao 4: a premiacao independe da contratacao posterior, mas nao dos requisitos.
      notice: result.awarded
        ? "Reuniao qualificada registrada e premiacao de R$ 50,00 lancada."
        : "Reuniao registrada SEM premiacao: requisitos da secao 4 nao atendidos.",
    });
  });

  /* ------------- Secao 5 e 8: receita liquida efetivamente recebida --------- */
  app.post("/api/v1/admin/opportunities/:id/revenue", {
    preHandler: requirePermission("revenue:record"),
    config: declarePolicy("POST", "/api/v1/admin/opportunities/:id/revenue", {
      permission: "revenue:record",
    }),
  }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = revenueSchema.parse(
      stripClientAuthorityFields(request.body as Record<string, unknown>),
    );
    const actor = actorFromRequest(request);
    const result = await app.db.tx(actor, (t) =>
      recordRevenue(t, actor, {
        referralId: id,
        kind: body.kind,
        netAmount: body.netAmount,
        receivedAt: new Date(`${body.receivedAt}T12:00:00Z`),
        competenceDate: body.competenceDate,
        ...(body.sourceReference ? { sourceReference: body.sourceReference } : {}),
        ...(body.note ? { note: body.note } : {}),
        ...(body.reversesEventId ? { reversesEventId: body.reversesEventId } : {}),
      }));
    return reply.code(201).send(result);
  });

  /* --------------------------- Consulta da apuracao ------------------------- */
  app.get("/api/v1/admin/awards", {
    // A leitura da apuracao de TODOS exige permissao propria: o participante tem apenas
    // "award:read", que da acesso ao proprio extrato em /api/v1/me/awards.
    preHandler: requirePermission("award:read:all"),
    config: declarePolicy("GET", "/api/v1/admin/awards", { permission: "award:read:all" }),
  }, async (request) => {
    const { page, pageSize } = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(25),
    }).parse(request.query);
    return app.db.tx(actorFromRequest(request), async (t) => ({
      page,
      pageSize,
      currency: "BRL",
      items: await t.query(
        // D-12: nenhuma coluna de empresa cliente nesta consulta.
        `select l.id, m.external_code, m.display_name, l.beneficiary::text, l.situation::text,
                l.amount, l.base_amount, l.rate_applied, l.kind, l.effective_at, l.actor_label
           from award_ledger l
           join staff_member m on m.id = l.staff_id
          order by l.effective_at desc limit $1 offset $2`,
        [pageSize, (page - 1) * pageSize],
      ),
      totals: await t.query(
        `select m.external_code, m.display_name, sum(l.amount)::numeric(14,2) total
           from award_ledger l join staff_member m on m.id = l.staff_id
          group by m.external_code, m.display_name order by total desc limit 20`,
      ),
    }));
  });

  /* ------------------ Secao 8: lote de pagamento e Diretoria ---------------- */
  app.post("/api/v1/admin/payouts", {
    preHandler: requirePermission("payout:manage"),
    config: declarePolicy("POST", "/api/v1/admin/payouts", { permission: "payout:manage" }),
  }, async (request, reply) => {
    // Secao 8: o lote e de uma COMPETENCIA. Sem janela, um lote varria tudo o que estivesse
    // solto — inclusive lancamentos de outro periodo — e podia sair vazio ou negativo.
    const body = z.object({
      label: z.string().min(3).max(80),
      payrollReference: z.string().regex(/^\d{4}-\d{2}$/),
      competenceFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      competenceTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).strict().parse(stripClientAuthorityFields(request.body as Record<string, unknown>));
    if (body.competenceFrom > body.competenceTo) {
      throw validationFailed("A competencia termina antes de comecar.");
    }
    const actor = actorFromRequest(request);
    const created = await app.db.tx(actor, async (t) => {
      await requireActiveRule(t, "RULE_PAYMENT");
      const rows = await t.query<{ id: string }>(
        `insert into payout_batch
           (label, payroll_reference, competence_from, competence_to, created_by, created_by_label)
         values ($1,$2,$3::date,$4::date,$5,$6)
         on conflict (label) do nothing returning id`,
        [body.label, body.payrollReference, body.competenceFrom, body.competenceTo,
         actor.identityId, actor.label],
      );
      if (!rows[0]) throw conflict("Ja existe um lote com esse rotulo.", { label: body.label });
      // Entram apenas lancamentos DA COMPETENCIA que ainda nao pertencem a nenhum lote.
      const added = await t.query<{ id: string }>(
        `insert into payout_item (batch_id, award_entry_id)
         select $1, l.id from award_ledger l
          left join revenue_event re on re.id = l.revenue_event_id
          where coalesce(re.competence_date, l.effective_at::date) >= $2::date
            and coalesce(re.competence_date, l.effective_at::date) <= $3::date
            and not exists (select 1 from payout_item i where i.award_entry_id = l.id)
         returning award_entry_id as id`,
        [rows[0].id, body.competenceFrom, body.competenceTo],
      );
      if (!added.length) {
        throw conflict("Nenhum lancamento em aberto nesta competencia — lote nao criado.", {
          competenceFrom: body.competenceFrom, competenceTo: body.competenceTo,
        });
      }
      const [total] = await t.query<{ total: string; positive: boolean }>(
        `select coalesce(sum(l.amount), 0)::numeric(14,2) total,
                coalesce(sum(l.amount), 0) > 0 positive
           from payout_item i join award_ledger l on l.id = i.award_entry_id
          where i.batch_id = $1`,
        [rows[0].id],
      );
      await recordAudit(t, actor, {
        action: "payout.created", resourceType: "payout_batch", resourceId: rows[0].id,
        outcome: "allowed", metadata: { entries: added.length },
      });
      return {
        id: rows[0].id, entries: added.length, total: total?.total ?? "0.00", status: "open",
        // Saldo negativo e legitimo (estornos), mas nao vira pagamento: precisa de decisao.
        notice: !total?.positive
          ? "Lote com saldo zero ou negativo: predominam estornos. Nao aprove sem analisar."
          : null,
      };
    });
    return reply.code(201).send(created);
  });

  app.post("/api/v1/admin/payouts/:id/approval", {
    preHandler: requirePermission("payout:approve"),
    config: declarePolicy("POST", "/api/v1/admin/payouts/:id/approval", {
      permission: "payout:approve",
    }),
  }, async (request) => {
    const { id } = idParam.parse(request.params);
    const actor = actorFromRequest(request);
    return app.db.tx(actor, (t) => approvePayoutBatch(t, actor, id));
  });

  app.get("/api/v1/admin/payouts", {
    preHandler: requirePermission("payout:manage"),
    config: declarePolicy("GET", "/api/v1/admin/payouts", { permission: "payout:manage" }),
  }, async (request) => app.db.tx(actorFromRequest(request), async (t) => ({
    items: await t.query(
      `select b.id, b.label, b.payroll_reference, b.competence_from, b.competence_to,
              b.status, b.created_by_label, b.approver_label, b.approved_at,
              (select count(*) from payout_item i where i.batch_id = b.id)::int entries,
              (select coalesce(sum(l.amount), 0)::numeric(14,2)
                 from payout_item i join award_ledger l on l.id = i.award_entry_id
                where i.batch_id = b.id) total
         from payout_batch b order by b.created_at desc limit 25`,
    ),
  })));

  /* --------------------- Extrato do proprio participante -------------------- */
  app.get("/api/v1/me/awards", {
    preHandler: requirePermission("award:read"),
    config: declarePolicy("GET", "/api/v1/me/awards", { permission: "award:read" }),
  }, async (request) => {
    const principal = principalOf(request);
    if (!principal.staffId) {
      return { linked: false, currency: "BRL", balance: "0.00", entries: [] };
    }
    return app.db.tx(actorFromRequest(request), async (t) => ({
      linked: true,
      ...(await awardStatement(t, principal.staffId as string)),
    }));
  });

  /* ------------- Secao 6: conflitos de titularidade em aberto --------------- */
  app.get("/api/v1/admin/titularity-conflicts", {
    preHandler: requirePermission("titularity:resolve"),
    config: declarePolicy("GET", "/api/v1/admin/titularity-conflicts", {
      permission: "titularity:resolve",
    }),
  }, async (request) => app.db.tx(actorFromRequest(request), async (t) => ({
    items: await t.query(
      `select id, fingerprint, referral_id, candidate_referral_id, import_row_id, rule_version,
              decision, created_at
         from duplicate_check where decision = 'pending' order by created_at desc limit 50`,
    ),
    notice:
      "Secao 6 da politica: o sistema nao decide titularidade. A Diretoria, com o Comercial, " +
      "avalia as evidencias e define dono unico ou premiacao compartilhada.",
  })));

  app.post("/api/v1/admin/titularity-conflicts/:id/decision", {
    preHandler: requirePermission("titularity:resolve"),
    config: declarePolicy("POST", "/api/v1/admin/titularity-conflicts/:id/decision", {
      permission: "titularity:resolve",
    }),
  }, async (request) => {
    const { id } = idParam.parse(request.params);
    // Os desfechos aprovados sao dono unico ou premiacao compartilhada.
    const body = z.object({
      decision: z.enum(["single_owner", "shared_award"]),
      justification: z.string().min(10).max(500),
      ownerStaffExternalCode: z.string().max(40).optional(),
      sharedWithStaffExternalCode: z.string().max(40).optional(),
    }).strict().parse(stripClientAuthorityFields(request.body as Record<string, unknown>));
    if (body.decision === "single_owner" && !body.ownerStaffExternalCode) {
      throw validationFailed("Dono unico exige informar QUEM fica com a titularidade.");
    }
    if (body.decision === "shared_award" && !body.sharedWithStaffExternalCode) {
      throw validationFailed("Premiacao compartilhada exige informar com quem.");
    }
    const actor = actorFromRequest(request);
    return app.db.tx(actor, async (t) => {
      await requireActiveRule(t, "RULE_DUPLICATE_KEY");
      const staffId = async (code?: string) => {
        if (!code) return null;
        const [row] = await t.query<{ id: string }>(
          `select id from staff_member where external_code = $1`, [code]);
        if (!row) throw validationFailed(`Matricula ${code} nao encontrada.`);
        return row.id;
      };
      const owner = await staffId(body.ownerStaffExternalCode);
      const shared = await staffId(body.sharedWithStaffExternalCode);
      const [conflictRow] = await t.query<{
        referral_id: string | null; import_row_id: string | null;
        current_owner: string | null; claimant: string | null;
      }>(
        `select d.referral_id, d.import_row_id, r.staff_id current_owner, ir.staff_id claimant
           from duplicate_check d
           left join referral r on r.id = d.referral_id
           left join import_row ir on ir.id = d.import_row_id
          where d.id = $1 and d.decision = 'pending'
          for update of d`,
        [id],
      );
      if (!conflictRow || !conflictRow.referral_id || !conflictRow.current_owner) {
        throw notFound("Conflito inexistente, ja decidido ou sem indicacao titular.");
      }
      const candidates = new Set([conflictRow.current_owner, conflictRow.claimant].filter(Boolean));
      if (body.decision === "single_owner" && (!owner || !candidates.has(owner))) {
        throw validationFailed("O titular precisa ser uma das pessoas envolvidas no conflito.");
      }
      if (body.decision === "shared_award") {
        await requireActiveRule(t, "RULE_SHARED_AWARD_SPLIT");
        if (!shared || !candidates.has(shared) || shared === conflictRow.current_owner) {
          throw validationFailed("O compartilhamento precisa indicar a outra pessoa do conflito.");
        }
      }
      if (body.decision === "single_owner" && owner !== conflictRow.current_owner) {
        const [ledger] = await t.query<{ points: number; awards: number }>(
          `select
             (select count(*)::int from points_ledger where referral_id = $1) points,
             (select count(*)::int from award_ledger where referral_id = $1) awards`,
          [conflictRow.referral_id],
        );
        if ((ledger?.points ?? 0) > 0 || (ledger?.awards ?? 0) > 0) {
          throw validationFailed(
            "A indicacao ja possui lancamentos. A troca de titular exige regra de transferencia aprovada.",
          );
        }
        await t.query(`update referral set staff_id = $2, updated_at = now() where id = $1`, [
          conflictRow.referral_id, owner,
        ]);
      }
      if (conflictRow.import_row_id) {
        await t.query(
          `update import_row set status = $2, referral_id = $3 where id = $1`,
          [
            conflictRow.import_row_id,
            body.decision === "single_owner" && owner === conflictRow.claimant ? "applied" : "skipped",
            conflictRow.referral_id,
          ],
        );
      }
      const rows = await t.query<{ id: string; decision: string }>(
        `update duplicate_check
            set decision = $2, decided_by = $3, decided_at = now(), justification = $4,
                resolved_owner_staff_id = $5, shared_with_staff_id = $6
          where id = $1 and decision = 'pending' returning id, decision`,
        [id, body.decision, actor.identityId, body.justification, owner, shared],
      );
      if (!rows[0]) throw notFound("Conflito inexistente ou ja decidido.");
      await recordAudit(t, actor, {
        action: "titularity.resolved", resourceType: "duplicate_check", resourceId: id,
        outcome: "allowed", reasonCode: body.decision,
        correlationId: request.correlationId,
      });
      return {
        ...rows[0],
        notice: body.decision === "single_owner"
          ? "Titularidade aplicada a indicacao."
          : "Compartilhamento aplicado conforme a regra de rateio vigente.",
      };
    });
  });
}
