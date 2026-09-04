import { createHash } from "node:crypto";
import type { ActorContext, Queryable } from "../db/client";
import { safeMeta } from "../lib/redact";

export interface AuditInput {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome: "allowed" | "denied" | "error";
  reasonCode?: string | null;
  correlationId?: string | null;
  ip?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * CRIT-03 / ALTO-01: autoria real, vinda da sessao. Nunca literal fixo.
 * O metadata passa por redacao: nenhuma PII e nenhum payload de planilha entra na trilha.
 */
export async function recordAudit(t: Queryable, actor: ActorContext, input: AuditInput): Promise<void> {
  await t.query(
    `insert into audit_event
       (actor_identity_id, actor_label, actor_roles, action, resource_type, resource_id,
        outcome, reason_code, correlation_id, ip_hash, metadata)
     values ($1,$2,$3::text[],$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    [
      actor.identityId, actor.label, actor.roles as string[], input.action, input.resourceType,
      input.resourceId ?? null, input.outcome, input.reasonCode ?? null,
      input.correlationId ?? null,
      input.ip ? createHash("sha256").update(input.ip).digest("hex").slice(0, 32) : null,
      JSON.stringify(safeMeta(input.metadata ?? {})),
    ],
  );
}
