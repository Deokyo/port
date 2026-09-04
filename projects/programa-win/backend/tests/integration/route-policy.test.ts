import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "../helpers/app";
import { ROUTE_POLICIES, REGISTERED_ROUTES, policyKey } from "../../src/auth/rbac";

let ctx: TestContext;

beforeAll(async () => { ctx = await createTestContext({ synthetic: false }); });
afterAll(async () => { await ctx.close(); });

describe("Fase 4 — nega por padrao: cobertura de politica em toda rota", () => {
  it("nenhuma rota protegida fica sem politica declarada", () => {
    const protectedRoutes = REGISTERED_ROUTES.filter(
      (r) => r.url.startsWith("/api/") || r.url.startsWith("/admin"),
    );
    expect(protectedRoutes.length).toBeGreaterThan(10);
    const semPolitica = protectedRoutes.filter((r) => !ROUTE_POLICIES.has(policyKey(r.method, r.url)));
    expect(semPolitica, `rotas sem politica: ${JSON.stringify(semPolitica)}`).toEqual([]);
  });

  it("toda rota nao publica exige uma permissao que existe no catalogo de permissoes", async () => {
    const known = new Set(
      (await ctx.db.query<{ key: string }>("select key from permission")).map((p) => p.key),
    );
    const problemas: string[] = [];
    for (const route of REGISTERED_ROUTES) {
      if (!route.url.startsWith("/api/") && !route.url.startsWith("/admin")) continue;
      const policy = ROUTE_POLICIES.get(policyKey(route.method, route.url));
      if (!policy) continue;
      if (policy.public) continue;
      if (!policy.permission) problemas.push(`${route.method} ${route.url}: sem permissao`);
      else if (!known.has(policy.permission)) {
        problemas.push(`${route.method} ${route.url}: permissao inexistente ${policy.permission}`);
      }
    }
    expect(problemas).toEqual([]);
  });

  it("as rotas publicas sao apenas as de sessao, login, logout e healthcheck", () => {
    const publicas = [...ROUTE_POLICIES.entries()]
      .filter(([, policy]) => policy.public)
      .map(([key]) => key)
      .sort();
    expect(publicas).toEqual([
      "GET /",
      "GET /api/v1/auth/denied-probe",
      "GET /api/v1/auth/session",
      "GET /auth/oidc/callback",
      "GET /auth/oidc/login",
      "GET /auth/test-login/local",
      "GET /healthz",
      "POST /api/v1/auth/logout",
      "POST /api/v1/auth/test-login",
    ]);
  });

  it("nenhuma rota administrativa depende de permissao que o participante possui", async () => {
    const participantPerms = new Set(
      (await ctx.db.query<{ permission_key: string }>(
        `select permission_key from role_permission where role_key = 'participante'`,
      )).map((r) => r.permission_key),
    );
    const vazamentos: string[] = [];
    for (const [key, policy] of ROUTE_POLICIES.entries()) {
      if (!key.includes("/admin")) continue;
      if (policy.permission && participantPerms.has(policy.permission)) vazamentos.push(key);
    }
    expect(vazamentos, `rotas admin alcancaveis pelo participante: ${vazamentos.join(", ")}`)
      .toEqual([]);
  });
});
