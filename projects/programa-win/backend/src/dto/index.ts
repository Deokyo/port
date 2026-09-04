/**
 * Fase 6: DTOs explicitos. O banco NUNCA devolve entidade completa para o frontend esconder
 * campos depois. Cada mapper e uma allowlist de saida.
 */
import { initials } from "../lib/text";

/** Chaves proibidas em qualquer DTO de board/ranking. Usado em teste automatizado. */
export const FORBIDDEN_PUBLIC_KEYS = [
  "client_company", "clientCompany", "email", "phone", "telefone", "cpf", "cnpj",
  "staff_id", "staffId", "id", "identity_id", "identityId", "created_by", "createdBy",
  "actor_label", "actorLabel", "note", "observacao", "raw", "dedupe_fingerprint",
  "external_code", "externalCode", "photo", "foto",
  "client_reference", "clientReference", "external_reference", "externalReference",
] as const;

export interface BoardParticipantDto {
  position: number;
  displayName: string;
  initials: string;
  points: number;
  referrals: number;
  isCurrentUser: boolean;
}

export function toBoardParticipant(
  row: { display_name: string; points: number; referrals: number },
  position: number,
  isCurrentUser: boolean,
): BoardParticipantDto {
  return {
    position,
    displayName: row.display_name,
    initials: initials(row.display_name),
    points: Number(row.points ?? 0),
    referrals: Number(row.referrals ?? 0),
    isCurrentUser,
  };
}

export interface BoardTerritoryDto {
  slug: string;
  name: string;
  servicesTotal: number;
  servicesWithWin: number;
  state: "locked" | "in_progress" | "conquered";
  stateRuleApproved: boolean;
  services: Array<{ slug: string; name: string; won: boolean }>;
}

/** D-12: a empresa cliente nao sai nos DTOs publicos. A referencia e administrativa. */
export interface AdminReferralDto {
  id: string;
  staffCode: string;
  staffName: string;
  reference: string | null;
  serviceName: string;
  territoryName: string;
  stage: string;
  occurredAt: string;
  status: string;
}

export function toAdminReferral(row: Record<string, unknown>): AdminReferralDto {
  return {
    id: String(row.id),
    staffCode: String(row.external_code),
    staffName: String(row.display_name),
    reference: row.client_reference === null || row.client_reference === undefined
      ? null
      : String(row.client_reference),
    serviceName: String(row.service_name),
    territoryName: String(row.territory_name),
    stage: String(row.current_stage),
    occurredAt: String(row.occurred_at),
    status: String(row.status),
  };
}

export interface MeReferralDto {
  id: string;
  serviceName: string;
  territoryName: string;
  stage: string;
  occurredAt: string;
}
