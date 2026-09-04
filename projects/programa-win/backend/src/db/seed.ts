import { createHash } from "node:crypto";
import type { Db } from "./client";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { RULE_SEEDS, decisionApproval } from "../domain/rule-registry";
import { seedCatalog, seedRbac } from "./seed-catalog";
import { stageFromSheetLabel, type ReferralStage } from "../domain/referral-stages";
import { cycleRange, previousCycleRange } from "../lib/dates";

export async function seedRules(db: Db): Promise<void> {
  await db.txAsOwner(async (t) => {
    const decisionApprover = env().WIN_DECISION_APPROVER;
    for (const seedRule of RULE_SEEDS) {
      /*
       * Gate do Rules Pack: sem aprovador identificavel a regra NAO entra como aprovada.
       * Regra de decisao sem WIN_DECISION_APPROVER configurado cai para 'proposed', e tudo que
       * depende dela (pontos, titularidade, progressao) permanece desligado.
       */
      const resolved = seedRule.decidedAt
        ? decisionApproval(decisionApprover, seedRule.decidedAt)
        : seedRule.approval;
      const rule = {
        ...seedRule,
        approval: resolved,
        status: seedRule.status === "approved" && !resolved ? "proposed" : seedRule.status,
      };
      // Uma regra so entra como 'approved' quando o seed carrega aprovador, data e vigencia
      // identificaveis. A constraint do banco recusa qualquer tentativa sem isso.
      await t.query(
        `insert into business_rule
           (rule_key, version, name, status, statement, definition, source,
            approver_name, approver_role, approved_at, effective_from)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11)
         on conflict (rule_key, version) do update
           set name = excluded.name, statement = excluded.statement,
               definition = excluded.definition,
               status = case
                 when business_rule.status in ('approved', 'retired') then business_rule.status
                 else excluded.status
               end,
               approver_name = coalesce(business_rule.approver_name, excluded.approver_name),
               approver_role = coalesce(business_rule.approver_role, excluded.approver_role),
               approved_at = coalesce(business_rule.approved_at, excluded.approved_at),
               effective_from = coalesce(business_rule.effective_from, excluded.effective_from),
               source = case
                 when business_rule.approved_at is not null then business_rule.source
                 else excluded.source
               end`,
        [
          rule.key, rule.version, rule.name, rule.status, rule.statement,
          JSON.stringify(rule.definition),
          rule.approval?.source ?? "docs/RULES_PACK_WIN_v0.1.md",
          rule.approval?.approverName ?? null,
          rule.approval?.approverRole ?? null,
          rule.approval?.approvedAt ?? null,
          rule.approval?.effectiveFrom ?? null,
        ],
      );
      const stagePoints = (rule.definition as { stagePoints?: Record<string, number> }).stagePoints;
      if (stagePoints) {
        for (const [stage, points] of Object.entries(stagePoints)) {
          await t.query(
            `insert into points_rule (rule_key, rule_version, stage, points)
             values ($1,$2,$3::referral_stage,$4)
             on conflict (rule_key, rule_version, stage) do update set points = excluded.points`,
            [rule.key, rule.version, stage, points],
          );
        }
      }
      // Anexo I da politica: tabela de premiacao presa a versao da regra.
      const table = (rule.definition as { table?: AwardRuleRow[] }).table;
      if (table) {
        for (const row of table) {
          await t.query(
            `insert into award_rule
               (rule_key, rule_version, situation, beneficiary, kind, fixed_amount, rate)
             values ($1,$2,$3::award_situation,$4::award_beneficiary,$5,$6::numeric,$7::numeric)
             on conflict (rule_key, rule_version, situation, beneficiary) do update
               set kind = excluded.kind, fixed_amount = excluded.fixed_amount, rate = excluded.rate`,
            [
              rule.key, rule.version, row.situation, row.beneficiary, row.kind,
              row.fixedAmount ?? null, row.rate ?? null,
            ],
          );
        }
      }
    }
  });

  /*
   * Duas versoes aprovadas da mesma regra ao mesmo tempo seria ambiguidade: a consulta pega a
   * maior versao, mas o registro ficaria dizendo que as duas valem. Ao aprovar uma versao nova,
   * a anterior e APOSENTADA — nao apagada. O historico continua auditavel.
   */
  await db.txAsOwner(async (t) => {
    await t.query(
      `update business_rule b set status = 'retired'
        where b.status = 'approved'
          and exists (select 1 from business_rule n
                       where n.rule_key = b.rule_key
                         and n.status = 'approved'
                         and n.version > b.version)`,
    );
  });
}

interface AwardRuleRow {
  situation: string;
  beneficiary: string;
  kind: "fixed" | "percentage";
  fixedAmount?: string;
  rate?: string;
}

/* -------------------------------------------------------------------------- */
/* Dados sinteticos. BAI-06: nenhuma pessoa ou empresa que possa ser real.      */
/* -------------------------------------------------------------------------- */
const SYNTHETIC_STAFF = [
  ["WIN-0001", "Ana Exemplo", "Comercial"],
  ["WIN-0002", "Bruno Ficticio", "Comercial"],
  ["WIN-0003", "Carla Amostra", "Operacoes"],
  ["WIN-0004", "Diego Modelo", "Operacoes"],
  ["WIN-0005", "Elisa Teste", "Consultoria"],
  ["WIN-0006", "Fabio Simulado", "Consultoria"],
  ["WIN-0007", "Gabriela Demo", "Comercial"],
  ["WIN-0008", "Heitor Placeholder", "Suporte"],
] as const;

const SYNTHETIC_COMPANIES = [
  "Empresa Alfa (ficticia)", "Empresa Beta (ficticia)", "Empresa Gama (ficticia)",
  "Empresa Delta (ficticia)", "Empresa Epsilon (ficticia)", "Empresa Zeta (ficticia)",
] as const;

const SHEET_STATUSES = [
  "Oportunidade identificada", "Reuniao agendada", "Reuniao realizada",
  "Proposta enviada", "Venda realizada",
] as const;

/** Gerador deterministico: a mesma seed produz sempre a mesma base sintetica. */
function mulberry32(seed: number) {
  return function next() {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticOptions {
  referralCount?: number;
  /** Ancora do periodo gerado. Padrao: hoje (UTC), para que o ciclo corrente tenha dados. */
  anchor?: Date;
  /** Janela, em dias, para tras a partir da ancora. */
  windowDays?: number;
}

export async function seedSyntheticData(db: Db, options: SyntheticOptions = {}): Promise<void> {
  const referralCount = options.referralCount ?? 96;
  const windowDays = options.windowDays ?? 75;
  const cfg = env();
  if (cfg.isProductionLike) {
    throw new Error("Seed sintetico e proibido em staging/producao.");
  }
  const { catalogVersionId } = await seedCatalog(db);

  await db.txAsOwner(async (t) => {
    const already = await t.query<{ c: number }>("select count(*)::int c from referral");
    if ((already[0]?.c ?? 0) > 0) return;

    for (const [code, name, unit] of SYNTHETIC_STAFF) {
      await t.query(
        `insert into staff_member (external_code, display_name, business_unit)
         values ($1,$2,$3) on conflict (external_code) do nothing`,
        [code, name, unit],
      );
    }
    const staff = await t.query<{ id: string; external_code: string }>(
      "select id, external_code from staff_member order by external_code",
    );
    const services = await t.query<{ id: string; slug: string; territory_id: string }>(
      `select s.id, s.slug, s.territory_id from service s
         join territory tr on tr.id = s.territory_id
        where tr.catalog_version_id = $1 order by s.slug`,
      [catalogVersionId],
    );

    const rnd = mulberry32(20260902);
    const anchor = options.anchor ?? new Date();

    /*
     * A distribuicao e ancorada no CALENDARIO do fuso de negocio, nao em uma janela
     * deslizante de N dias. Motivo: com janela deslizante, nos primeiros dias do mes o
     * ciclo corrente ficava praticamente vazio e o painel parecia quebrado. Aqui uma
     * fatia fixa cai no mes corrente ate hoje, outra no mes anterior e outra no
     * retrasado — garantindo dados no ciclo atual E no ciclo de comparacao (BAI-03).
     * A escolha continua deterministica: mesma seed, mesma distribuicao.
     */
    const currentCycle = cycleRange("monthly", anchor, cfg.APP_TIMEZONE);
    const previousMonth = previousCycleRange("monthly", currentCycle, cfg.APP_TIMEZONE);
    const monthBefore = previousCycleRange("monthly", previousMonth, cfg.APP_TIMEZONE);
    const buckets: Array<{ from: number; to: number; share: number }> = [
      {
        from: currentCycle.start.getTime(),
        to: Math.min(anchor.getTime(), currentCycle.end.getTime()),
        share: 0.4,
      },
      { from: previousMonth.start.getTime(), to: previousMonth.end.getTime(), share: 0.35 },
      { from: monthBefore.start.getTime(), to: monthBefore.end.getTime(), share: 0.25 },
    ];
    void windowDays; // mantido na assinatura por compatibilidade; ver comentario acima

    for (let i = 0; i < referralCount; i += 1) {
      const person = staff[Math.floor(rnd() * staff.length)]!;
      const service = services[Math.floor(rnd() * services.length)]!;
      const company = SYNTHETIC_COMPANIES[Math.floor(rnd() * SYNTHETIC_COMPANIES.length)]!;
      const stage = stageFromSheetLabel(
        SHEET_STATUSES[Math.floor(rnd() * SHEET_STATUSES.length)]!,
      ) as ReferralStage;
      const draw = rnd();
      let cumulative = 0;
      const bucket = buckets.find((b) => {
        cumulative += b.share;
        return draw <= cumulative;
      }) ?? buckets[buckets.length - 1]!;
      const span = Math.max(bucket.to - bucket.from, 1);
      const occurredAt = new Date(bucket.from + Math.floor(rnd() * span));
      const [ref] = await t.query<{ id: string }>(
        `insert into referral
           (staff_id, service_id, client_company, current_stage, occurred_at, source)
         values ($1,$2,$3,$4::referral_stage,$5,'seed') returning id`,
        [person.id, service.id, company, stage, occurredAt.toISOString()],
      );
      await t.query(
        `insert into referral_stage_event
           (referral_id, from_stage, to_stage, occurred_at, actor_label, idempotency_key, rule_version)
         values ($1, null, $2::referral_stage, $3, 'system:seed', $4, null)`,
        [
          ref!.id, stage, occurredAt.toISOString(),
          createHash("sha256").update(`seed|${ref!.id}|${stage}`).digest("hex"),
        ],
      );
    }

    // Progresso por territorio: total conhecido; conquista depende de RULE_TERRITORY_THRESHOLD.
    const territories = await t.query<{ id: string; total: number }>(
      `select tr.id, count(s.id)::int total from territory tr
         join service s on s.territory_id = tr.id
        where tr.catalog_version_id = $1 group by tr.id`,
      [catalogVersionId],
    );
    for (const person of staff) {
      for (const territory of territories) {
        await t.query(
          `insert into territory_progress (staff_id, territory_id, state, services_won, services_total)
           values ($1,$2,'locked',0,$3) on conflict (staff_id, territory_id) do nothing`,
          [person.id, territory.id, territory.total],
        );
      }
    }
    // NENHUM lancamento no points_ledger: RULE_POINTS_ACCRUAL nao esta aprovada (ALTO-05).
  });
  logger.info("seed.synthetic.done", { referrals: referralCount });
}

export async function seedAll(
  db: Db,
  options: { synthetic: boolean; syntheticOptions?: SyntheticOptions },
): Promise<void> {
  await seedCatalog(db);
  await seedRbac(db);
  await seedRules(db);
  if (options.synthetic) await seedSyntheticData(db, options.syntheticOptions ?? {});
}
