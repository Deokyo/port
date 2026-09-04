import { createHash } from "node:crypto";
import type { Queryable } from "../db/client";
import { validationFailed } from "../lib/errors";
import { findActiveRule } from "./rules";
import type { ReferralStage } from "./referral-stages";

/**
 * ALTO-02: a pontuacao NUNCA vem da planilha. E derivada no servidor a partir da etapa,
 * e somente quando existe regra de pontuacao aprovada e vigente.
 */
export interface PointsComputation {
  amount: number;
  ruleKey: string;
  ruleVersion: number;
  simulated: boolean;
}

export async function computeStagePoints(
  t: Queryable,
  stage: ReferralStage,
  alreadyCredited = 0,
): Promise<PointsComputation | null> {
  const rule = await findActiveRule(t, "RULE_POINTS_ACCRUAL");
  if (!rule) return null;
  const table = await t.query<{ points: number }>(
    `select points from points_rule where rule_key = $1 and rule_version = $2 and stage = $3`,
    ["RULE_POINTS_ACCRUAL", rule.version, stage],
  );
  const stagePoints = table[0]?.points;
  if (stagePoints === undefined) {
    throw validationFailed(`Regra aprovada nao define pontos para a etapa ${stage}.`);
  }
  const mode = String(rule.definition.mode ?? "non_cumulative_delta");
  const amount = mode === "cumulative_sum" ? stagePoints : stagePoints - alreadyCredited;
  return { amount, ruleKey: "RULE_POINTS_ACCRUAL", ruleVersion: rule.version, simulated: false };
}

/**
 * Simulacao para PREVIA de importacao. Usa a versao 'proposed' apenas para mostrar impacto.
 * Jamais grava no ledger e sempre volta marcada como simulated.
 */
export async function simulateStagePoints(
  t: Queryable,
  stage: ReferralStage,
): Promise<PointsComputation | null> {
  const rows = await t.query<{ version: number; definition: Record<string, unknown> }>(
    `select version, definition from business_rule
      where rule_key = 'RULE_POINTS_ACCRUAL' order by version desc limit 1`,
  );
  const row = rows[0];
  if (!row) return null;
  const stagePoints = (row.definition.stagePoints ?? {}) as Record<string, number>;
  const amount = stagePoints[stage];
  if (amount === undefined) return null;
  return { amount, ruleKey: "RULE_POINTS_ACCRUAL", ruleVersion: row.version, simulated: true };
}

export interface LedgerEntryInput {
  staffId: string;
  referralId?: string | null;
  stage?: ReferralStage | null;
  amount: number;
  kind: "grant" | "reversal" | "adjustment" | "correction";
  origin: "referral_stage" | "import" | "manual" | "migration";
  ruleKey: string;
  ruleVersion: number;
  effectiveAt: Date;
  actorIdentityId: string | null;
  actorLabel: string;
  idempotencyKey: string;
  correctionOfEntryId?: string | null;
  reason?: string | null;
}

/** BD-04: insere no ledger append-only. Repeticao com a mesma chave nao duplica. */
export async function appendLedgerEntry(
  t: Queryable,
  input: LedgerEntryInput,
): Promise<{ id: string; created: boolean }> {
  if (input.amount === 0) throw validationFailed("Lancamento de zero ponto nao e permitido.");
  if (input.correctionOfEntryId && !input.reason) {
    throw validationFailed("Correcao exige motivo (RULE_POINTS_ADJUSTMENT).");
  }
  const rows = await t.query<{ id: string }>(
    `insert into points_ledger
       (staff_id, referral_id, stage, amount, kind, origin, rule_key, rule_version,
        idempotency_key, effective_at, actor_identity_id, actor_label,
        correction_of_entry_id, reason)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     on conflict (idempotency_key) do nothing
     returning id`,
    [
      input.staffId, input.referralId ?? null, input.stage ?? null, input.amount, input.kind,
      input.origin, input.ruleKey, input.ruleVersion, input.idempotencyKey,
      input.effectiveAt.toISOString(), input.actorIdentityId, input.actorLabel,
      input.correctionOfEntryId ?? null, input.reason ?? null,
    ],
  );
  if (rows[0]) return { id: rows[0].id, created: true };
  const existing = await t.query<{ id: string }>(
    `select id from points_ledger where idempotency_key = $1`, [input.idempotencyKey],
  );
  return { id: existing[0]!.id, created: false };
}

export function ledgerIdempotencyKey(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}
