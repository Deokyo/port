import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { env } from "../config/env";
import type { Db } from "../db/client";
import { ANONYMOUS_ACTOR } from "../db/client";
import { AppError } from "../lib/errors";
import { logger, setLogLevel } from "../lib/logger";
import { resolveSession, SESSION_COOKIE } from "../auth/session";
import { declarePolicy, REGISTERED_ROUTES, resetRegisteredRoutes } from "../auth/rbac";
import { recordAudit } from "../modules/audit";
import { registerAuthRoutes } from "../modules/auth-routes";
import { registerBoardRoutes } from "../modules/board";
import { registerMeRoutes } from "../modules/me";
import { registerAdminRoutes } from "../modules/admin";
import { registerImportRoutes } from "../modules/imports";
import { registerAwardRoutes } from "../modules/awards";

const HERE = dirname(fileURLToPath(import.meta.url));
export const WEB_ROOT = join(HERE, "../../web");

export async function buildServer(db: Db): Promise<FastifyInstance> {
  const cfg = env();
  setLogLevel(cfg.LOG_LEVEL);

  const app = Fastify({
    logger: false,
    trustProxy: cfg.isProductionLike,
    bodyLimit: 1024 * 1024,
  });
  app.decorate("db", db);

  // Inventario das rotas registradas: tests/integration/route-policy.test.ts falha se alguma
  // rota de API ficar sem politica declarada (nega por padrao, Fase 4).
  resetRegisteredRoutes();
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === "HEAD" || method === "OPTIONS") continue;
      REGISTERED_ROUTES.push({ method, url: route.url });
    }
  });

  await app.register(cookie, { secret: cfg.SESSION_SECRET });
  await app.register(multipart, {
    limits: { fileSize: cfg.IMPORT_MAX_UPLOAD_BYTES, files: 1, fields: 10 },
  });
  await app.register(rateLimit, {
    max: cfg.RATE_LIMIT_MAX,
    timeWindow: cfg.RATE_LIMIT_WINDOW,
    keyGenerator: (request) => request.principal?.identityId ?? request.ip,
  });
  // MED-08: CSP sem 'unsafe-inline'. Por isso nao ha <style> nem <script> inline no HTML.
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(cfg.isProductionLike ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    hsts: cfg.isProductionLike ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    crossOriginResourcePolicy: { policy: "same-origin" },
    referrerPolicy: { policy: "no-referrer" },
  });

  app.addHook("onRequest", async (request, reply) => {
    request.correlationId = String(request.headers["x-correlation-id"] ?? randomUUID());
    reply.header("x-correlation-id", request.correlationId);
    if (request.url.startsWith("/api/") || request.url.startsWith("/admin")) {
      reply.header("cache-control", "no-store, no-cache, must-revalidate, private");
      reply.header("pragma", "no-cache");
    }
  });

  // Resolucao da sessao: uma vez por request. Falha de sessao nao derruba rota publica.
  app.addHook("preHandler", async (request) => {
    const path = request.url.split("?", 1)[0];
    // A casca publica e os assets nao consultam o banco. Alem de ser trabalho desnecessario,
    // resolver a mesma sessao para CSS/JS/logo em paralelo pode bloquear o PGlite local.
    if (path === "/" || path === "/healthz" || path?.startsWith("/assets/")) return;
    const token = request.cookies?.[SESSION_COOKIE];
    if (!token) return;
    try {
      request.principal = (await resolveSession(db, token)) ?? undefined;
    } catch (error) {
      if (error instanceof AppError && error.code === "SESSION_EXPIRED") {
        request.denialReason = "session_expired";
        return;
      }
      throw error;
    }
  });

  app.setNotFoundHandler(async (_request, reply) =>
    reply.code(404).send({ error: { code: "NOT_FOUND", message: "Recurso nao encontrado." } }));

  app.setErrorHandler(async (error, request, reply) => {
    const correlationId = request.correlationId;
    if (error instanceof ZodError) {
      return reply.code(422).send({
        error: {
          code: "VALIDATION_FAILED",
          message: "Dados invalidos.",
          correlationId,
          issues: error.issues.map((i) => ({ path: i.path.join("."), code: i.code })),
        },
      });
    }
    if (error instanceof AppError) {
      if (error.status === 401 || error.status === 403) {
        await db.txAsOwner((t) =>
          recordAudit(t, request.principal
            ? { identityId: request.principal.identityId, staffId: request.principal.staffId,
                roles: request.principal.roles, label: request.principal.displayName }
            : ANONYMOUS_ACTOR, {
            action: "access.denied", resourceType: "route", resourceId: `${request.method} ${request.url}`,
            outcome: "denied", reasonCode: request.denialReason ?? error.code,
            correlationId, ip: request.ip,
          })).catch(() => undefined);
      }
      return reply.code(error.status).send({
        error: { code: error.code, message: error.message, correlationId, ...(error.details ?? {}) },
      });
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 429) {
      return reply.code(429).send({
        error: { code: "RATE_LIMITED", message: "Muitas requisicoes. Tente novamente em instantes.", correlationId },
      });
    }
    if (statusCode === 413 || (error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
      return reply.code(413).send({
        error: { code: "PAYLOAD_TOO_LARGE", message: "Arquivo excede o limite permitido.", correlationId },
      });
    }
    // Erros nao previstos: log completo no servidor, resposta opaca para o cliente.
    logger.error("request.failed", {
      correlationId,
      route: `${request.method} ${request.url}`,
      name: (error as Error).name,
    });
    return reply.code(statusCode && statusCode < 500 ? statusCode : 500).send({
      error: { code: "INTERNAL", message: "Erro interno. Consulte o suporte com o correlationId.", correlationId },
    });
  });


  await registerAuthRoutes(app);
  await registerBoardRoutes(app);
  await registerMeRoutes(app);
  await registerAdminRoutes(app);
  await registerImportRoutes(app);
  await registerAwardRoutes(app);

  /* --------------------------------------------------------------------- */
  /* CRIT-01: /admin e servido pelo servidor SOMENTE apos autenticacao e     */
  /* verificacao de permissao. O HTML nao chega ao visitante anonimo.        */
  /* --------------------------------------------------------------------- */
  const adminHtmlPath = join(WEB_ROOT, "admin/index.html");
  app.get("/admin", { config: declarePolicy("GET", "/admin", { permission: "admin:access" }) },
    async (_request, reply) => reply.redirect("/admin/"));

  app.get("/admin/", {
    config: declarePolicy("GET", "/admin/", { permission: "admin:access" }),
  }, async (request, reply) => {
    const principal = request.principal;
    if (!principal || !principal.permissions.has("admin:access")) {
      await db.txAsOwner((t) =>
        recordAudit(t, principal
          ? { identityId: principal.identityId, staffId: principal.staffId, roles: principal.roles, label: principal.displayName }
          : ANONYMOUS_ACTOR, {
          action: "admin.page.access", resourceType: "page", resourceId: "/admin/",
          outcome: "denied", reasonCode: principal ? "missing_permission" : "unauthenticated",
          correlationId: request.correlationId, ip: request.ip,
        }));
      const status = principal ? 403 : 401;
      return reply.code(status).type("text/html; charset=utf-8").send(
        await readFile(join(WEB_ROOT, "denied.html"), "utf8"),
      );
    }
    return reply.type("text/html; charset=utf-8").send(await readFile(adminHtmlPath, "utf8"));
  });

  // Estaticos: apenas /assets e a raiz publica. O diretorio /admin NAO e servido estaticamente.
  await app.register(fastifyStatic, {
    root: join(WEB_ROOT, "assets"),
    prefix: "/assets/",
    index: false,
    setHeaders: (reply) => reply.header(
      "cache-control",
      cfg.isProductionLike ? "public, max-age=300" : "no-store",
    ),
  });
  app.get("/", { config: declarePolicy("GET", "/", { public: true, description: "WIN Board (shell)" }) },
    async (_request, reply) =>
      reply.type("text/html; charset=utf-8").send(await readFile(join(WEB_ROOT, "index.html"), "utf8")));

  return app;
}
