import { createHash } from "node:crypto";
import type { Queryable } from "../db/client";
import { forbidden, validationFailed } from "../lib/errors";
import { normalizeKey } from "../lib/text";
import { findActiveRule, requireActiveRule } from "./rules";

/** MED-04: vocabulario de PIPELINE. Nao contem estado de territorio. */
export const REFERRAL_STAGES = [
  "identified", "meeting_scheduled", "meeting_held", "proposal_sent", "sale_won", "lost",
] as const;
export type ReferralStage = (typeof REFERRAL_STAGES)[number];

/** MED-04: vocabulario de TERRITORIO. Tabela e tipo separados, sem pontos associados. */
export const TERRITORY_STATES = ["locked", "in_progress", "conquered"] as const;
export type TerritoryState = (typeof TERRITORY_STATES)[number];

/**
 * Ordem do funil (RULE_REFERRAL_STATE_MACHINE v2). 'lost' fica fora da escala: e desfecho,
 * nao avanco. Serve para decidir se uma planilha esta PROGREDINDO uma oportunidade ja
 * existente ou apenas repetindo uma linha antiga.
 */
export const STAGE_ORDER: readonly ReferralStage[] = [
  "identified", "meeting_scheduled", "meeting_held", "proposal_sent", "sale_won",
];

export function stageRank(stage: ReferralStage): number {
  return STAGE_ORDER.indexOf(stage);
}

export function isMoreAdvanced(from: ReferralStage, to: ReferralStage): boolean {
  if (to === "lost") return from !== "lost" && from !== "sale_won";
  if (from === "lost" || from === "sale_won") return false;
  return stageRank(to) > stageRank(from);
}

export function isReferralStage(value: unknown): value is ReferralStage {
  return typeof value === "string" && (REFERRAL_STAGES as readonly string[]).includes(value);
}

/** Rotulos de planilha aceitos -> etapa. Sem adivinhacao: fora daqui, a linha e rejeitada. */
const STAGE_ALIASES: Record<string, ReferralStage> = {
  "oportunidade identificada": "identified",
  identificada: "identified",
  identificado: "identified",
  "reuniao agendada": "meeting_scheduled",
  "reuniao realizada": "meeting_held",
  "proposta enviada": "proposal_sent",
  "venda realizada": "sale_won",
  perdida: "lost",
  perdido: "lost",
};

export function stageFromSheetLabel(label: unknown): ReferralStage | null {
  return STAGE_ALIASES[normalizeKey(label)] ?? null;
}

/**
 * A transicao so e permitida quando a maquina de estados foi APROVADA (D-06) e o ator tem
 * alcada pela regra de autoridade (D-07). Sem aprovacao, o sistema recusa com 422 —
 * a fundacao existe, a ativacao depende de decisao.
 */
export async function assertTransitionAllowed(
  t: Queryable,
  params: { from: ReferralStage; to: ReferralStage; actorRoles: readonly string[] },
): Promise<{ ruleVersion: string }> {
  const machine = await requireActiveRule(t, "RULE_REFERRAL_STATE_MACHINE");
  const transitions = (machine.definition.transitions ?? {}) as Record<string, string[]>;
  const allowed = transitions[params.from] ?? [];
  if (!allowed.includes(params.to)) {
    throw validationFailed(`Transicao nao permitida: ${params.from} -> ${params.to}.`, {
      from: params.from, to: params.to, allowed,
    });
  }
  const authority = await findActiveRule(t, "RULE_TRANSITION_AUTHORITY");
  if (authority) {
    const byStage = (authority.definition.byStage ?? {}) as Record<string, string[]>;
    const roles = byStage[params.to] ?? [];
    if (roles.length && !params.actorRoles.some((r) => roles.includes(r))) {
      throw forbidden(`Seu papel nao tem alcada para levar a indicacao ate ${params.to}.`);
    }
  }
  return { ruleVersion: `RULE_REFERRAL_STATE_MACHINE@${machine.version}` };
}

/**
 * ALTO-04 / RP-06 / D-04 — titularidade unica da oportunidade.
 *
 * No piloto, a regra vigente usa empresa normalizada + servico. Sem regra, a previa pode seguir
 * sem fingerprint e a confirmacao fica bloqueada. Uma regra vigente incompativel falha fechada.
 */
export async function computeDuplicateFingerprint(
  t: Queryable,
  input: {
    staffId: string;
    serviceId: string;
    clientCompany: string;
    occurredAt: Date;
  },
): Promise<{ fingerprint: string; ruleVersion: string; key: string } | null> {
  const rule = await findActiveRule(t, "RULE_DUPLICATE_KEY");
  if (!rule) return null;
  const fields = (rule.definition.key ?? rule.definition.fields ?? []) as string[];
  const windowDays = Number(rule.definition.windowDays ?? 0);

  const supported = new Set(["staff_id", "service_id", "client_company_normalized"]);
  if (
    fields.some((field) => !supported.has(field)) ||
    !fields.includes("service_id") ||
    !fields.includes("client_company_normalized")
  ) {
    throw validationFailed(
      "A regra de duplicidade vigente nao possui uma chave suportada pelo piloto por planilha.",
      { ruleKey: "RULE_DUPLICATE_KEY", version: rule.version, fields },
    );
  }

  const bucket = windowDays > 0
    ? Math.floor(input.occurredAt.getTime() / (windowDays * 86_400_000))
    : 0;
  const parts: string[] = [];
  if (fields.includes("staff_id")) parts.push(input.staffId);
  if (fields.includes("service_id")) parts.push(input.serviceId);
  if (fields.includes("client_company_normalized")) parts.push(normalizeKey(input.clientCompany));
  parts.push(`w${bucket}`, `v${rule.version}`);
  return {
    fingerprint: createHash("sha256").update(parts.join("|")).digest("hex"),
    ruleVersion: `RULE_DUPLICATE_KEY@${rule.version}`,
    key: fields.join("+"),
  };
}

/**
 * Secao 6 — conflito de titularidade. Quando um segundo colaborador reivindica a mesma
 * oportunidade, o sistema NAO decide: registra o conflito como pendente para a Diretoria e o
 * Comercial avaliarem as evidencias (dono unico ou premiacao compartilhada).
 */
export async function registerTitularityConflict(
  t: Queryable,
  input: {
    fingerprint: string;
    ruleVersion: string;
    existingReferralId: string | null;
    claimantReferralId?: string | null;
    importRowId?: string | null;
  },
): Promise<void> {
  await t.query(
    `insert into duplicate_check
       (fingerprint, referral_id, candidate_referral_id, import_row_id, rule_version, decision)
     values ($1,$2,$3,$4,$5,'pending')`,
    [
      input.fingerprint, input.existingReferralId, input.claimantReferralId ?? null,
      input.importRowId ?? null, input.ruleVersion,
    ],
  );
}
