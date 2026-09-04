import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { declarePolicy, principalOf, requirePermission, stripClientAuthorityFields } from "../auth/rbac";
import { actorFromRequest } from "./board";
import { recordAudit } from "./audit";
import { notFound, validationFailed } from "../lib/errors";
import { toAdminReferral } from "../dto";
import { toCsv } from "../lib/csv";
import { assertTransitionAllowed, computeDuplicateFingerprint, isReferralStage } from "../domain/referral-stages";
import { appendLedgerEntry, computeStagePoints, ledgerIdempotencyKey } from "../domain/points";
import { requireActiveRule, ruleStatusReport } from "../domain/rules";
import { env } from "../config/env";

const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const createStaffSchema = z.object({
  externalCode: z.string().min(1).max(40),
  displayName: z.string().min(1).max(160),
  businessUnit: z.string().max(80).optional(),
}).strict();

const updateStaffSchema = z.object({
  displayName: z.string().min(1).max(160).optional(),
  businessUnit: z.string().max(80).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  inactivationReason: z.string().max(240).optional(),
}).strict();

const OPPORTUNITY_TYPES = ["new_client", "new_service", "cross_sell", "up_sell"] as const;
const STAGE_LABELS: Record<string, string> = {
  identified: "Oportunidade identificada",
  meeting_scheduled: "Reuniao agendada",
  meeting_held: "Reuniao realizada",
  proposal_sent: "Proposta enviada",
  sale_won: "Venda realizada",
  lost: "Perdida",
};

const createReferralSchema = z.object({
  staffExternalCode: z.string().min(1),
  serviceSlug: z.string().min(1),
  clientCompany: z.string().min(1).max(200), // gravado, nunca devolvido (D-12)
  clientReference: z.string().max(80).optional(),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Sem estes campos a premiacao percentual do Anexo I e inalcancavel pela aplicacao.
  opportunityType: z.enum(OPPORTUNITY_TYPES).optional(),
  managerExternalCode: z.string().max(40).optional(),
}).strict();

/** Dados contratuais chegam depois da indicacao — por isso endpoint proprio (secoes 5 e 8). */
const contractSchema = z.object({
  opportunityType: z.enum(OPPORTUNITY_TYPES).optional(),
  managerExternalCode: z.string().max(40).optional(),
  contractBilling: z.enum(["one_off", "recurring"]).optional(),
  contractSignedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  serviceStartedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

const transitionSchema = z.object({
  toStage: z.string().min(1),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(500).optional(),
}).strict();

const adjustmentSchema = z.object({
  staffExternalCode: z.string().min(1),
  amount: z.number().int().refine((v) => v !== 0, "Ajuste de zero ponto nao e permitido."),
  reason: z.string().min(10).max(500),
  correctionOfEntryId: z.string().uuid().optional(),
}).strict();

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------- funcionarios ------------------------------ */
  app.get("/api/v1/admin/staff", {
    preHandler: requirePermission("staff:read"),
    config: declarePolicy("GET", "/api/v1/admin/staff", { permission: "staff:read" }),
  }, async (request) => {
    const { page, pageSize } = pagination.parse(request.query);
    const { q, status } = z.object({
      q: z.string().max(80).optional(), status: z.enum(["active", "inactive"]).optional(),
    }).parse(request.query);
    return app.db.tx(actorFromRequest(request), async (t) => {
      const rows = await t.query(
        `select m.id, m.external_code, m.display_name, m.business_unit, m.status,
                count(r.id)::int referrals
           from staff_member m
      left join referral r on r.staff_id = m.id and r.status = 'active'
          where ($1::text is null or m.display_name ilike '%' || $1 || '%'
                 or m.external_code ilike '%' || $1 || '%')
            and ($2::text is null or m.status = $2)
          group by m.id order by m.external_code
          limit $3 offset $4`,
        [q ?? null, status ?? null, pageSize, (page - 1) * pageSize],
      );
      const [total] = await t.query<{ c: number }>(`select count(*)::int c from staff_member`);
      return { page, pageSize, total: total?.c ?? 0, items: rows };
    });
  });

  app.post("/api/v1/admin/staff", {
    preHandler: requirePermission("staff:write"),
    config: declarePolicy("POST", "/api/v1/admin/staff", { permission: "staff:write" }),
  }, async (request, reply) => {
    const body = createStaffSchema.parse(stripClientAuthorityFields(request.body as Record<string, unknown>));
    const actor = actorFromRequest(request);
    const created = await app.db.tx(actor, async (t) => {
      const rows = await t.query<{ id: string }>(
        `insert into staff_member (external_code, display_name, business_unit)
         values ($1,$2,$3) on conflict (external_code) do nothing returning id`,
        [body.externalCode, body.displayName, body.businessUnit ?? null],
      );
      if (!rows[0]) throw validationFailed("Ja existe funcionario com essa matricula.");
      await recordAudit(t, actor, {
        action: "staff.created", resourceType: "staff_member", resourceId: rows[0].id,
        outcome: "allowed", correlationId: request.correlationId,
      });
      return rows[0];
    });
    return reply.code(201).send(created);
  });

  app.patch("/api/v1/admin/staff/:id", {
    preHandler: requirePermission("staff:write"),
    config: declarePolicy("PATCH", "/api/v1/admin/staff/:id", { permission: "staff:write" }),
  }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateStaffSchema.parse(stripClientAuthorityFields(request.body as Record<string, unknown>));
    if (body.status === "inactive" && !body.inactivationReason) {
      throw validationFailed("Inativacao exige motivo.");
    }
    const actor = actorFromRequest(request);
    return app.db.tx(actor, async (t) => {
      const rows = await t.query<{ id: string; status: string }>(
        `update staff_member
            set display_name = coalesce($2, display_name),
                business_unit = coalesce($3, business_unit),
                status = coalesce($4, status),
                inactivated_at = case when $4 = 'inactive' then now()
                                      when $4 = 'active' then null else inactivated_at end,
                inactivation_reason = case when $4 = 'inactive' then $5
                                           when $4 = 'active' then null else inactivation_reason end,
                updated_at = now()
          where id = $1 returning id, status`,
        [id, body.displayName ?? null, body.businessUnit ?? null, body.status ?? null,
         body.inactivationReason ?? null],
      );
      if (!rows[0]) throw notFound("Funcionario nao encontrado.");
      await recordAudit(t, actor, {
        action: "staff.updated", resourceType: "staff_member", resourceId: id,
        outcome: "allowed", correlationId: request.correlationId,
        metadata: { statusChangedTo: body.status ?? null },
      });
      return rows[0];
    });
  });

  /* -------------------------------- indicacoes ------------------------------- */
  app.get("/api/v1/admin/referrals", {
    preHandler: requirePermission("referral:read_all"),
    config: declarePolicy("GET", "/api/v1/admin/referrals", { permission: "referral:read_all" }),
  }, async (request) => {
    const { page, pageSize } = pagination.parse(request.query);
    const filters = z.object({
      stage: z.string().optional(), territory: z.string().optional(), q: z.string().max(80).optional(),
    }).parse(request.query);
    if (filters.stage && !isReferralStage(filters.stage)) throw validationFailed("Etapa invalida.");
    return app.db.tx(actorFromRequest(request), async (t) => {
      const rows = await t.query(
        `select r.id, m.external_code, m.display_name, r.client_reference, s.name service_name,
                tr.name territory_name, r.current_stage, r.occurred_at, r.status
           from referral r
           join staff_member m on m.id = r.staff_id
           join service s on s.id = r.service_id
           join territory tr on tr.id = s.territory_id
          where ($1::text is null or r.current_stage::text = $1)
            and ($2::text is null or tr.slug = $2)
            and ($3::text is null or m.display_name ilike '%' || $3 || '%'
                 or m.external_code ilike '%' || $3 || '%'
                 or r.client_reference ilike '%' || $3 || '%')
          order by r.occurred_at desc limit $4 offset $5`,
        [filters.stage ?? null, filters.territory ?? null, filters.q ?? null,
         pageSize, (page - 1) * pageSize],
      );
      const [total] = await t.query<{ c: number }>(
        `select count(*)::int c from referral where status = 'active'`,
      );
      return { page, pageSize, total: total?.c ?? 0, items: rows.map(toAdminReferral) };
    });
  });

  app.post("/api/v1/admin/referrals", {
    preHandler: requirePermission("referral:write"),
    config: declarePolicy("POST", "/api/v1/admin/referrals", { permission: "referral:write" }),
  }, async (request, reply) => {
    const body = createReferralSchema.parse(stripClientAuthorityFields(request.body as Record<string, unknown>));
    const actor = actorFromRequest(request);
    const result = await app.db.tx(actor, async (t) => {
      const [staff] = await t.query<{ id: string }>(
        `select id from staff_member where external_code = $1 and status = 'active'`,
        [body.staffExternalCode],
      );
      if (!staff) throw validationFailed("Matricula nao encontrada ou inativa.");
      const [service] = await t.query<{ id: string }>(
        `select s.id from service s join territory tr on tr.id = s.territory_id
           join catalog_version cv on cv.id = tr.catalog_version_id and cv.status = 'active'
          where s.slug = $1`,
        [body.serviceSlug],
      );
      if (!service) throw validationFailed("Servico inexistente no catalogo vigente.");
      let managerId: string | null = null;
      if (body.managerExternalCode) {
        const [manager] = await t.query<{ id: string }>(
          `select id from staff_member where external_code = $1 and status = 'active'`,
          [body.managerExternalCode],
        );
        if (!manager) throw validationFailed("Matricula do gestor nao encontrada ou inativa.");
        managerId = manager.id;
      }
      const occurredAt = new Date(`${body.occurredAt}T12:00:00Z`);
      await requireActiveRule(t, "RULE_DUPLICATE_KEY");
      const dup = await computeDuplicateFingerprint(t, {
        staffId: staff.id, serviceId: service.id,
        clientCompany: body.clientCompany, occurredAt,
      });
      if (!dup) {
        throw validationFailed("A regra de duplicidade vigente nao gerou uma chave auditavel.");
      }
      const [referral] = await t.query<{ id: string }>(
        `insert into referral
           (staff_id, service_id, client_company, client_reference, current_stage, occurred_at,
            dedupe_fingerprint, source, created_by, opportunity_type,
            manager_staff_id)
         values ($1,$2,$3,$4,'identified',$5,$6,'manual',$7,$8::opportunity_type,$9)
         on conflict (dedupe_fingerprint) where (dedupe_fingerprint is not null and status = 'active')
         do nothing returning id`,
        [staff.id, service.id, body.clientCompany, body.clientReference ?? null,
         occurredAt.toISOString(), dup.fingerprint, actor.identityId,
         body.opportunityType ?? null, managerId],
      );
      if (!referral) throw validationFailed("Indicacao duplicada pela regra vigente.", { rule: dup.ruleVersion });
      await t.query(
        `insert into referral_stage_event
           (referral_id, from_stage, to_stage, occurred_at, actor_identity_id, actor_label, idempotency_key)
         values ($1, null, 'identified', $2, $3, $4, $5)`,
        [referral.id, occurredAt.toISOString(), actor.identityId, actor.label,
         ledgerIdempotencyKey(["manual", referral.id, "identified"])],
      );
      await recordAudit(t, actor, {
        action: "referral.created", resourceType: "referral", resourceId: referral.id,
        outcome: "allowed", correlationId: request.correlationId,
      });
      return referral;
    });
    return reply.code(201).send(result);
  });

  app.post("/api/v1/admin/referrals/:id/transitions", {
    preHandler: requirePermission("referral:transition"),
    config: declarePolicy("POST", "/api/v1/admin/referrals/:id/transitions", { permission: "referral:transition" }),
  }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = transitionSchema.parse(stripClientAuthorityFields(request.body as Record<string, unknown>));
    const toStage = body.toStage;
    if (!isReferralStage(toStage)) throw validationFailed("Etapa de destino invalida.");
    const principal = principalOf(request);
    const actor = actorFromRequest(request);
    return app.db.tx(actor, async (t) => {
      const [referral] = await t.query<{ id: string; current_stage: string; staff_id: string }>(
        `select id, current_stage, staff_id from referral where id = $1 for update`, [id],
      );
      if (!referral) throw notFound("Indicacao nao encontrada.");
      if (!isReferralStage(referral.current_stage)) throw validationFailed("Etapa atual invalida.");
      const { ruleVersion } = await assertTransitionAllowed(t, {
        from: referral.current_stage, to: toStage, actorRoles: principal.roles,
      });
      const occurredAt = new Date(`${body.occurredAt}T12:00:00Z`);
      const idempotencyKey = ledgerIdempotencyKey([id, toStage, body.occurredAt]);
      const inserted = await t.query<{ id: string }>(
        `insert into referral_stage_event
           (referral_id, from_stage, to_stage, occurred_at, actor_identity_id, actor_label,
            idempotency_key, rule_version, note)
         values ($1,$2::referral_stage,$3::referral_stage,$4,$5,$6,$7,$8,$9)
         on conflict (referral_id, idempotency_key) do nothing returning id`,
        [id, referral.current_stage, toStage, occurredAt.toISOString(), actor.identityId,
         actor.label, idempotencyKey, ruleVersion, body.note ?? null],
      );
      if (!inserted[0]) return { id, stage: referral.current_stage, replay: true };
      await t.query(
        `update referral set current_stage = $2::referral_stage, updated_at = now() where id = $1`,
        [id, toStage],
      );
      let ledgerEntry: string | null = null;
      const [credited] = await t.query<{ total: number }>(
        `select coalesce(sum(amount),0)::int total from points_ledger where referral_id = $1`, [id],
      );
      const computed = await computeStagePoints(t, toStage, credited?.total ?? 0);
      if (computed && computed.amount !== 0) {
        const entry = await appendLedgerEntry(t, {
          staffId: referral.staff_id, referralId: id, stage: toStage, amount: computed.amount,
          kind: "grant", origin: "referral_stage", ruleKey: computed.ruleKey,
          ruleVersion: computed.ruleVersion, effectiveAt: occurredAt,
          actorIdentityId: actor.identityId, actorLabel: actor.label,
          idempotencyKey: ledgerIdempotencyKey(["stage", id, toStage]),
        });
        ledgerEntry = entry.id;
      }
      await recordAudit(t, actor, {
        action: "referral.transitioned", resourceType: "referral", resourceId: id,
        outcome: "allowed", correlationId: request.correlationId,
        metadata: { to: toStage, ruleVersion, ledgerEntry: Boolean(ledgerEntry) },
      });
      return { id, stage: toStage, ledgerEntry, pointsRuleApproved: Boolean(computed) };
    });
  });

  app.patch("/api/v1/admin/referrals/:id/contract", {
    preHandler: requirePermission("referral:write"),
    config: declarePolicy("PATCH", "/api/v1/admin/referrals/:id/contract", {
      permission: "referral:write",
    }),
  }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = contractSchema.parse(
      stripClientAuthorityFields(request.body as Record<string, unknown>),
    );
    const actor = actorFromRequest(request);
    return app.db.tx(actor, async (t) => {
      let managerId: string | null = null;
      if (body.managerExternalCode) {
        const [manager] = await t.query<{ id: string }>(
          `select id from staff_member where external_code = $1`, [body.managerExternalCode]);
        if (!manager) throw validationFailed("Matricula do gestor nao encontrada.");
        managerId = manager.id;
      }
      const rows = await t.query<{ id: string; opportunity_type: string | null }>(
        `update referral
            set opportunity_type = coalesce($2::opportunity_type, opportunity_type),
                manager_staff_id = coalesce($3, manager_staff_id),
                contract_billing = coalesce($4::contract_billing, contract_billing),
                contract_signed_at = coalesce($5::timestamptz, contract_signed_at),
                service_started_at = coalesce($6::timestamptz, service_started_at),
                updated_at = now()
          where id = $1 returning id, opportunity_type::text`,
        [
          id, body.opportunityType ?? null, managerId, body.contractBilling ?? null,
          body.contractSignedAt ? `${body.contractSignedAt}T12:00:00Z` : null,
          body.serviceStartedAt ? `${body.serviceStartedAt}T12:00:00Z` : null,
        ],
      );
      if (!rows[0]) throw notFound("Indicacao nao encontrada.");
      await recordAudit(t, actor, {
        action: "referral.contract.updated", resourceType: "referral", resourceId: id,
        outcome: "allowed", correlationId: request.correlationId,
        metadata: { billing: body.contractBilling ?? null },
      });
      return rows[0];
    });
  });

  /* ----------------------------- pontos e regras ----------------------------- */
  app.post("/api/v1/admin/points/adjustments", {
    preHandler: requirePermission("points:adjust"),
    config: declarePolicy("POST", "/api/v1/admin/points/adjustments", { permission: "points:adjust" }),
  }, async (request, reply) => {
    const body = adjustmentSchema.parse(request.body);
    const actor = actorFromRequest(request);
    const result = await app.db.tx(actor, async (t) => {
      await requireActiveRule(t, "RULE_POINTS_ADJUSTMENT");
      const [staff] = await t.query<{ id: string }>(
        `select id from staff_member where external_code = $1`, [body.staffExternalCode],
      );
      if (!staff) throw notFound("Funcionario nao encontrado.");
      const entry = await appendLedgerEntry(t, {
        staffId: staff.id, amount: body.amount,
        kind: body.correctionOfEntryId ? "correction" : "adjustment",
        origin: "manual", ruleKey: "RULE_POINTS_ADJUSTMENT", ruleVersion: 1,
        effectiveAt: new Date(), actorIdentityId: actor.identityId, actorLabel: actor.label,
        idempotencyKey: ledgerIdempotencyKey([
          "adjust", staff.id, String(body.amount), body.reason, new Date().toISOString(),
        ]),
        correctionOfEntryId: body.correctionOfEntryId ?? null, reason: body.reason,
      });
      await recordAudit(t, actor, {
        action: "points.adjusted", resourceType: "points_ledger", resourceId: entry.id,
        outcome: "allowed", correlationId: request.correlationId,
        metadata: { amount: body.amount, correction: Boolean(body.correctionOfEntryId) },
      });
      return entry;
    });
    return reply.code(201).send(result);
  });

  app.get("/api/v1/admin/rules", {
    preHandler: requirePermission("rule:read"),
    config: declarePolicy("GET", "/api/v1/admin/rules", { permission: "rule:read" }),
  }, async (request) => app.db.tx(actorFromRequest(request), (t) => ruleStatusReport(t)));

  app.get("/api/v1/catalog", {
    preHandler: requirePermission("catalog:read"),
    config: declarePolicy("GET", "/api/v1/catalog", { permission: "catalog:read" }),
  }, async (request) => app.db.tx(actorFromRequest(request), async (t) =>
    t.query(
      `select tr.slug territory_slug, tr.name territory_name, s.slug service_slug, s.name service_name
         from territory tr join service s on s.territory_id = tr.id
         join catalog_version cv on cv.id = tr.catalog_version_id and cv.status = 'active'
        order by tr.display_order, s.display_order`,
    )));

  app.get("/api/v1/admin/audit", {
    preHandler: requirePermission("audit:read"),
    config: declarePolicy("GET", "/api/v1/admin/audit", { permission: "audit:read" }),
  }, async (request) => {
    const { page, pageSize } = pagination.parse(request.query);
    return app.db.tx(actorFromRequest(request), async (t) => ({
      page, pageSize,
      items: await t.query(
        `select occurred_at, actor_label, actor_roles, action, resource_type, resource_id,
                outcome, reason_code, metadata
           from audit_event order by occurred_at desc limit $1 offset $2`,
        [pageSize, (page - 1) * pageSize],
      ),
    }));
  });

  /* -------------------------------- exportacao ------------------------------- */
  app.get("/api/v1/admin/export/referrals.csv", {
    preHandler: requirePermission("export:create"),
    config: declarePolicy("GET", "/api/v1/admin/export/referrals.csv", { permission: "export:create" }),
  }, async (request, reply) => {
    const actor = actorFromRequest(request);
    const rows = await app.db.tx(actor, async (t) => {
      const data = await t.query<Record<string, unknown>>(
        `select m.external_code, m.display_name, r.client_reference, s.name service_name,
                tr.name territory_name, r.current_stage,
                to_char(r.occurred_at at time zone $1, 'YYYY-MM-DD') occurred_date
           from referral r join staff_member m on m.id = r.staff_id
           join service s on s.id = r.service_id join territory tr on tr.id = s.territory_id
          where r.status = 'active' order by r.occurred_at desc limit 5000`,
        [env().APP_TIMEZONE],
      );
      await recordAudit(t, actor, {
        action: "export.created", resourceType: "referral", outcome: "allowed",
        correlationId: request.correlationId, metadata: { rows: data.length, format: "csv" },
      });
      return data;
    });
    // MED-03: toda celula passa por sanitizeCsvCell dentro de toCsv.
    const csv = toCsv([
      // D-12: a exportacao tambem nao carrega a empresa cliente.
      ["MATRICULA", "NOME", "SERVICO", "TERRITORIO", "STATUS", "DATA", "REFERENCIA"],
      ...rows.map((r) => [
        r.external_code, r.display_name, r.service_name, r.territory_name,
        STAGE_LABELS[String(r.current_stage)] ?? r.current_stage,
        r.occurred_date, r.client_reference,
      ]),
    ]);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="relatorio-indicacoes-win.csv"')
      .header("cache-control", "no-store")
      .send(`\uFEFF${csv}`);
  });
}
