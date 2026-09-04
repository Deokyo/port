import { createHash } from "node:crypto";
import type { ActorContext, Queryable } from "../db/client";
import { conflict, forbidden, notFound, validationFailed } from "../lib/errors";
import { findActiveRule, requireActiveRule } from "./rules";
import { recordAudit } from "../modules/audit";

/**
 * Apuracao da premiacao conforme a Politica LOCTL CORP COML 001, revisao 03
 * (emissao 01/09/2026, assinada por People & Culture, Juridico e Comercial).
 *
 * Tres travas estruturais, todas exigidas pela politica:
 *   secao 6 — a validacao da Area Comercial e obrigatoria antes da premiacao;
 *   secao 5 — a base e a receita liquida EFETIVAMENTE RECEBIDA, com teto de 12 meses no recorrente;
 *   secao 8 — cancelamento, estorno, devolucao e inadimplencia geram AJUSTE em apuracao posterior,
 *             ou seja, lancamento compensatorio — nunca reescrita do historico.
 *
 * Dinheiro nunca passa por ponto flutuante em JavaScript: a multiplicacao e feita em numeric
 * pelo proprio PostgreSQL.
 */

export type OpportunityType = "new_client" | "new_service" | "cross_sell" | "up_sell";
export type AwardSituation =
  | "qualified_meeting"
  | "new_service_cross_up_sell"
  | "new_client_referral"
  | "new_client_by_manager";
export type Beneficiary = "collaborator" | "manager";

export const AWARD_RULE_KEY = "RULE_FINANCIAL_BONUS";

/** Requisitos informados pelo validador; o registro no Programa WIN e automatico. */
export interface MeetingRequisites {
  icpFit: boolean;
  decisionMaker: boolean;
  potentialIdentified: boolean;
  commercialValidated: boolean;
}

export const MEETING_REQUISITE_LABELS: Record<keyof MeetingRequisites, string> = {
  icpFit: "empresa aderente ao perfil de cliente definido pelo Grupo Locatelli",
  decisionMaker: "participacao de decisor ou influenciador relevante",
  potentialIdentified: "potencial identificado para contratacao de servico",
  commercialValidated: "validacao pela Area Comercial",
};

/** No piloto, o registro no proprio Programa WIN fornece o rastro operacional. */
export function missingRequisites(requisites: MeetingRequisites): string[] {
  return (Object.keys(MEETING_REQUISITE_LABELS) as Array<keyof MeetingRequisites>)
    .filter((key) => !requisites[key])
    .map((key) => MEETING_REQUISITE_LABELS[key]);
}

export function idempotencyKey(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function decimalIsZero(value: string): boolean {
  return !/[1-9]/.test(value);
}

interface AwardRateRow {
  situation: AwardSituation;
  beneficiary: Beneficiary;
  kind: "fixed" | "percentage";
  fixed_amount: string | null;
  rate: string | null;
}

/** Anexo I, na versao aprovada e vigente. Sem regra aprovada, nao ha o que apurar. */
export async function loadAwardTable(t: Queryable): Promise<{
  version: number;
  rates: AwardRateRow[];
}> {
  const rule = await requireActiveRule(t, AWARD_RULE_KEY);
  const rates = await t.query<AwardRateRow>(
    `select situation, beneficiary, kind, fixed_amount, rate
       from award_rule where rule_key = $1 and rule_version = $2`,
    [AWARD_RULE_KEY, rule.version],
  );
  if (!rates.length) {
    throw validationFailed("A regra de premiacao vigente nao possui tabela (Anexo I) carregada.");
  }
  return { version: rule.version, rates };
}

function findRate(
  rates: readonly AwardRateRow[], situation: AwardSituation, beneficiary: Beneficiary,
): AwardRateRow | null {
  return rates.find((r) => r.situation === situation && r.beneficiary === beneficiary) ?? null;
}

/**
 * Anexo I: qual situacao remunera qual tipo de oportunidade.
 * "Novo cliente originado diretamente pelo gestor" e uma linha propria da tabela — por isso o
 * originador importa, nao so o tipo da oportunidade.
 */
export function situationFor(
  opportunityType: OpportunityType, originatedByManager: boolean,
): AwardSituation {
  if (opportunityType === "new_client") {
    return originatedByManager ? "new_client_by_manager" : "new_client_referral";
  }
  return "new_service_cross_up_sell";
}

interface ReferralRow {
  id: string;
  staff_id: string;
  manager_staff_id: string | null;
  opportunity_type: OpportunityType | null;
  contract_billing: "one_off" | "recurring" | null;
  contract_signed_at: string | null;
  service_started_at: string | null;
  eligibility_status: string;
  status: string;
}

async function loadReferral(t: Queryable, referralId: string): Promise<ReferralRow> {
  const rows = await t.query<ReferralRow>(
    `select id, staff_id, manager_staff_id, opportunity_type, contract_billing,
            contract_signed_at, service_started_at, eligibility_status, status
       from referral where id = $1 for update`,
    [referralId],
  );
  const referral = rows[0];
  if (!referral) throw notFound("Oportunidade nao encontrada.");
  return referral;
}

/**
 * Secao 6 — validacao da Area Comercial. E o unico caminho para 'eligible'.
 * O banco reforca a autoria da validacao; o registro operacional acontece no Programa WIN.
 */
export async function validateOpportunity(
  t: Queryable,
  actor: ActorContext,
  input: {
    referralId: string;
    decision: "eligible" | "ineligible";
    ineligibilityReason?: string;
    titularityNote?: string;
  },
): Promise<{ id: string; eligibilityStatus: string }> {
  await requireActiveRule(t, "RULE_REFERRAL_VALIDITY");
  const referral = await loadReferral(t, input.referralId);
  if (referral.eligibility_status !== "pending_validation") {
    throw conflict(
      `Esta oportunidade ja foi avaliada (${referral.eligibility_status}). ` +
        "Reversao exige registro proprio, nao reescrita.",
      { referralId: input.referralId },
    );
  }
  if (input.decision === "ineligible") {
    if (!input.ineligibilityReason) {
      throw validationFailed("A recusa exige o motivo previsto na secao 7 da politica.");
    }
    await t.query(
      `update referral set eligibility_status = 'ineligible', ineligibility_reason = $2,
              validated_by = $3, validated_at = now(), titularity_note = $4, updated_at = now()
        where id = $1`,
      [input.referralId, input.ineligibilityReason, actor.identityId, input.titularityNote ?? null],
    );
    await recordAudit(t, actor, {
      action: "opportunity.rejected", resourceType: "referral", resourceId: input.referralId,
      outcome: "allowed", reasonCode: input.ineligibilityReason,
    });
    return { id: input.referralId, eligibilityStatus: "ineligible" };
  }

  const operating = await requireActiveRule(t, "RULE_OPERATING_MODEL");
  if (
    operating.definition.dataEntry !== "spreadsheet_upload" ||
    operating.definition.attestationRequired !== true
  ) {
    throw validationFailed(
      "O modelo operacional configurado nao corresponde ao piloto vigente por planilha.",
      { ruleKey: "RULE_OPERATING_MODEL" },
    );
  }
  await t.query(
    `update referral set eligibility_status = 'eligible',
            validated_by = $2, validated_at = now(), ineligibility_reason = null,
            titularity_note = $3, updated_at = now()
      where id = $1`,
    [input.referralId, actor.identityId, input.titularityNote ?? null],
  );
  await recordAudit(t, actor, {
    action: "opportunity.validated", resourceType: "referral", resourceId: input.referralId,
    outcome: "allowed",
  });
  return { id: input.referralId, eligibilityStatus: "eligible" };
}

/**
 * Secao 4 — reuniao qualificada: R$ 50,00 devidos por reuniao efetivamente realizada,
 * independentemente da contratacao posterior, desde que os requisitos sejam atendidos.
 */
export async function registerQualifiedMeeting(
  t: Queryable,
  actor: ActorContext,
  input: { referralId: string; heldAt: Date; requisites: MeetingRequisites; note?: string },
): Promise<{
  meetingId: string; awarded: boolean; amount: string | null; missing: string[];
  registrationSource: "programa_win";
}> {
  const referral = await loadReferral(t, input.referralId);
  await requireActiveRule(t, "RULE_QUALIFIED_MEETING");
  const operating = await requireActiveRule(t, "RULE_OPERATING_MODEL");
  if (
    operating.definition.dataEntry !== "spreadsheet_upload" ||
    operating.definition.attestationRequired !== true
  ) {
    throw validationFailed("A reuniao exige o modelo operacional vigente do piloto por planilha.");
  }
  const missing = missingRequisites(input.requisites);

  const key = idempotencyKey(["qualified_meeting", input.referralId]);
  const inserted = await t.query<{ id: string }>(
    `insert into qualified_meeting
       (referral_id, held_at, icp_fit, decision_maker, potential_identified, program_registered,
        commercial_validated, validated_by, validator_label, idempotency_key, note)
     values ($1,$2,$3,$4,$5,true,$6,$7,$8,$9,$10)
     on conflict (referral_id) do nothing
     returning id`,
    [
      input.referralId, input.heldAt.toISOString(), input.requisites.icpFit,
      input.requisites.decisionMaker, input.requisites.potentialIdentified,
      input.requisites.commercialValidated, actor.identityId, actor.label, key, input.note ?? null,
    ],
  );
  if (!inserted[0]) {
    throw conflict("Esta oportunidade ja possui reuniao qualificada registrada.", {
      referralId: input.referralId,
    });
  }
  const meetingId = inserted[0].id;

  if (missing.length) {
    await recordAudit(t, actor, {
      action: "meeting.recorded", resourceType: "qualified_meeting", resourceId: meetingId,
      outcome: "allowed", reasonCode: "REQUISITES_NOT_MET",
      metadata: { missingCount: missing.length },
    });
    return { meetingId, awarded: false, amount: null, missing, registrationSource: "programa_win" };
  }

  const { version, rates } = await loadAwardTable(t);
  const rate = findRate(rates, "qualified_meeting", "collaborator");
  if (!rate || rate.kind !== "fixed" || !rate.fixed_amount) {
    throw validationFailed("A tabela vigente nao define o valor fixo da reuniao qualificada.");
  }
  const entry = await appendAwardEntry(t, actor, {
    referralId: input.referralId,
    staffId: referral.staff_id,
    beneficiary: "collaborator",
    situation: "qualified_meeting",
    amount: rate.fixed_amount,
    kind: "grant",
    ruleVersion: version,
    effectiveAt: input.heldAt,
    idempotencyKey: idempotencyKey(["award", "meeting", input.referralId]),
  });
  await recordAudit(t, actor, {
    action: "meeting.awarded", resourceType: "qualified_meeting", resourceId: meetingId,
    outcome: "allowed", metadata: { entryId: entry.id },
  });
  return {
    meetingId, awarded: true, amount: rate.fixed_amount, missing: [],
    registrationSource: "programa_win",
  };
}

/**
 * Secao 5 — teto de 12 meses para contratos recorrentes. A contagem parte do inicio da
 * prestacao; sem ele, da assinatura do contrato. Sem nenhum dos dois, a receita nao entra.
 */
export function withinFirstTwelveMonths(
  referral: Pick<ReferralRow, "contract_billing" | "contract_signed_at" | "service_started_at">,
  receivedAt: Date,
): { ok: boolean; reason?: string } {
  if (referral.contract_billing !== "recurring") return { ok: true };
  const startRaw = referral.service_started_at ?? referral.contract_signed_at;
  if (!startRaw) {
    return {
      ok: false,
      reason: "Contrato recorrente sem inicio de prestacao nem assinatura registrados (secao 5).",
    };
  }
  const start = new Date(startRaw);
  const limit = new Date(start);
  limit.setUTCFullYear(limit.getUTCFullYear() + 1);
  return receivedAt.getTime() <= limit.getTime()
    ? { ok: true }
    : { ok: false, reason: "Recebimento fora dos primeiros 12 meses do contrato (secao 5)." };
}

export interface RevenueInput {
  referralId: string;
  kind: "receipt" | "reversal";
  netAmount: string;      // string decimal: dinheiro nao passa por float
  receivedAt: Date;
  competenceDate: string; // AAAA-MM-DD
  sourceReference?: string;
  note?: string;
  /** Obrigatorio em estorno: qual recebimento esta sendo revertido (secao 8). */
  reversesEventId?: string;
}

export interface RevenueResult {
  revenueEventId: string;
  entries: Array<{ id: string; beneficiary: Beneficiary; amount: string; situation: AwardSituation }>;
  skipped: string[];
}

/**
 * Secao 8 — a premiacao nasce do RECEBIMENTO da receita, nao da assinatura.
 * Estorno entra como 'reversal' e produz lancamento compensatorio negativo.
 */
export async function recordRevenue(
  t: Queryable, actor: ActorContext, input: RevenueInput,
): Promise<RevenueResult> {
  const referral = await loadReferral(t, input.referralId);
  const skipped: string[] = [];
  const entries: RevenueResult["entries"] = [];

  if (referral.eligibility_status !== "eligible") {
    throw validationFailed(
      "Secao 6 da politica: a oportunidade precisa estar validada como elegivel pela Area " +
        "Comercial antes de qualquer apuracao.",
      { eligibilityStatus: referral.eligibility_status },
    );
  }
  if (!referral.opportunity_type) {
    throw validationFailed("A oportunidade nao tem tipo definido (secao 2 da politica).");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(input.netAmount)) {
    throw validationFailed("Valor de receita invalido. Use decimal com ate duas casas.");
  }
  if (decimalIsZero(input.netAmount)) {
    throw validationFailed("Valor de receita deve ser maior que zero.");
  }
  if (input.kind === "receipt") {
    await requireActiveRule(t, "RULE_CALCULATION_BASE");
    await requireActiveRule(t, "RULE_PAYMENT");
    const missingContract: string[] = [];
    if (!referral.contract_billing) missingContract.push("contractBilling");
    if (!referral.contract_signed_at) missingContract.push("contractSignedAt");
    if (!referral.service_started_at) missingContract.push("serviceStartedAt");
    if (missingContract.length) {
      throw validationFailed(
        "A premiacao percentual exige faturamento, assinatura do contrato e inicio da prestacao " +
          "registrados antes da receita recebida (secao 8 da politica).",
        { missing: missingContract },
      );
    }
    if (
      input.receivedAt < new Date(referral.contract_signed_at!) ||
      input.receivedAt < new Date(referral.service_started_at!)
    ) {
      throw validationFailed(
        "A receita recebida nao pode anteceder a assinatura do contrato ou o inicio da prestacao.",
      );
    }
  }
  if (input.kind === "reversal") {
    await requireActiveRule(t, "RULE_AWARD_ADJUSTMENT");
  }

  const eventKey = idempotencyKey([
    "revenue", input.referralId, input.kind, input.netAmount,
    input.competenceDate, input.sourceReference ?? "", input.reversesEventId ?? "",
  ]);
  let reversedReceipt: { id: string; net_amount: string } | null = null;
  if (input.kind === "reversal") {
    if (!input.reversesEventId) {
      throw validationFailed(
        "Estorno exige o recebimento que esta sendo revertido (secao 8 da politica).",
        { field: "reversesEventId" },
      );
    }
    const [original] = await t.query<{
      id: string; net_amount: string; kind: string;
      received_after_original: boolean; competence_after_original: boolean;
    }>(
      `select id, net_amount, kind,
              $3::timestamptz >= received_at received_after_original,
              $4::date >= competence_date competence_after_original
         from revenue_event
        where id = $1 and referral_id = $2 for update`,
      [
        input.reversesEventId, input.referralId, input.receivedAt.toISOString(),
        input.competenceDate,
      ],
    );
    if (!original) {
      throw validationFailed("Recebimento a reverter nao encontrado nesta oportunidade.");
    }
    if (original.kind !== "receipt") {
      throw validationFailed("So um recebimento pode ser revertido.");
    }
    if (!original.received_after_original || !original.competence_after_original) {
      throw validationFailed("O estorno nao pode anteceder o recebimento que ele reverte.");
    }
    // A trava do recebimento serializa tanto a repeticao identica quanto estornos concorrentes.
    const [replay] = await t.query<{ id: string }>(
      `select id from revenue_event where idempotency_key = $1`, [eventKey],
    );
    if (replay) {
      return { revenueEventId: replay.id, entries: [], skipped: ["IDEMPOTENT_REPLAY"] };
    }
    const [saldo] = await t.query<{ disponivel: string; suficiente: boolean }>(
      `select
         ($2::numeric - coalesce(sum(net_amount), 0))::numeric(14,2) disponivel,
         $3::numeric <= ($2::numeric - coalesce(sum(net_amount), 0)) suficiente
         from revenue_event where reverses_event_id = $1`,
      [original.id, original.net_amount, input.netAmount],
    );
    if (!saldo?.suficiente) {
      throw validationFailed(
        "Estorno maior do que o saldo do recebimento informado.",
        { disponivel: saldo?.disponivel ?? "0.00", solicitado: input.netAmount },
      );
    }
    reversedReceipt = { id: original.id, net_amount: original.net_amount };
  }

  const inserted = await t.query<{ id: string }>(
    `insert into revenue_event
       (referral_id, kind, net_amount, competence_date, received_at, actor_identity_id,
        actor_label, source_reference, idempotency_key, note, reverses_event_id)
     values ($1,$2::revenue_kind,$3::numeric,$4::date,$5,$6,$7,$8,$9,$10,$11)
     on conflict (idempotency_key) do nothing
     returning id`,
    [
      input.referralId, input.kind, input.netAmount, input.competenceDate,
      input.receivedAt.toISOString(), actor.identityId, actor.label,
      input.sourceReference ?? null, eventKey, input.note ?? null,
      input.reversesEventId ?? null,
    ],
  );
  if (!inserted[0]) {
    const existing = await t.query<{ id: string }>(
      `select id from revenue_event where idempotency_key = $1`, [eventKey],
    );
    return { revenueEventId: existing[0]!.id, entries: [], skipped: ["IDEMPOTENT_REPLAY"] };
  }
  const revenueEventId = inserted[0].id;

  if (input.kind === "reversal") {
    const originalEntries = await t.query<{
      id: string; staff_id: string; beneficiary: Beneficiary; situation: AwardSituation;
      amount: string; rate_applied: string | null; rule_version: number;
    }>(
      `select id, staff_id, beneficiary::text, situation::text, amount, rate_applied, rule_version
         from award_ledger
        where revenue_event_id = $1 and kind = 'grant'
        order by id`,
      [reversedReceipt!.id],
    );
    for (const original of originalEntries) {
      const [computed] = await t.query<{ amount: string }>(
        `select ((
           round(
             abs($1::numeric) *
             (select coalesce(sum(net_amount), 0) from revenue_event
               where reverses_event_id = $2) /
             $3::numeric,
             2
           ) -
           (select coalesce(sum(abs(amount)), 0) from award_ledger
             where correction_of_entry_id = $4 and kind = 'reversal')
         ) * -1)::numeric(14,2) amount`,
        [original.amount, reversedReceipt!.id, reversedReceipt!.net_amount, original.id],
      );
      if (decimalIsZero(computed!.amount)) {
        skipped.push("Valor do estorno igual a zero apos arredondamento.");
        continue;
      }
      const entry = await appendAwardEntry(t, actor, {
        referralId: input.referralId,
        staffId: original.staff_id,
        beneficiary: original.beneficiary,
        situation: original.situation,
        amount: computed!.amount,
        baseAmount: input.netAmount,
        ...(original.rate_applied ? { rateApplied: original.rate_applied } : {}),
        kind: "reversal",
        ruleVersion: original.rule_version,
        effectiveAt: input.receivedAt,
        revenueEventId,
        correctionOfEntryId: original.id,
        reason: "Estorno vinculado ao recebimento e ao lancamento originais.",
        idempotencyKey: idempotencyKey(["award-reversal", revenueEventId, original.id]),
      });
      entries.push({
        id: entry.id,
        beneficiary: original.beneficiary,
        amount: computed!.amount,
        situation: original.situation,
      });
    }
    await recordAudit(t, actor, {
      action: "revenue.reversed", resourceType: "revenue_event", resourceId: revenueEventId,
      outcome: "allowed",
      metadata: { originalRevenueEventId: reversedReceipt!.id, entries: entries.length },
    });
    return { revenueEventId, entries, skipped };
  }

  const window = withinFirstTwelveMonths(referral, input.receivedAt);
  if (!window.ok) {
    await recordAudit(t, actor, {
      action: "revenue.recorded", resourceType: "revenue_event", resourceId: revenueEventId,
      outcome: "allowed", reasonCode: "OUT_OF_12_MONTH_WINDOW",
    });
    return { revenueEventId, entries: [], skipped: [window.reason!] };
  }

  const { version, rates } = await loadAwardTable(t);
  const originatedByManager =
    referral.manager_staff_id !== null && referral.manager_staff_id === referral.staff_id;
  const situation = situationFor(referral.opportunity_type, originatedByManager);
  const beneficiaries: Array<{ role: Beneficiary; staffId: string | null }> = [
    { role: "collaborator", staffId: referral.staff_id },
    { role: "manager", staffId: referral.manager_staff_id },
  ];

  for (const beneficiary of beneficiaries) {
    const rate = findRate(rates, situation, beneficiary.role);
    if (!rate || rate.kind !== "percentage" || !rate.rate) continue;
    if (!beneficiary.staffId) {
      skipped.push(`Sem gestor vinculado: a parcela de ${beneficiary.role} nao foi apurada.`);
      continue;
    }
    // Secao 3: na linha "novo cliente originado diretamente pelo gestor" quem recebe e o gestor.
    if (situation === "new_client_by_manager" && beneficiary.role === "collaborator") continue;

    const [computed] = await t.query<{ amount: string }>(
      `select (($1::numeric * $2::numeric))::numeric(14,2) as amount`,
      [input.netAmount, rate.rate],
    );
    const amount = computed!.amount;
    if (decimalIsZero(computed!.amount)) {
      skipped.push("Valor apurado igual a zero apos arredondamento.");
      continue;
    }
    const entry = await appendAwardEntry(t, actor, {
      referralId: input.referralId,
      staffId: beneficiary.staffId,
      beneficiary: beneficiary.role,
      situation,
      amount,
      baseAmount: input.netAmount,
      rateApplied: rate.rate,
      kind: "grant",
      ruleVersion: version,
      effectiveAt: input.receivedAt,
      revenueEventId,
      reason: null,
      idempotencyKey: idempotencyKey(["award", revenueEventId, beneficiary.role]),
    });
    entries.push({ id: entry.id, beneficiary: beneficiary.role, amount, situation });
  }

  await recordAudit(t, actor, {
    action: "revenue.recorded", resourceType: "revenue_event", resourceId: revenueEventId,
    outcome: "allowed", metadata: { kind: input.kind, entries: entries.length },
  });
  return { revenueEventId, entries, skipped };
}

interface AwardEntryInput {
  referralId: string;
  staffId: string;
  beneficiary: Beneficiary;
  situation: AwardSituation;
  amount: string;
  baseAmount?: string;
  rateApplied?: string;
  kind: "grant" | "reversal" | "adjustment" | "correction";
  ruleVersion: number;
  effectiveAt: Date;
  revenueEventId?: string;
  correctionOfEntryId?: string | null;
  reason?: string | null;
  idempotencyKey: string;
}

/** Ledger monetario append-only. Repeticao com a mesma chave nao duplica. */
export async function appendAwardEntry(
  t: Queryable, actor: ActorContext, input: AwardEntryInput,
): Promise<{ id: string; created: boolean }> {
  if (input.correctionOfEntryId && !input.reason) {
    throw validationFailed("Correcao exige motivo (RULE_AWARD_ADJUSTMENT).");
  }
  const rows = await t.query<{ id: string }>(
    `insert into award_ledger
       (referral_id, staff_id, beneficiary, situation, amount, base_amount, rate_applied, kind,
        revenue_event_id, rule_key, rule_version, effective_at, actor_identity_id, actor_label,
        correction_of_entry_id, reason, idempotency_key)
     values ($1,$2,$3::award_beneficiary,$4::award_situation,$5::numeric,$6::numeric,$7::numeric,
             $8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     on conflict (idempotency_key) do nothing
     returning id`,
    [
      input.referralId, input.staffId, input.beneficiary, input.situation, input.amount,
      input.baseAmount ?? null, input.rateApplied ?? null, input.kind,
      input.revenueEventId ?? null, AWARD_RULE_KEY, input.ruleVersion,
      input.effectiveAt.toISOString(), actor.identityId, actor.label,
      input.correctionOfEntryId ?? null, input.reason ?? null, input.idempotencyKey,
    ],
  );
  if (rows[0]) return { id: rows[0].id, created: true };
  const existing = await t.query<{ id: string }>(
    `select id from award_ledger where idempotency_key = $1`, [input.idempotencyKey],
  );
  return { id: existing[0]!.id, created: false };
}

/** Secao 8: nada e pago sem aprovacao da Diretoria. O lote e o portao. */
export async function approvePayoutBatch(
  t: Queryable, actor: ActorContext, batchId: string,
): Promise<{ id: string; status: string }> {
  if (!actor.roles.includes("diretoria")) {
    throw forbidden("Secao 8 da politica: a aprovacao do lote e da Diretoria.");
  }
  await requireActiveRule(t, "RULE_PAYMENT");
  const [batch] = await t.query<{ id: string; status: string }>(
    `select id, status from payout_batch where id = $1 for update`,
    [batchId],
  );
  if (!batch || batch.status !== "open") {
    throw conflict("Lote inexistente ou fora do estado 'open'.", { batchId });
  }
  const [balance] = await t.query<{ total: string; positive: boolean }>(
    `select coalesce(sum(l.amount), 0)::numeric(14,2) total,
            coalesce(sum(l.amount), 0) > 0 positive
       from payout_item i join award_ledger l on l.id = i.award_entry_id
      where i.batch_id = $1`,
    [batchId],
  );
  if (!balance?.positive) {
    throw validationFailed("Lote com saldo zero ou negativo nao pode ser aprovado.", {
      batchId, total: balance?.total ?? "0.00",
    });
  }
  const rows = await t.query<{ id: string; status: string }>(
    `update payout_batch set status = 'approved', approved_by = $2, approver_label = $3,
            approved_at = now()
      where id = $1 and status = 'open'
      returning id, status`,
    [batchId, actor.identityId, actor.label],
  );
  if (!rows[0]) throw conflict("O lote mudou durante a aprovacao.", { batchId });
  await recordAudit(t, actor, {
    action: "payout.approved", resourceType: "payout_batch", resourceId: batchId,
    outcome: "allowed",
  });
  return rows[0];
}

/** Extrato do proprio participante, em reais. */
export async function awardStatement(t: Queryable, staffId: string) {
  const [balance] = await t.query<{ balance: string | null; entries: number }>(
    `select coalesce(sum(amount), 0)::numeric(14,2) as balance, count(*)::int as entries
       from award_ledger where staff_id = $1`,
    [staffId],
  );
  const entries = await t.query(
    `select situation::text, beneficiary::text, amount, base_amount, rate_applied, kind,
            effective_at
       from award_ledger where staff_id = $1 order by effective_at desc limit 50`,
    [staffId],
  );
  const rule = await findActiveRule(t, AWARD_RULE_KEY);
  return {
    currency: "BRL",
    balance: balance?.balance ?? "0.00",
    entryCount: balance?.entries ?? 0,
    ruleVersion: rule?.version ?? null,
    entries,
  };
}
