import type { FastifyInstance } from "fastify";
import type { ActorContext, Queryable } from "../db/client";
import { declarePolicy, principalOf, requirePermission } from "../auth/rbac";
import { findActiveRule } from "../domain/rules";
import { toBoardParticipant, type BoardTerritoryDto } from "../dto";
import { cycleRange, previousCycleRange, type Periodicity } from "../lib/dates";
import { env } from "../config/env";

/**
 * ALTO-06: o WIN Board e o painel administrativo passam a ler a MESMA fonte (o banco).
 * Nenhum numero fixo em HTML.
 * DTO minimo: sem empresa cliente, sem IDs internos, sem dados administrativos.
 */
export function actorFromRequest(request: { principal?: { identityId: string; staffId: string | null; roles: string[]; displayName: string } }): ActorContext {
  const p = request.principal!;
  return { identityId: p.identityId, staffId: p.staffId, roles: p.roles, label: p.displayName };
}

async function territories(t: Queryable, staffId: string | null): Promise<BoardTerritoryDto[]> {
  const thresholdRule = await findActiveRule(t, "RULE_TERRITORY_THRESHOLD");
  // Projecao agregada (migration 0010). A RLS continua valendo para consultas normais.
  const rows = await t.query<{
    o_territory_slug: string; o_territory_name: string;
    o_service_slug: string; o_service_name: string; o_wins: number;
  }>("select * from board_territories($1)", [staffId]);

  const grouped = new Map<string, BoardTerritoryDto>();
  for (const row of rows) {
    let entry = grouped.get(row.o_territory_slug);
    if (!entry) {
      entry = {
        slug: row.o_territory_slug, name: row.o_territory_name, servicesTotal: 0,
        servicesWithWin: 0, state: "locked", stateRuleApproved: Boolean(thresholdRule),
        services: [],
      };
      grouped.set(row.o_territory_slug, entry);
    }
    const won = row.o_wins > 0;
    entry.services.push({ slug: row.o_service_slug, name: row.o_service_name, won });
    entry.servicesTotal += 1;
    if (won) entry.servicesWithWin += 1;
  }
  for (const entry of grouped.values()) {
    // O ESTADO so muda quando RULE_TERRITORY_THRESHOLD estiver aprovada (D-05).
    if (!thresholdRule) entry.state = "locked";
    else if (entry.servicesWithWin >= entry.servicesTotal) entry.state = "conquered";
    else if (entry.servicesWithWin > 0) entry.state = "in_progress";
  }
  return [...grouped.values()];
}

async function ranking(t: Queryable, range: { start: Date; end: Date }, currentStaffId: string | null) {
  const rows = await t.query<{
    o_staff_id: string; o_display_name: string; o_points: number; o_referrals: number;
  }>("select * from board_ranking($1, $2, $3)", [
    range.start.toISOString(), range.end.toISOString(), 10,
  ]);
  return rows.map((row, i) =>
    toBoardParticipant(
      { display_name: row.o_display_name, points: row.o_points, referrals: row.o_referrals },
      i + 1,
      row.o_staff_id === currentStaffId,
    ));
}

export async function registerBoardRoutes(app: FastifyInstance): Promise<void> {
  const cfg = env();

  app.get("/api/v1/board/summary", {
    preHandler: requirePermission("board:read"),
    config: declarePolicy("GET", "/api/v1/board/summary", { permission: "board:read" }),
  }, async (request) => {
    const principal = principalOf(request);
    const actor = actorFromRequest(request);
    const query = request.query as { periodicity?: string; reference?: string };
    const periodicity: Periodicity =
      query.periodicity === "weekly" || query.periodicity === "quarterly" ? query.periodicity : "monthly";
    const reference = query.reference ? new Date(`${query.reference}T12:00:00Z`) : new Date();
    const range = cycleRange(periodicity, reference, cfg.APP_TIMEZONE);
    const previous = previousCycleRange(periodicity, range, cfg.APP_TIMEZONE);

    return app.db.tx(actor, async (t) => {
      const pointsRule = await findActiveRule(t, "RULE_POINTS_ACCRUAL");
      const rankingRule = await findActiveRule(t, "RULE_RANKING_CYCLE");
      const [current] = await t.query<{ o_referrals: number; o_wins: number; o_points: number }>(
        "select * from board_totals($1, $2)",
        [range.start.toISOString(), range.end.toISOString()],
      );
      const [prior] = await t.query<{ o_referrals: number; o_wins: number; o_points: number }>(
        "select * from board_totals($1, $2)",
        [previous.start.toISOString(), previous.end.toISOString()],
      );
      const funnelRows = await t.query<{ o_stage: string; o_count: number }>(
        "select * from board_funnel($1, $2)",
        [range.start.toISOString(), range.end.toISOString()],
      );
      const funnel = funnelRows.map((r) => ({ stage: r.o_stage, c: r.o_count }));
      return {
        cycle: { periodicity, label: range.label, start: range.start, end: range.end },
        previousCycle: { label: previous.label, start: previous.start, end: previous.end },
        totals: {
          referrals: current?.o_referrals ?? 0,
          wins: current?.o_wins ?? 0,
          points: current?.o_points ?? 0,
          conversion: current?.o_referrals ? ((current.o_wins / current.o_referrals) * 100) : 0,
        },
        previousTotals: {
          referrals: prior?.o_referrals ?? 0, wins: prior?.o_wins ?? 0, points: prior?.o_points ?? 0,
          conversion: prior?.o_referrals ? ((prior.o_wins / prior.o_referrals) * 100) : 0,
        },
        funnel,
        territories: await territories(t, null),
        // Sem regra de ciclo/desempate aprovada, nem a API publica uma classificacao informal.
        ranking: pointsRule && rankingRule ? await ranking(t, range, principal.staffId) : [],
        rules: {
          pointsApproved: Boolean(pointsRule),
          rankingApproved: Boolean(rankingRule),
          notice: pointsRule
            ? null
            : "Os pontos fazem parte do programa, mas o VALOR por etapa ainda nao foi aprovado " +
              "(RULE_POINTS_ACCRUAL, D-03). As indicacoes exibidas sao reais; o placar de pontos " +
              "permanece zerado ate a definicao — o sistema nao arbitra pontuacao.",
        },
      };
    });
  });

  app.get("/api/v1/board/me", {
    preHandler: requirePermission("profile:read"),
    config: declarePolicy("GET", "/api/v1/board/me", { permission: "profile:read" }),
  }, async (request) => {
    const principal = principalOf(request);
    const actor = actorFromRequest(request);
    return app.db.tx(actor, async (t) => {
      if (!principal.staffId) {
        return { linked: false, notice: "Identidade ainda nao vinculada a um funcionario." };
      }
      const [balance] = await t.query<{ balance: number }>(
        `select coalesce(sum(amount), 0)::int balance from points_ledger where staff_id = $1`,
        [principal.staffId],
      );
      const [counts] = await t.query<{ total: number; wins: number }>(
        `select count(*)::int total, count(*) filter (where current_stage = 'sale_won')::int wins
           from referral where staff_id = $1 and status = 'active'`,
        [principal.staffId],
      );
      return {
        linked: true,
        displayName: principal.displayName,
        staffCode: principal.staffCode,
        points: balance?.balance ?? 0,
        referrals: counts?.total ?? 0,
        wins: counts?.wins ?? 0,
        territories: await territories(t, principal.staffId),
      };
    });
  });
}
