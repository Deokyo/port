import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { declarePolicy, principalOf, requirePermission } from "../auth/rbac";
import { actorFromRequest } from "./board";
import type { MeReferralDto } from "../dto";
import { findActiveRule } from "../domain/rules";

/** Escopo do participante. A RLS reforca no banco o que a rota ja restringe (AP-06). */
export async function registerMeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/me/referrals", {
    preHandler: requirePermission("referral:read"),
    config: declarePolicy("GET", "/api/v1/me/referrals", { permission: "referral:read" }),
  }, async (request) => {
    const principal = principalOf(request);
    const { page, pageSize } = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(20),
    }).parse(request.query);
    if (!principal.staffId) return { page, pageSize, items: [], linked: false };
    return app.db.tx(actorFromRequest(request), async (t) => {
      const rows = await t.query<Record<string, string>>(
        `select r.id, s.name service_name, tr.name territory_name,
                r.current_stage, r.occurred_at
           from referral r join service s on s.id = r.service_id
           join territory tr on tr.id = s.territory_id
          where r.staff_id = $1 and r.status = 'active'
          order by r.occurred_at desc limit $2 offset $3`,
        [principal.staffId, pageSize, (page - 1) * pageSize],
      );
      const items: MeReferralDto[] = rows.map((r) => ({
        id: r.id!, serviceName: r.service_name!,
        territoryName: r.territory_name!, stage: r.current_stage!, occurredAt: r.occurred_at!,
      }));
      return { page, pageSize, linked: true, items };
    });
  });

  app.get("/api/v1/me/achievements", {
    preHandler: requirePermission("profile:read"),
    config: declarePolicy("GET", "/api/v1/me/achievements", { permission: "profile:read" }),
  }, async (request) => {
    const principal = principalOf(request);
    if (!principal.staffId) return { items: [], linked: false, ruleApproved: false };
    return app.db.tx(actorFromRequest(request), async (t) => {
      const rule = await findActiveRule(t, "RULE_TERRITORY_THRESHOLD");
      const items = await t.query(
        `select a.slug, a.name, a.description, g.granted_at
           from achievement_grant g join achievement a on a.id = g.achievement_id
          where g.staff_id = $1 order by g.granted_at desc`,
        [principal.staffId],
      );
      return {
        linked: true,
        ruleApproved: Boolean(rule),
        items,
        // Sem RULE_TERRITORY_THRESHOLD aprovada nenhuma conquista e concedida (D-05).
        notice: rule ? null : "Concessao de conquistas bloqueada ate a aprovacao de RULE_TERRITORY_THRESHOLD (D-05).",
      };
    });
  });

  app.get("/api/v1/me/notifications", {
    preHandler: requirePermission("notification:read"),
    config: declarePolicy("GET", "/api/v1/me/notifications", { permission: "notification:read" }),
  }, async (request) => {
    const principal = principalOf(request);
    if (!principal.staffId) return { items: [] };
    return app.db.tx(actorFromRequest(request), async (t) => ({
      items: await t.query(
        `select id, kind, title, body, created_at, read_at from notification
          where staff_id = $1 order by created_at desc limit 20`,
        [principal.staffId],
      ),
    }));
  });
}
