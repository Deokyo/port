import { createHash } from "node:crypto";
import type { Db, Queryable, ActorContext } from "../db/client";
import { env } from "../config/env";
import { AppError, conflict, notFound, pendingRule, validationFailed } from "../lib/errors";
import { parseCsv } from "../lib/csv";
import { parseSheetDate } from "../lib/dates";
import { normalizeKey } from "../lib/text";
import { readXlsx, looksLikeXlsx } from "./xlsx";
import {
  computeDuplicateFingerprint, isMoreAdvanced, registerTitularityConflict, stageFromSheetLabel,
  type ReferralStage,
} from "../domain/referral-stages";
import { findActiveRule } from "../domain/rules";
import { appendLedgerEntry, computeStagePoints, ledgerIdempotencyKey, simulateStagePoints } from "../domain/points";
import { recordAudit } from "../modules/audit";

/**
 * Fase 5 — pipeline server-side: upload -> validacao -> staging -> validacao de linha ->
 * previa -> confirmacao explicita -> processamento transacional -> relatorio -> auditoria.
 * A planilha deixa de ser autoridade: pontos vem do servidor, identidade vem da matricula.
 */

/** Colunas conhecidas. Cabecalho desconhecido nao quebra, mas e reportado e ignorado. */
const COLUMN_ALIASES: Record<string, string[]> = {
  staffCode: ["matricula", "id_funcionario", "codigo do funcionario", "codigo funcionario"],
  clientCompany: ["empresa", "cliente"],
  service: ["produto", "servico", "subproduto"],
  status: ["status", "etapa", "fase"],
  occurredAt: ["data", "data da indicacao", "criado em"],
  externalReference: ["referencia", "id externo", "codigo interno"],
  // Sem tipo e gestor, so a reuniao qualificada e apuravel — o percentual fica inalcancavel.
  opportunityType: ["tipo", "tipo de oportunidade", "modalidade"],
  managerCode: ["gestor", "matricula do gestor", "matricula gestor"],
  // Presente por compatibilidade: e SEMPRE ignorado (ALTO-02).
  ignoredPoints: ["pontos", "pontuacao", "win points"],
  ignoredName: ["nome", "participante", "colaborador"],
};
const REQUIRED = ["staffCode", "clientCompany", "service", "status", "occurredAt"] as const;

/** Secao 2 da politica. Fora desta lista o tipo fica nulo e so a reuniao qualificada pontua. */
const OPPORTUNITY_TYPE_ALIASES: Record<string, string> = {
  "novo cliente": "new_client",
  "novo servico": "new_service",
  "cross-sell": "cross_sell",
  "cross sell": "cross_sell",
  "up-sell": "up_sell",
  "up sell": "up_sell",
};

export interface UploadInput {
  filename: string;
  buffer: Buffer;
  declaredMime?: string;
  referenceDate: string; // YYYY-MM-DD, usado apenas para rotular o job
  sheetName?: string;
}

export interface ImportJobSummary {
  id: string;
  status: string;
  filename: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  createdByLabel: string;
  createdAt: string;
  confirmedAt: string | null;
  summary: Record<string, unknown>;
  replay?: boolean;
}

function detectFormat(input: UploadInput): "xlsx" | "csv" {
  const ext = input.filename.split(".").pop()?.toLowerCase();
  if (ext === "xlsx") {
    if (!looksLikeXlsx(input.buffer)) {
      throw new AppError("UNSUPPORTED_MEDIA", "Extensao .xlsx mas o conteudo nao e um ZIP/XLSX.");
    }
    return "xlsx";
  }
  if (ext === "csv") {
    if (looksLikeXlsx(input.buffer)) {
      throw new AppError("UNSUPPORTED_MEDIA", "Extensao .csv mas o conteudo e binario.");
    }
    return "csv";
  }
  throw new AppError("UNSUPPORTED_MEDIA", "Formato nao suportado. Envie .xlsx ou .csv.");
}

function mapHeaders(header: readonly unknown[]) {
  const normalized = header.map(normalizeKey);
  const index: Record<string, number> = {};
  const unknown: string[] = [];
  normalized.forEach((cell, position) => {
    if (!cell) return;
    const field = Object.entries(COLUMN_ALIASES).find(([, aliases]) => aliases.includes(cell))?.[0];
    if (field) {
      if (index[field] === undefined) index[field] = position;
    } else unknown.push(cell);
  });
  const missing = REQUIRED.filter((f) => index[f] === undefined);
  return { index, unknown, missing };
}

export async function createImportJob(
  db: Db, actor: ActorContext, input: UploadInput,
): Promise<ImportJobSummary> {
  const cfg = env();
  if (input.buffer.length === 0) throw validationFailed("Arquivo vazio.");
  if (input.buffer.length > cfg.IMPORT_MAX_UPLOAD_BYTES) {
    throw new AppError("PAYLOAD_TOO_LARGE", "Arquivo excede o limite de upload.");
  }
  const format = detectFormat(input);
  const contentHash = createHash("sha256").update(input.buffer).digest("hex");
  const idempotencyKey = createHash("sha256")
    .update(`${contentHash}|${input.referenceDate}|${input.sheetName ?? ""}|v1`)
    .digest("hex");

  const existing = await db.tx(actor, async (t) =>
    t.query<{ id: string }>("select id from import_job where idempotency_key = $1", [idempotencyKey]),
  );
  if (existing[0]) {
    const summary = await getImportJob(db, actor, existing[0].id);
    return { ...summary, replay: true };
  }

  // Parsing fora da transacao: leitura de arquivo nao deve segurar conexao de banco.
  let sheetInfo: { sheetName: string; selectionMethod: string } | null = null;
  let rows: (string | number | boolean)[][] | string[][];
  if (format === "csv") {
    rows = parseCsv(input.buffer.toString("utf8"), cfg.IMPORT_MAX_ROWS);
  } else {
    const read = readXlsx(input.buffer, {
      maxUncompressedBytes: cfg.IMPORT_MAX_UNCOMPRESSED_BYTES,
      maxRows: cfg.IMPORT_MAX_ROWS,
      sheetName: input.sheetName,
    });
    rows = read.rows;
    sheetInfo = { sheetName: read.sheetName, selectionMethod: read.selectionMethod };
  }

  if (!rows.length) throw validationFailed("A planilha nao possui linhas.");
  const { index, unknown, missing } = mapHeaders(rows[0] ?? []);
  if (missing.length) {
    throw validationFailed(
      `Colunas obrigatorias ausentes: ${missing.map((m) => COLUMN_ALIASES[m]![0]!.toUpperCase()).join(", ")}.`,
      { missing },
    );
  }

  return db.tx(actor, async (t) => {
    const [job] = await t.query<{ id: string }>(
      `insert into import_job
         (filename, content_hash, idempotency_key, byte_size, format, status, reference_date,
          created_by, created_by_label, catalog_version_id)
       values ($1,$2,$3,$4,$5,'validating',$6,$7,$8,
               (select id from catalog_version where status='active' order by effective_from desc limit 1))
       returning id`,
      [
        input.filename, contentHash, idempotencyKey, input.buffer.length, format,
        input.referenceDate, actor.identityId, actor.label,
      ],
    );
    const jobId = job!.id;
    const stats = await stageRows(t, jobId, rows, index);

    const warnings: string[] = [];
    if (index.ignoredPoints !== undefined) {
      warnings.push("Coluna PONTOS encontrada e IGNORADA: a pontuacao e derivada no servidor (ALTO-02).");
    }
    if (index.ignoredName !== undefined) {
      warnings.push("Coluna NOME e apenas informativa: a identidade vem da MATRICULA (ALTO-03).");
    }
    if (unknown.length) warnings.push(`Colunas desconhecidas ignoradas: ${unknown.join(", ")}.`);
    if (sheetInfo?.selectionMethod === "convention") {
      warnings.push(
        `Aba "${sheetInfo.sheetName}" escolhida por convencao do gabarito. ` +
          "Envie o nome da aba explicitamente para importar outra.",
      );
    }

    const status = stats.valid > 0 ? "awaiting_confirmation" : "rejected";
    await t.query(
      `update import_job set status = $2, total_rows = $3, valid_rows = $4, invalid_rows = $5,
              summary = $6::jsonb, updated_at = now() where id = $1`,
      [
        jobId, status, stats.total, stats.valid, stats.invalid,
        JSON.stringify({
          warnings, errorsByCode: stats.errorsByCode, duplicates: stats.duplicates,
          progressions: stats.progressions,
          // Rastro de QUAL aba foi lida e COMO foi escolhida (exigencia de auditoria).
          sheetName: sheetInfo?.sheetName ?? null,
          selectionMethod: sheetInfo?.selectionMethod ?? null,
        }),
      ],
    );
    await recordAudit(t, actor, {
      action: "import.staged",
      resourceType: "import_job",
      resourceId: jobId,
      outcome: "allowed",
      metadata: {
        total: stats.total, valid: stats.valid, invalid: stats.invalid,
        sheetName: sheetInfo?.sheetName ?? null,
        selectionMethod: sheetInfo?.selectionMethod ?? null,
      },
    });
    return readJob(t, jobId);
  });
}

async function stageRows(
  t: Queryable, jobId: string, rows: readonly (readonly unknown[])[], index: Record<string, number>,
) {
  const cfg = env();
  const errorsByCode: Record<string, number> = {};
  let valid = 0;
  let invalid = 0;
  let duplicates = 0;
  let progressions = 0;
  const seenFingerprints = new Set<string>();

  const staffRows = await t.query<{ id: string; external_code: string }>(
    "select id, external_code from staff_member where status = 'active'",
  );
  const staffByCode = new Map(staffRows.map((s) => [normalizeKey(s.external_code), s.id]));
  const aliasRows = await t.query<{ service_id: string; alias_key: string }>(
    `select sa.service_id, sa.alias_key from service_alias sa
       join catalog_version cv on cv.id = sa.catalog_version_id and cv.status = 'active'`,
  );
  const serviceByAlias = new Map(aliasRows.map((a) => [a.alias_key, a.service_id]));

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const rowNumber = i + 1;
    const isBlank = row.every((cell) => String(cell ?? "").trim() === "");
    if (isBlank) continue;

    const cell = (field: string) => {
      const position = index[field];
      return position === undefined ? "" : row[position];
    };
    const raw = {
      staffCode: String(cell("staffCode") ?? "").trim(),
      clientCompany: String(cell("clientCompany") ?? "").trim(),
      service: String(cell("service") ?? "").trim(),
      status: String(cell("status") ?? "").trim(),
      occurredAt: cell("occurredAt"),
      externalReference: String(cell("externalReference") ?? "").trim() || null,
      opportunityTypeRaw: String(cell("opportunityType") ?? "").trim(),
      opportunityType: OPPORTUNITY_TYPE_ALIASES[normalizeKey(cell("opportunityType"))] ?? null,
      managerCode: String(cell("managerCode") ?? "").trim() || null,
    };

    let errorCode: string | null = null;
    let errorField: string | null = null;
    const staffId = staffByCode.get(normalizeKey(raw.staffCode)) ?? null;
    const serviceId = serviceByAlias.get(normalizeKey(raw.service)) ?? null;
    const stage = stageFromSheetLabel(raw.status);
    const parsedDate = parseSheetDate(raw.occurredAt, cfg.APP_TIMEZONE);

    if (!raw.staffCode) { errorCode = "MISSING_STAFF_CODE"; errorField = "MATRICULA"; }
    else if (!staffId) { errorCode = "UNKNOWN_STAFF"; errorField = "MATRICULA"; }
    else if (!raw.clientCompany) { errorCode = "MISSING_CLIENT"; errorField = "EMPRESA"; }
    else if (!serviceId) { errorCode = "UNKNOWN_SERVICE"; errorField = "PRODUTO"; }
    else if (!stage) { errorCode = "UNKNOWN_STATUS"; errorField = "STATUS"; }
    else if (!parsedDate.ok) { errorCode = `INVALID_DATE_${parsedDate.code}`; errorField = "DATA"; }
    /*
     * TIPO e GESTOR sao opcionais, mas PREENCHIDOS ERRADOS nao podem virar null em silencio:
     * a linha entraria sem tipo (e nunca geraria premiacao percentual) ou sem gestor (e a
     * parcela dele sumiria), sem ninguem perceber. Preenchido e invalido = linha invalida.
     */
    else if (raw.opportunityTypeRaw && !raw.opportunityType) {
      errorCode = "UNKNOWN_OPPORTUNITY_TYPE"; errorField = "TIPO";
    } else if (raw.managerCode && !staffByCode.get(normalizeKey(raw.managerCode))) {
      errorCode = "UNKNOWN_MANAGER"; errorField = "GESTOR";
    }

    let rowStatus: string = errorCode ? "invalid" : "valid";
    let fingerprint: string | null = null;
    let progressionOf: string | null = null;
    let previousStage: ReferralStage | null = null;

    if (!errorCode && staffId && serviceId && stage && parsedDate.ok) {
      const dup = await computeDuplicateFingerprint(t, {
        staffId, serviceId, clientCompany: raw.clientCompany, occurredAt: parsedDate.value,
      });
      if (dup) {
        fingerprint = dup.fingerprint;
        const [clash] = await t.query<{ id: string; current_stage: ReferralStage; staff_id: string }>(
          `select id, current_stage, staff_id from referral
            where dedupe_fingerprint = $1 and status = 'active' limit 1`,
          [dup.fingerprint],
        );
        if (clash) {
          /*
           * D-28: no piloto por planilha a MESMA oportunidade reaparece a cada ciclo com o
           * status atualizado. Tratar isso como "duplicata" faria o programa parar de produzir
           * depois do primeiro mes. Entao: mesmo colaborador + etapa mais avancada = PROGRESSAO.
           */
          if (clash.staff_id === staffId && isMoreAdvanced(clash.current_stage, stage)) {
            progressionOf = clash.id;
            previousStage = clash.current_stage;
            progressions += 1;
          } else {
            rowStatus = "duplicate";
            duplicates += 1;
          }
        } else if (seenFingerprints.has(dup.fingerprint)) {
          rowStatus = "duplicate";
          duplicates += 1;
        } else seenFingerprints.add(dup.fingerprint);
      }
    }

    if (errorCode) {
      invalid += 1;
      errorsByCode[errorCode] = (errorsByCode[errorCode] ?? 0) + 1;
    } else if (rowStatus === "valid") valid += 1;

    await t.query(
      `insert into import_row
         (import_job_id, row_number, raw, normalized, staff_id, service_id, stage, occurred_at,
          status, error_code, error_field)
       values ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7::referral_stage,$8,$9,$10,$11)`,
      [
        jobId, rowNumber,
        JSON.stringify(raw),
        JSON.stringify({ fingerprint, progressionOf, previousStage }),
        staffId, serviceId, stage, parsedDate.ok ? parsedDate.value.toISOString() : null,
        rowStatus, errorCode, errorField,
      ],
    );
  }
  return {
    total: valid + invalid + duplicates, valid, invalid, duplicates, progressions, errorsByCode,
  };
}

async function readJob(t: Queryable, jobId: string): Promise<ImportJobSummary> {
  const rows = await t.query<{
    id: string; status: string; filename: string; total_rows: number; valid_rows: number;
    invalid_rows: number; created_by_label: string; created_at: string; confirmed_at: string | null;
    summary: Record<string, unknown>;
  }>(
    `select id, status, filename, total_rows, valid_rows, invalid_rows, created_by_label,
            created_at, confirmed_at, summary from import_job where id = $1`,
    [jobId],
  );
  const job = rows[0];
  if (!job) throw notFound("Importacao nao encontrada.");
  const dup = await t.query<{ c: number }>(
    "select count(*)::int c from import_row where import_job_id = $1 and status = 'duplicate'",
    [jobId],
  );
  return {
    id: job.id, status: job.status, filename: job.filename, totalRows: job.total_rows,
    validRows: job.valid_rows, invalidRows: job.invalid_rows, duplicateRows: dup[0]?.c ?? 0,
    createdByLabel: job.created_by_label, createdAt: job.created_at, confirmedAt: job.confirmed_at,
    summary: job.summary ?? {},
  };
}

export async function getImportJob(db: Db, actor: ActorContext, jobId: string) {
  return db.tx(actor, (t) => readJob(t, jobId));
}

/** Previa sem PII: apenas agregados, contagens por erro e impacto SIMULADO de pontos. */
export async function previewImport(db: Db, actor: ActorContext, jobId: string) {
  return db.tx(actor, async (t) => {
    const job = await readJob(t, jobId);
    const byStage = await t.query<{ stage: ReferralStage; c: number }>(
      `select stage, count(*)::int c from import_row
        where import_job_id = $1 and status = 'valid' and stage is not null group by stage`,
      [jobId],
    );
    const byTerritory = await t.query<{ territory: string; c: number }>(
      `select tr.name territory, count(*)::int c
         from import_row ir join service s on s.id = ir.service_id
         join territory tr on tr.id = s.territory_id
        where ir.import_job_id = $1 and ir.status = 'valid' group by tr.name order by 2 desc`,
      [jobId],
    );
    const errors = await t.query<{ error_code: string; error_field: string; c: number }>(
      `select error_code, error_field, count(*)::int c from import_row
        where import_job_id = $1 and status = 'invalid'
        group by error_code, error_field order by 3 desc`,
      [jobId],
    );
    const sampleRows = await t.query<{ row_number: number; error_code: string; error_field: string }>(
      `select row_number, error_code, error_field from import_row
        where import_job_id = $1 and status = 'invalid' order by row_number limit 20`,
      [jobId],
    );

    let simulatedPoints = 0;
    let pointsSimulated = false;
    for (const entry of byStage) {
      const computed = await computeStagePoints(t, entry.stage);
      if (computed) simulatedPoints += computed.amount * entry.c;
      else {
        const sim = await simulateStagePoints(t, entry.stage);
        if (sim) { simulatedPoints += sim.amount * entry.c; pointsSimulated = true; }
      }
    }
    const pointsRule = await findActiveRule(t, "RULE_POINTS_ACCRUAL");
    const duplicateRule = await findActiveRule(t, "RULE_DUPLICATE_KEY");

    return {
      job,
      byStage,
      byTerritory,
      errors,
      sampleRows, // apenas numero da linha e codigo do erro: sem dado da planilha
      points: {
        total: simulatedPoints,
        simulated: pointsSimulated || !pointsRule,
        ruleApproved: Boolean(pointsRule),
        note: pointsRule
          ? "Pontos serao lancados no ledger na confirmacao."
          : "SIMULACAO. RULE_POINTS_ACCRUAL nao aprovada: nenhum ponto sera lancado (D-03).",
      },
      canConfirm: Boolean(duplicateRule) && job.validRows > 0 && job.status === "awaiting_confirmation",
      blockedBy: duplicateRule ? [] : ["RULE_DUPLICATE_KEY"],
    };
  });
}

/**
 * Confirmacao transacional e idempotente. Duas confirmacoes simultaneas do mesmo job:
 * a segunda encontra o job travado (for update) e ja concluido -> 409.
 */
export interface ConferenceAttestation {
  /** Quem confirma declara que conferiu manualmente as linhas do arquivo (D-27). */
  attested: boolean;
  note?: string;
}

export async function confirmImport(
  db: Db, actor: ActorContext, jobId: string, conference?: ConferenceAttestation,
) {
  /*
   * D-27: a regra operacional declara atestacao OBRIGATORIA. Antes, o parametro tinha default
   * `false` e a importacao consolidava — e pontuava — sem ninguem atestar nada.
   *
   * A checagem fica FORA da transacao principal de proposito: se ela ficasse dentro, o evento
   * de auditoria da recusa seria desfeito pelo mesmo rollback que impede a consolidacao, e a
   * negacao nao deixaria rastro nenhum.
   */
  const operating = await db.tx(actor, (t) => findActiveRule(t, "RULE_OPERATING_MODEL"));
  if (!operating) {
    await db.tx(actor, (t) =>
      recordAudit(t, actor, {
        action: "import.confirm", resourceType: "import_job", resourceId: jobId,
        outcome: "denied", reasonCode: "RULE_OPERATING_MODEL_PENDING",
      }));
    throw pendingRule("RULE_OPERATING_MODEL");
  }
  if (operating.definition.attestationRequired === true && !conference?.attested) {
    await db.tx(actor, (t) =>
      recordAudit(t, actor, {
        action: "import.confirm", resourceType: "import_job", resourceId: jobId,
        outcome: "denied", reasonCode: "CONFERENCE_NOT_ATTESTED",
      }));
    throw new AppError(
      "VALIDATION_FAILED",
      "A conferencia manual e obrigatoria (RULE_OPERATING_MODEL). Confirme declarando " +
        "explicitamente que conferiu as linhas: sem atestacao nada e consolidado nem pontuado.",
      { ruleKey: "RULE_OPERATING_MODEL", field: "attestConference" },
    );
  }

  // Pre-checagem fora da transacao principal: a negacao precisa sobreviver ao rollback.
  const approvedBeforeStart = await db.tx(actor, (t) => findActiveRule(t, "RULE_DUPLICATE_KEY"));
  if (!approvedBeforeStart) {
    await db.tx(actor, (t) =>
      recordAudit(t, actor, {
        action: "import.confirm", resourceType: "import_job", resourceId: jobId,
        outcome: "denied", reasonCode: "RULE_DUPLICATE_KEY_PENDING",
      }));
    throw new AppError(
      "PENDING_BUSINESS_RULE",
      "A regra de duplicidade (D-04) nao foi aprovada. A importacao permanece em previa: " +
        "consolidar agora criaria indicacoes sem criterio de duplicidade auditavel.",
      { ruleKey: "RULE_DUPLICATE_KEY" },
    );
  }

  return db.tx(actor, async (t) => {
    const locked = await t.query<{ id: string; status: string; valid_rows: number }>(
      `select id, status, valid_rows from import_job where id = $1 for update`,
      [jobId],
    );
    const job = locked[0];
    if (!job) throw notFound("Importacao nao encontrada.");
    if (job.status === "completed") {
      throw conflict("Esta importacao ja foi confirmada.", { jobId, status: job.status });
    }
    if (job.status !== "awaiting_confirmation") {
      throw conflict(`Importacao no estado ${job.status} nao pode ser confirmada.`, { jobId });
    }
    // ALTO-05: releitura dentro da transacao — a aprovacao pode ter sido revogada no intervalo.
    const duplicateRule = await findActiveRule(t, "RULE_DUPLICATE_KEY");
    if (!duplicateRule) throw pendingRule("RULE_DUPLICATE_KEY");

    await t.query(`update import_job set status = 'confirming', updated_at = now() where id = $1`, [jobId]);
    const rows = await t.query<{
      id: string; staff_id: string; service_id: string; stage: ReferralStage;
      occurred_at: string;
      raw: {
        clientCompany: string; externalReference: string | null;
        opportunityType: string | null; managerCode: string | null;
      };
      normalized: {
        fingerprint: string | null;
        progressionOf?: string | null;
        previousStage?: ReferralStage | null;
      };
    }>(
      `select id, staff_id, service_id, stage, occurred_at, raw, normalized
         from import_row where import_job_id = $1 and status = 'valid' order by row_number`,
      [jobId],
    );

    const pointsRule = await findActiveRule(t, "RULE_POINTS_ACCRUAL");
    let created = 0;
    let ledgerEntries = 0;

    let progressed = 0;
    for (const row of rows) {
      const occurredAt = new Date(row.occurred_at);

      /*
       * Progressao: a planilha do ciclo trouxe a MESMA oportunidade em etapa mais avancada.
       * Nao se cria indicacao nova — registra-se o avanco e, com a regra de pontos vigente,
       * lanca-se a pontuacao da etapa alcancada (cumulativa por decisao de 2026-09-03).
       */
      const progressionOf = row.normalized?.progressionOf ?? null;
      if (progressionOf) {
        const eventKey = ledgerIdempotencyKey(["progress", jobId, row.id, row.stage]);
        const inserted = await t.query<{ id: string }>(
          `insert into referral_stage_event
             (referral_id, from_stage, to_stage, occurred_at, actor_identity_id, actor_label,
              idempotency_key, rule_version, note)
           values ($1,$2::referral_stage,$3::referral_stage,$4,$5,$6,$7,$8,$9)
           on conflict (referral_id, idempotency_key) do nothing
           returning id`,
          [
            progressionOf, row.normalized?.previousStage ?? null, row.stage,
            occurredAt.toISOString(), actor.identityId, actor.label, eventKey,
            `RULE_DUPLICATE_KEY@${duplicateRule.version}`,
            "Avanco trazido pela planilha do ciclo (D-28).",
          ],
        );
        if (!inserted[0]) {
          await t.query(`update import_row set status = 'skipped' where id = $1`, [row.id]);
          continue;
        }
        await t.query(
          `update referral set current_stage = $2::referral_stage, updated_at = now()
            where id = $1`,
          [progressionOf, row.stage],
        );
        if (pointsRule) {
          const computed = await computeStagePoints(t, row.stage);
          if (computed && computed.amount !== 0) {
            await appendLedgerEntry(t, {
              staffId: row.staff_id, referralId: progressionOf, stage: row.stage,
              amount: computed.amount, kind: "grant", origin: "import",
              ruleKey: computed.ruleKey, ruleVersion: computed.ruleVersion,
              effectiveAt: occurredAt, actorIdentityId: actor.identityId,
              actorLabel: actor.label,
              idempotencyKey: ledgerIdempotencyKey(["import", jobId, row.id, row.stage]),
            });
            ledgerEntries += 1;
          }
        }
        await t.query(
          `update import_row set status = 'applied', referral_id = $2 where id = $1`,
          [row.id, progressionOf],
        );
        progressed += 1;
        continue;
      }
      const [referral] = await t.query<{ id: string }>(
        `insert into referral
           (staff_id, service_id, client_company, client_reference, current_stage, occurred_at,
            dedupe_fingerprint, source, source_import_job_id, created_by,
            opportunity_type, manager_staff_id)
         values ($1,$2,$3,$4,$5::referral_stage,$6,$7,'import',$8,$9,
                 $10::opportunity_type,
                 (select id from staff_member where external_code = $11))
         on conflict (dedupe_fingerprint) where (dedupe_fingerprint is not null and status = 'active')
         do nothing
         returning id`,
        [
          row.staff_id, row.service_id, row.raw.clientCompany, row.raw.externalReference,
          row.stage, occurredAt.toISOString(), row.normalized?.fingerprint ?? null,
          jobId, actor.identityId, row.raw.opportunityType, row.raw.managerCode,
        ],
      );
      if (!referral) {
        // Secao 6: a segunda reivindicacao nao e descartada — vira conflito para a Diretoria.
        await t.query(`update import_row set status = 'duplicate' where id = $1`, [row.id]);
        continue;
      }
      created += 1;
      await t.query(
        `insert into referral_stage_event
           (referral_id, from_stage, to_stage, occurred_at, actor_identity_id, actor_label,
            idempotency_key, rule_version)
         values ($1, null, $2::referral_stage, $3, $4, $5, $6, $7)`,
        [
          referral.id, row.stage, occurredAt.toISOString(), actor.identityId, actor.label,
          ledgerIdempotencyKey([jobId, row.id, row.stage]),
          `RULE_DUPLICATE_KEY@${duplicateRule.version}`,
        ],
      );
      if (pointsRule) {
        const computed = await computeStagePoints(t, row.stage);
        if (computed && computed.amount !== 0) {
          await appendLedgerEntry(t, {
            staffId: row.staff_id, referralId: referral.id, stage: row.stage,
            amount: computed.amount, kind: "grant", origin: "import",
            ruleKey: computed.ruleKey, ruleVersion: computed.ruleVersion,
            effectiveAt: occurredAt, actorIdentityId: actor.identityId, actorLabel: actor.label,
            idempotencyKey: ledgerIdempotencyKey(["import", jobId, row.id]),
          });
          ledgerEntries += 1;
        }
      }
      await t.query(`update import_row set status = 'applied', referral_id = $2 where id = $1`, [
        row.id, referral.id,
      ]);
    }

    /*
     * Duplicatas reconhecidas no staging nao entram no conjunto de linhas validas acima. Quando
     * pertencem a outra pessoa, elas precisam virar conflito auditavel em vez de desaparecerem
     * apenas com o rotulo "duplicate". O titular ja existe neste ponto, inclusive quando as duas
     * reivindicacoes vieram no mesmo arquivo.
     */
    const duplicateClaims = await t.query<{
      id: string; staff_id: string; fingerprint: string;
    }>(
      `select id, staff_id, normalized->>'fingerprint' fingerprint
         from import_row
        where import_job_id = $1 and status = 'duplicate'
          and normalized->>'fingerprint' is not null`,
      [jobId],
    );
    let titularityConflicts = 0;
    for (const claim of duplicateClaims) {
      const [holder] = await t.query<{ id: string; staff_id: string }>(
        `select id, staff_id from referral
          where dedupe_fingerprint = $1 and status = 'active' limit 1`,
        [claim.fingerprint],
      );
      if (!holder || holder.staff_id === claim.staff_id) continue;
      await registerTitularityConflict(t, {
        fingerprint: claim.fingerprint,
        ruleVersion: `RULE_DUPLICATE_KEY@${duplicateRule.version}`,
        existingReferralId: holder.id,
        importRowId: claim.id,
      });
      titularityConflicts += 1;
    }

    /*
     * D-27 / D-28 — a conferencia e MANUAL. Quem confirma atesta que conferiu as linhas, e o
     * sistema grava esse ato: identidade da sessao, momento e quantas oportunidades foram
     * cobertas. A evidencia operacional e a atestacao registrada no Programa WIN.
     */
    let conferred = 0;
    let stillPending = 0;
    if (conference?.attested) {
      const [aplicadas] = await t.query<{ c: number }>(
        `select count(*)::int c from import_row
          where import_job_id = $1 and status = 'applied'`,
        [jobId],
      );
      conferred = aplicadas?.c ?? 0;
      const [restantes] = await t.query<{ c: number }>(
        `select count(*)::int c from referral
          where source_import_job_id = $1 and eligibility_status = 'pending_validation'`,
        [jobId],
      );
      stillPending = restantes?.c ?? 0;
      await recordAudit(t, actor, {
        action: "import.conference.attested", resourceType: "import_job", resourceId: jobId,
        outcome: "allowed",
        metadata: {
          conferred,
          pendingCommercialValidation: stillPending,
          conferenceReference: conference.note ?? null,
        },
      });
    }

    await t.query(
      `update import_job set status = 'completed', confirmed_by = $2, confirmed_at = now(),
              updated_at = now(),
              summary = summary || $3::jsonb where id = $1`,
      [
        jobId, actor.identityId,
        JSON.stringify({
          created, progressed, ledgerEntries, titularityConflicts,
          pointsApplied: Boolean(pointsRule),
          conferenceAttested: Boolean(conference?.attested), conferred, stillPending,
        }),
      ],
    );
    await recordAudit(t, actor, {
      action: "import.confirmed", resourceType: "import_job", resourceId: jobId,
      outcome: "allowed", metadata: { created, progressed, ledgerEntries, titularityConflicts },
    });
    return {
      ...(await readJob(t, jobId)),
      created,
      progressed,
      ledgerEntries,
      titularityConflicts,
      conference: {
        attested: Boolean(conference?.attested),
        conferred,
        stillPending,
        notice: conference?.attested
          ? "Conferencia manual atestada e registrada na auditoria com autoria de sessao. " +
            "A elegibilidade financeira continua pendente ate a validacao da Area Comercial."
          : "Importacao consolidada SEM atestacao de conferencia: as oportunidades seguem " +
            "pendentes de validacao.",
      },
    };
  });
}
