import "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../config/env";
import { AppError, unauthenticated } from "../lib/errors";
import { declarePolicy } from "../auth/rbac";
import { buildAuthorizationUrl, createPkce, exchangeCode } from "../auth/oidc";
import { createSession, revokeSession, sessionCookieOptions, SESSION_COOKIE } from "../auth/session";
import { recordAudit } from "./audit";
import { ANONYMOUS_ACTOR, SYSTEM_ACTOR } from "../db/client";

const PKCE_COOKIE = "win_oidc";

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const cfg = env();

  app.get("/api/v1/auth/session", {
    config: declarePolicy("GET", "/api/v1/auth/session", { public: true, description: "Estado da sessao" }),
  }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const localLoginAvailable = cfg.NODE_ENV === "test" && cfg.AUTH_TEST_MODE;
    if (!request.principal) {
      return {
        authenticated: false,
        oidcConfigured: cfg.oidcConfigured,
        localLoginAvailable,
        loginUrl: cfg.oidcConfigured
          ? "/auth/oidc/login"
          : localLoginAvailable ? "/auth/test-login/local" : null,
        notice: cfg.oidcConfigured
          ? "Use sua identidade corporativa para entrar no Programa WIN."
          : localLoginAvailable
            ? "Ambiente local do piloto. O acesso sintetico funciona somente neste computador."
          : "Provedor de identidade nao configurado (D-02). O acesso administrativo permanece " +
            "fechado ate que OIDC seja definido.",
      };
    }
    return {
      authenticated: true,
      displayName: request.principal.displayName,
      staffCode: request.principal.staffCode,
      roles: request.principal.roles,
      permissions: [...request.principal.permissions],
    };
  });

  app.get("/auth/oidc/login", {
    config: declarePolicy("GET", "/auth/oidc/login", { public: true, description: "Inicio do fluxo OIDC" }),
  }, async (request, reply) => {
    const pkce = createPkce();
    const url = await buildAuthorizationUrl(pkce);
    reply.setCookie(PKCE_COOKIE, JSON.stringify({ v: pkce.verifier, s: pkce.state }), {
      httpOnly: true, sameSite: "lax", secure: cfg.isProductionLike, path: "/", maxAge: 600,
    });
    return reply.redirect(url);
  });

  app.get("/auth/oidc/callback", {
    config: declarePolicy("GET", "/auth/oidc/callback", { public: true, description: "Retorno do provedor OIDC" }),
  }, async (request, reply) => {
    const query = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(request.query);
    const raw = request.cookies[PKCE_COOKIE];
    if (!raw) throw unauthenticated("Fluxo de login expirado. Tente novamente.");
    const stored = JSON.parse(raw) as { v: string; s: string };
    if (stored.s !== query.state) throw unauthenticated("State invalido.");
    reply.clearCookie(PKCE_COOKIE, { path: "/" });

    const claims = await exchangeCode(query.code, stored.v);
    const identityId = await app.db.txAsOwner(async (t) => {
      const rows = await t.query<{ id: string }>(
        `insert into auth_identity (issuer, subject, email)
         values ($1,$2,$3)
         on conflict (issuer, subject) do update set email = excluded.email
         returning id`,
        [claims.iss, claims.sub, claims.email ?? null],
      );
      return rows[0]!.id;
    });
    const { token } = await createSession(app.db, identityId, request.headers["user-agent"]);
    await app.db.txAsOwner((t) =>
      recordAudit(t, { ...SYSTEM_ACTOR, identityId, label: `oidc:${claims.sub.slice(0, 8)}` }, {
        action: "auth.login", resourceType: "auth_identity", resourceId: identityId,
        outcome: "allowed", correlationId: request.correlationId, ip: request.ip,
      }));
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions());
    return reply.redirect("/admin/");
  });

  app.post("/api/v1/auth/logout", {
    config: declarePolicy("POST", "/api/v1/auth/logout", { public: true, description: "Encerrar sessao" }),
  }, async (request, reply) => {
    if (request.principal) {
      await revokeSession(app.db, request.principal.sessionId);
      await app.db.txAsOwner((t) =>
        recordAudit(t, {
          identityId: request.principal!.identityId, staffId: request.principal!.staffId,
          roles: request.principal!.roles, label: request.principal!.displayName,
        }, {
          action: "auth.logout", resourceType: "auth_session",
          resourceId: request.principal!.sessionId, outcome: "allowed",
          correlationId: request.correlationId,
        }));
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  /* ------------------------------------------------------------------------- */
  /* Autenticacao simulada: registrada SOMENTE com NODE_ENV=test e AUTH_TEST_MODE. */
  /* env.ts recusa a inicializacao se AUTH_TEST_MODE for ligado fora de 'test'.    */
  /* ------------------------------------------------------------------------- */
  if (cfg.NODE_ENV === "test" && cfg.AUTH_TEST_MODE) {
    const loopback = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
    function requireLoopback(ip: string): void {
      if (!loopback.has(ip)) {
        throw new AppError("FORBIDDEN", "Login local disponivel apenas neste computador.");
      }
    }

    async function createTestIdentity(input: {
      subject: string;
      roles: string[];
      staffExternalCode?: string;
    }): Promise<string> {
      return app.db.txAsOwner(async (t) => {
        let staffId: string | null = null;
        if (input.staffExternalCode) {
          const rows = await t.query<{ id: string }>(
            `select id from staff_member where external_code = $1`, [input.staffExternalCode],
          );
          if (!rows[0]) throw new AppError("VALIDATION_FAILED", "Matricula sintetica inexistente.");
          staffId = rows[0].id;
        }
        const rows = await t.query<{ id: string }>(
          `insert into auth_identity (issuer, subject, email, staff_id)
           values ('urn:test', $1, $2, $3)
           on conflict (issuer, subject) do update set staff_id = excluded.staff_id
           returning id`,
          [input.subject, `${input.subject}@example.invalid`, staffId],
        );
        const id = rows[0]!.id;
        await t.query(`delete from identity_role where identity_id = $1`, [id]);
        for (const role of input.roles) {
          await t.query(
            `insert into identity_role (identity_id, role_key) values ($1,$2) on conflict do nothing`,
            [id, role],
          );
        }
        return id;
      });
    }

    app.post("/api/v1/auth/test-login", {
      config: declarePolicy("POST", "/api/v1/auth/test-login", {
        public: true, description: "SOMENTE TESTES: cria sessao sem provedor externo",
      }),
    }, async (request, reply) => {
      requireLoopback(request.ip);
      const body = z.object({
        subject: z.string().min(1),
        roles: z.array(z.string()).default([]),
        staffExternalCode: z.string().optional(),
      }).parse(request.body);
      const identityId = await createTestIdentity(body);
      const { token } = await createSession(app.db, identityId);
      reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions());
      return { ok: true, identityId };
    });

    app.get("/auth/test-login/local", {
      config: declarePolicy("GET", "/auth/test-login/local", {
        public: true,
        description: "SOMENTE TESTE LOCAL: cria sessao sintetica e abre o WIN Board",
      }),
    }, async (request, reply) => {
      requireLoopback(request.ip);
      const identityId = await createTestIdentity({
        subject: "admin-local",
        roles: ["administrador"],
        staffExternalCode: "WIN-0001",
      });
      const { token } = await createSession(app.db, identityId, request.headers["user-agent"]);
      reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions());
      return reply.redirect("/");
    });
  }

  app.get("/healthz", {
    config: declarePolicy("GET", "/healthz", { public: true, description: "Healthcheck" }),
  }, async (_request, reply) => {
    // Sem versao de dependencia, sem host de banco, sem contagem de usuarios.
    reply.header("cache-control", "no-store");
    try {
      await app.db.query("select 1");
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "degraded" });
    }
  });

  app.get("/api/v1/auth/denied-probe", {
    config: declarePolicy("GET", "/api/v1/auth/denied-probe", { public: true, description: "Sonda de negacao" }),
  }, async (request) => {
    await app.db.txAsOwner((t) =>
      recordAudit(t, ANONYMOUS_ACTOR, {
        action: "probe", resourceType: "system", outcome: "allowed",
        correlationId: request.correlationId,
      }));
    return { ok: true };
  });
}
