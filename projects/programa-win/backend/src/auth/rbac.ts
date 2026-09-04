import type { FastifyReply, FastifyRequest } from "fastify";
import { forbidden, unauthenticated } from "../lib/errors";
import type { SessionPrincipal } from "./session";

/**
 * Fase 4: autorizacao server-side, NEGA POR PADRAO.
 * Toda rota registrada precisa declarar `public: true` ou uma permissao — ver
 * tests/integration/route-policy.test.ts, que falha se alguma rota ficar sem politica.
 */
export interface RoutePolicy {
  public?: boolean;
  permission?: string;
  description?: string;
}

export const ROUTE_POLICIES = new Map<string, RoutePolicy>();

/** Toda rota efetivamente registrada no Fastify, para auditoria automatica de cobertura. */
export interface RegisteredRoute { method: string; url: string }
export const REGISTERED_ROUTES: RegisteredRoute[] = [];

export function resetRegisteredRoutes(): void {
  REGISTERED_ROUTES.length = 0;
}

export function policyKey(method: string, url: string): string {
  return `${method.toUpperCase()} ${url}`;
}

export function declarePolicy(method: string, url: string, policy: RoutePolicy): RoutePolicy {
  ROUTE_POLICIES.set(policyKey(method, url), policy);
  return policy;
}

export function principalOf(request: FastifyRequest): SessionPrincipal {
  const principal = request.principal;
  if (!principal) throw unauthenticated();
  return principal;
}

/** preHandler que exige autenticacao e a permissao indicada. */
export function requirePermission(permission: string) {
  return async function guard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const principal = principalOf(request);
    if (!principal.permissions.has(permission)) {
      request.denialReason = `missing_permission:${permission}`;
      throw forbidden(`Falta a permissao ${permission}.`);
    }
  };
}

export function requireAuthenticated() {
  return async function guard(request: FastifyRequest): Promise<void> {
    principalOf(request);
  };
}

/** Roles enviadas pelo cliente sao IGNORADAS: a fonte e sempre a sessao no servidor. */
export function stripClientAuthorityFields<T extends Record<string, unknown>>(body: T): T {
  const clone = { ...body };
  for (const key of [
    "roles", "role", "permissions", "is_admin", "isAdmin", "staff_id", "staffId",
    "identity_id", "identityId", "actor_label", "actorLabel", "created_by", "createdBy",
    "points", "pontos", "amount", "rule_key", "ruleKey", "id",
  ]) {
    delete (clone as Record<string, unknown>)[key];
  }
  return clone;
}
