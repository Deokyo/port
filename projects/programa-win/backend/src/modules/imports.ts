import "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { declarePolicy, requirePermission } from "../auth/rbac";
import { actorFromRequest } from "./board";
import { AppError, validationFailed } from "../lib/errors";
import { confirmImport, createImportJob, getImportJob, previewImport } from "../import/pipeline";
import { env } from "../config/env";

const idParam = z.object({ id: z.string().uuid() });

export async function registerImportRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/admin/imports", {
    preHandler: requirePermission("import:create"),
    config: declarePolicy("POST", "/api/v1/admin/imports", { permission: "import:create" }),
  }, async (request, reply) => {
    const cfg = env();
    const file = await request.file({ limits: { fileSize: cfg.IMPORT_MAX_UPLOAD_BYTES } });
    if (!file) throw validationFailed("Envie o arquivo no campo 'file' (multipart/form-data).");
    const buffer = await file.toBuffer().catch(() => {
      throw new AppError("PAYLOAD_TOO_LARGE", "Arquivo excede o limite de upload.");
    });
    const fields = file.fields as Record<string, { value?: string } | undefined>;
    const referenceDate = fields.referenceDate?.value ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
      throw validationFailed("referenceDate deve estar no formato YYYY-MM-DD.");
    }
    const sheetName = fields.sheetName?.value;
    const job = await createImportJob(app.db, actorFromRequest(request), {
      filename: file.filename, buffer, declaredMime: file.mimetype, referenceDate,
      ...(sheetName ? { sheetName } : {}),
    });
    return reply.code(job.replay ? 200 : 201).send(job);
  });

  app.get("/api/v1/admin/imports", {
    preHandler: requirePermission("import:read"),
    config: declarePolicy("GET", "/api/v1/admin/imports", { permission: "import:read" }),
  }, async (request) => app.db.tx(actorFromRequest(request), async (t) =>
    t.query(
      `select id, filename, status, total_rows, valid_rows, invalid_rows,
              created_by_label, created_at, confirmed_at
         from import_job order by created_at desc limit 25`,
    )));

  app.get("/api/v1/admin/imports/:id", {
    preHandler: requirePermission("import:read"),
    config: declarePolicy("GET", "/api/v1/admin/imports/:id", { permission: "import:read" }),
  }, async (request) => {
    const { id } = idParam.parse(request.params);
    return getImportJob(app.db, actorFromRequest(request), id);
  });

  app.get("/api/v1/admin/imports/:id/preview", {
    preHandler: requirePermission("import:read"),
    config: declarePolicy("GET", "/api/v1/admin/imports/:id/preview", { permission: "import:read" }),
  }, async (request) => {
    const { id } = idParam.parse(request.params);
    return previewImport(app.db, actorFromRequest(request), id);
  });

  app.post("/api/v1/admin/imports/:id/confirm", {
    preHandler: requirePermission("import:confirm"),
    config: declarePolicy("POST", "/api/v1/admin/imports/:id/confirm", { permission: "import:confirm" }),
  }, async (request) => {
    const { id } = idParam.parse(request.params);
    // D-27: a confirmacao carrega a atestacao de conferencia manual, quando houver.
    // Sem default silencioso: quem confirma declara se atestou ou nao, e o servidor decide
    // se aquilo basta (RULE_OPERATING_MODEL).
    const body = z.object({
      attestConference: z.boolean(),
      conferenceNote: z.string().max(400).optional(),
    }).strict().parse(request.body ?? {});
    return confirmImport(app.db, actorFromRequest(request), id, {
      attested: body.attestConference,
      ...(body.conferenceNote ? { note: body.conferenceNote } : {}),
    });
  });
}
