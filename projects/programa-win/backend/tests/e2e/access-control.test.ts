import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAdmin, asParticipant, createTestContext, login, type TestContext } from "../helpers/app";

let ctx: TestContext;
let adminCookie: string;
let participantCookie: string;

beforeAll(async () => {
  ctx = await createTestContext();
  adminCookie = await asAdmin(ctx.app);
  participantCookie = await asParticipant(ctx.app);
});
afterAll(async () => { await ctx.close(); });

describe("CRIT-01 — /admin protegido no servidor", () => {
  it("visitante anonimo recebe 401 e nao recebe nada do painel", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/admin/" });
    expect(response.statusCode).toBe(401);
    expect(response.body).toContain("Acesso restrito");
    expect(response.body).not.toContain("Importar planilha");
    expect(response.body).not.toContain("admin.js");
  });

  it("usuario autenticado sem papel administrativo recebe 403", async () => {
    const response = await ctx.app.inject({
      method: "GET", url: "/admin/", headers: { cookie: participantCookie },
    });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain("Importar planilha");
  });

  it("identidade sem nenhum papel tambem e barrada", async () => {
    const cookie = await login(ctx.app, { subject: "sem-papel", roles: [] });
    const response = await ctx.app.inject({
      method: "GET", url: "/admin/", headers: { cookie },
    });
    expect(response.statusCode).toBe(403);
  });

  it("administrador recebe o painel", async () => {
    const response = await ctx.app.inject({
      method: "GET", url: "/admin/", headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Importar planilha");
  });

  it("o painel nao e servido pelo diretorio estatico por outro caminho", async () => {
    for (const url of ["/assets/../admin/index.html", "/admin/index.html", "/assets/admin/index.html"]) {
      const response = await ctx.app.inject({ method: "GET", url });
      expect(response.statusCode, url).not.toBe(200);
    }
  });

  it("toda negacao vira evento de auditoria com autoria e motivo", async () => {
    const events = await ctx.db.query<{ actor_label: string; reason_code: string; outcome: string }>(
      `select actor_label, reason_code, outcome from audit_event
        where action = 'admin.page.access' and outcome = 'denied'`,
    );
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.map((e) => e.reason_code)).toContain("unauthenticated");
    expect(events.map((e) => e.reason_code)).toContain("missing_permission");
    expect(events.map((e) => e.actor_label)).toContain("anonymous");
  });
});

describe("AP-06 — escalonamento horizontal e vertical", () => {
  it("participante nao alcanca rotas administrativas", async () => {
    for (const url of [
      "/api/v1/admin/staff", "/api/v1/admin/referrals", "/api/v1/admin/imports",
      "/api/v1/admin/audit", "/api/v1/admin/export/referrals.csv",
    ]) {
      const response = await ctx.app.inject({
        method: "GET", url, headers: { cookie: participantCookie },
      });
      expect(response.statusCode, url).toBe(403);
      expect(response.json().error.code).toBe("FORBIDDEN");
    }
  });

  it("participante nao le as indicacoes de outro participante nem manipulando o ID", async () => {
    const outroCookie = await asParticipant(ctx.app, "WIN-0003");
    const outro = await ctx.app.inject({
      method: "GET", url: "/api/v1/me/referrals", headers: { cookie: outroCookie },
    });
    const alvo = outro.json().items[0];
    expect(alvo).toBeTruthy();

    const minhas = await ctx.app.inject({
      method: "GET", url: "/api/v1/me/referrals?pageSize=50", headers: { cookie: participantCookie },
    });
    const ids = minhas.json().items.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(alvo.id);

    // Tentativa direta pela rota administrativa com o ID alheio
    const tentativa = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/admin/referrals/${alvo.id}/transitions`,
      headers: { cookie: participantCookie },
      payload: { toStage: "sale_won", occurredAt: "2026-08-10" },
    });
    expect(tentativa.statusCode).toBe(403);
  });

  it("roles e campos administrativos enviados pelo cliente sao ignorados (mass assignment)", async () => {
    const response = await ctx.app.inject({
      method: "POST", url: "/api/v1/admin/staff", headers: { cookie: adminCookie },
      payload: {
        externalCode: "WIN-9001", displayName: "Novo Sintetico",
        roles: ["administrador"], isAdmin: true, id: "00000000-0000-0000-0000-000000000001",
        createdBy: "outro", points: 9999,
      },
    });
    expect(response.statusCode).toBe(201);
    const created = response.json();
    expect(created.id).not.toBe("00000000-0000-0000-0000-000000000001");

    const [ledger] = await ctx.db.query<{ c: number }>("select count(*)::int c from points_ledger");
    expect(ledger!.c).toBe(0);
  });

  it("id malformado responde 422, nao 500", async () => {
    const response = await ctx.app.inject({
      method: "GET", url: "/api/v1/admin/imports/nao-e-uuid", headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("VALIDATION_FAILED");
  });
});

describe("Sessao e headers", () => {
  it("login sintetico e recusado fora do loopback", async () => {
    const response = await ctx.app.inject({
      method: "POST", url: "/api/v1/auth/test-login", remoteAddress: "192.0.2.10",
      payload: { subject: "tentativa-remota", roles: ["administrador"] },
    });
    expect(response.statusCode).toBe(403);
  });

  it("sessao revogada pelo logout deixa de autenticar", async () => {
    const cookie = await asParticipant(ctx.app, "WIN-0004");
    const antes = await ctx.app.inject({
      method: "GET", url: "/api/v1/auth/session", headers: { cookie },
    });
    expect(antes.json().authenticated).toBe(true);

    await ctx.app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie } });

    const depois = await ctx.app.inject({
      method: "GET", url: "/api/v1/auth/session", headers: { cookie },
    });
    expect(depois.json().authenticated).toBe(false);

    const board = await ctx.app.inject({
      method: "GET", url: "/api/v1/board/summary", headers: { cookie },
    });
    expect(board.statusCode).toBe(401);
  });

  it("cookie de sessao e httpOnly e o token nunca aparece em claro no banco", async () => {
    const response = await ctx.app.inject({
      method: "POST", url: "/api/v1/auth/test-login",
      payload: { subject: "cookie-check", roles: ["participante"] },
    });
    const raw = response.headers["set-cookie"] as string | string[];
    const header = Array.isArray(raw) ? raw.join(";") : raw;
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");

    const token = (response.cookies as Array<{ name: string; value: string }>)
      .find((c) => c.name === "win_session")!.value;
    const [match] = await ctx.db.query<{ c: number }>(
      "select count(*)::int c from auth_session where token_hash = $1", [token],
    );
    expect(match!.c).toBe(0);
  });

  it("MED-08: CSP sem unsafe-inline e sem cache em rotas privadas", async () => {
    const page = await ctx.app.inject({ method: "GET", url: "/" });
    const csp = String(page.headers["content-security-policy"]);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(page.body).not.toMatch(/<style[\s>]/);
    expect(page.body).not.toMatch(/<script(?![^>]*\ssrc=)/);

    const api = await ctx.app.inject({
      method: "GET", url: "/api/v1/auth/session", headers: { cookie: adminCookie },
    });
    expect(api.headers["cache-control"]).toContain("no-store");
    expect(api.headers["x-correlation-id"]).toBeTruthy();
  });

  it("healthcheck nao revela informacao sensivel", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("erro inesperado nao devolve stack trace", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/api/v1/rota-inexistente" });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("at ");
    expect(response.body).not.toContain("/home/");
  });
});
