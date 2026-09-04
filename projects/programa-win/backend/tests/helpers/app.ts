import type { FastifyInstance } from "fastify";
import { createDb, type Db } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { seedAll } from "../../src/db/seed";
import { buildServer } from "../../src/http/server";

export interface TestContext {
  app: FastifyInstance;
  db: Db;
  close(): Promise<void>;
}

/** Ambiente completo por arquivo de teste: PostgreSQL embarcado limpo + migrations + seeds. */
export async function createTestContext(options: { synthetic?: boolean } = {}): Promise<TestContext> {
  const db = await createDb({ pgliteMemory: true });
  await runMigrations(db);
  await seedAll(db, { synthetic: options.synthetic ?? true });
  const app = await buildServer(db);
  await app.ready();
  return {
    app,
    db,
    async close() {
      await app.close();
      await db.close();
    },
  };
}

export interface LoginOptions {
  subject: string;
  roles: string[];
  staffExternalCode?: string;
}

/**
 * Login exclusivo de teste. A rota so existe com NODE_ENV=test + AUTH_TEST_MODE
 * (env.ts recusa a inicializacao da aplicacao em qualquer outro ambiente).
 */
export async function login(app: FastifyInstance, options: LoginOptions): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/test-login",
    payload: options,
  });
  if (response.statusCode !== 200) {
    throw new Error(`test-login falhou: ${response.statusCode} ${response.body}`);
  }
  const cookies = response.cookies as Array<{ name: string; value: string }>;
  const session = cookies.find((c) => c.name === "win_session");
  if (!session) throw new Error("cookie de sessao ausente");
  return `win_session=${session.value}`;
}

export const asAdmin = (app: FastifyInstance) =>
  login(app, { subject: "admin-teste", roles: ["administrador"] });

export const asValidator = (app: FastifyInstance) =>
  login(app, { subject: "validador-teste", roles: ["validador_comercial"], staffExternalCode: "WIN-0002" });

export const asParticipant = (app: FastifyInstance, code = "WIN-0001") =>
  login(app, { subject: `participante-${code}`, roles: ["participante"], staffExternalCode: code });

/**
 * Fixture de aprovacao de regra. Existe SOMENTE nos testes: permite exercitar os caminhos
 * que dependem de decisao de negocio sem que o sistema entregue nenhuma regra aprovada
 * por padrao (ALTO-05). O aprovador registrado e sinteticamente identificado.
 */
export async function approveRule(db: Db, ruleKey: string, version = 1): Promise<void> {
  await db.txAsOwner(async (t) => {
    const rows = await t.query<{ rule_key: string }>(
      `update business_rule
          set status = 'approved',
              approver_name = 'Aprovador Sintetico (fixture de teste)',
              approver_role = 'test',
              approved_at = now(),
              effective_from = now() - interval '1 day'
        where rule_key = $1 and version = $2
        returning rule_key`,
      [ruleKey, version],
    );
    if (!rows[0]) throw new Error(`regra inexistente para aprovar: ${ruleKey}@${version}`);
  });
}

/** Constroi um CSV valido para o importador, em memoria. */
export function buildCsv(rows: string[][]): Buffer {
  return Buffer.from(rows.map((r) => r.join(";")).join("\r\n"), "utf8");
}

/** Monta um corpo multipart/form-data sem dependencia externa. */
export function multipart(
  fields: Record<string, string>,
  file: { field: string; filename: string; content: Buffer; contentType: string },
): { body: Buffer; headers: Record<string, string> } {
  const boundary = `----winTest${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ));
  }
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; ` +
      `filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
  ));
  parts.push(file.content);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  return {
    body,
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(body.length),
    },
  };
}
