import { env } from "../config/env";
import { logger } from "../lib/logger";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/** Contexto do ator, injetado por transacao. Nunca vem do cliente HTTP (Fase 4). */
export interface ActorContext {
  identityId: string | null;
  staffId: string | null;
  roles: readonly string[];
  label: string;
}

export const SYSTEM_ACTOR: ActorContext = {
  identityId: null,
  staffId: null,
  roles: ["service_account"],
  label: "system:job",
};

export const ANONYMOUS_ACTOR: ActorContext = {
  identityId: null,
  staffId: null,
  roles: [],
  label: "anonymous",
};

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  readonly driver: "pglite" | "pg";
  /** Transacao com RLS ligada: assume a role win_app e publica o contexto do ator. */
  tx<T>(actor: ActorContext, fn: (t: Queryable) => Promise<T>): Promise<T>;
  /** Transacao privilegiada (owner). Somente migrations, seeds e CLIs. */
  txAsOwner<T>(fn: (t: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Superficie minima que os drivers precisam expor. Evita o tipo `Function` solto. */
interface RawQueryTarget {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  exec(sql: string): Promise<unknown>;
}
interface RawClientTarget {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

const ADMIN_ROLES = new Set(["administrador", "service_account"]);
const VALIDATOR_ROLES = new Set(["validador_comercial"]);
const DIRECTOR_ROLES = new Set(["diretoria"]);

async function applyActorContext(t: Queryable, actor: ActorContext): Promise<void> {
  const isAdmin = actor.roles.some((r) => ADMIN_ROLES.has(r));
  const isValidator = actor.roles.some((r) => VALIDATOR_ROLES.has(r));
  const isDirector = actor.roles.some((r) => DIRECTOR_ROLES.has(r));
  // SET LOCAL ROLE nao aceita bind param, mas o nome e constante do codigo.
  await t.exec("set local role win_app");
  await t.query("select set_config('app.identity_id', $1, true)", [actor.identityId ?? ""]);
  await t.query("select set_config('app.staff_id', $1, true)", [actor.staffId ?? ""]);
  await t.query("select set_config('app.is_admin', $1, true)", [isAdmin ? "on" : "off"]);
  await t.query("select set_config('app.is_validator', $1, true)", [isValidator ? "on" : "off"]);
  await t.query("select set_config('app.is_director', $1, true)", [isDirector ? "on" : "off"]);
}

/* -------------------------------------------------------------------------- */
/* PGlite: PostgreSQL embarcado. Usado em development e test — sem servidor.    */
/* -------------------------------------------------------------------------- */
async function createPgliteDb(dataDir: string | undefined): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) mkdirSync(resolve(dataDir), { recursive: true });
  const raw = dataDir ? new PGlite(dataDir) : new PGlite();
  await raw.waitReady;

  const wrap = (target: RawQueryTarget): Queryable => ({
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const res = await target.query(sql, params as unknown[]);
      return (res as { rows: T[] }).rows;
    },
    async exec(sql: string) {
      await target.exec(sql);
    },
  });

  const base = wrap(raw as unknown as RawQueryTarget);
  let transactionTail: Promise<void> = Promise.resolve();

  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = transactionTail.then(operation, operation);
    transactionTail = result.then(() => undefined, () => undefined);
    return result;
  }

  return {
    driver: "pglite",
    query: base.query,
    exec: base.exec,
    async tx(actor, fn) {
      return serialized(() => raw.transaction(async (t) => {
        const q = wrap(t as unknown as RawQueryTarget);
        await applyActorContext(q, actor);
        return fn(q);
      }) as Promise<ReturnType<typeof fn> extends Promise<infer R> ? R : never>);
    },
    async txAsOwner(fn) {
      return serialized(() => raw.transaction(async (t) =>
        fn(wrap(t as unknown as RawQueryTarget)),
      ) as never);
    },
    async close() {
      await raw.close();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* pg: servidor PostgreSQL real. Obrigatorio em staging/producao.              */
/* -------------------------------------------------------------------------- */
async function createPgDb(connectionString: string): Promise<Db> {
  const pg = await import("pg");
  const pool = new pg.default.Pool({ connectionString, max: 10, application_name: "programa-win" });

  const runOn = (client: RawClientTarget): Queryable => ({
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const res = await client.query(sql, params as unknown[]);
      return res.rows as T[];
    },
    async exec(sql: string) {
      await client.query(sql);
    },
  });

  async function transaction<T>(fn: (t: Queryable) => Promise<T>, actor?: ActorContext): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const q = runOn(client);
      if (actor) await applyActorContext(q, actor);
      const result = await fn(q);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    driver: "pg",
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const res = await pool.query(sql, params as unknown[]);
      return res.rows as T[];
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    tx: (actor, fn) => transaction(fn, actor),
    txAsOwner: (fn) => transaction(fn),
    async close() {
      await pool.end();
    },
  };
}

export async function createDb(options?: { pgliteMemory?: boolean }): Promise<Db> {
  const cfg = env();
  if (cfg.DB_DRIVER === "pg") {
    logger.info("db.connect", { driver: "pg" });
    return createPgDb(cfg.DATABASE_URL as string);
  }
  const dir = options?.pgliteMemory ? undefined : cfg.DB_PGLITE_PATH;
  logger.info("db.connect", { driver: "pglite", persistent: Boolean(dir) });
  return createPgliteDb(dir);
}
