import "@fastify/cookie";
import { createHash, randomBytes } from "node:crypto";
import type { Db, Queryable } from "../db/client";
import { env } from "../config/env";
import { AppError } from "../lib/errors";

export const SESSION_COOKIE = "win_session";

export interface SessionPrincipal {
  sessionId: string;
  identityId: string;
  staffId: string | null;
  staffCode: string | null;
  displayName: string;
  roles: string[];
  permissions: Set<string>;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** O token em claro so existe na resposta HTTP. O banco guarda apenas o hash. */
export async function createSession(
  db: Db, identityId: string, userAgent?: string,
): Promise<{ token: string; expiresAt: Date }> {
  const cfg = env();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + cfg.SESSION_TTL_MINUTES * 60_000);
  await db.txAsOwner(async (t) => {
    await t.query(
      `insert into auth_session (identity_id, token_hash, expires_at, user_agent_hash)
       values ($1,$2,$3,$4)`,
      [
        identityId, hashToken(token), expiresAt.toISOString(),
        userAgent ? createHash("sha256").update(userAgent).digest("hex").slice(0, 32) : null,
      ],
    );
    await t.query(`update auth_identity set last_login_at = now() where id = $1`, [identityId]);
  });
  return { token, expiresAt };
}

export async function resolveSession(db: Db, token: string | undefined): Promise<SessionPrincipal | null> {
  if (!token) return null;
  const cfg = env();
  return db.txAsOwner(async (t: Queryable) => {
    const rows = await t.query<{
      session_id: string; identity_id: string; staff_id: string | null;
      external_code: string | null; display_name: string | null; email: string | null;
      expires_at: string; last_seen_at: string; revoked_at: string | null; identity_status: string;
    }>(
      `select s.id session_id, s.identity_id, i.staff_id, m.external_code, m.display_name,
              i.email, s.expires_at, s.last_seen_at, s.revoked_at, i.status identity_status
         from auth_session s
         join auth_identity i on i.id = s.identity_id
    left join staff_member m on m.id = i.staff_id
        where s.token_hash = $1`,
      [hashToken(token)],
    );
    const row = rows[0];
    if (!row) return null;
    if (row.revoked_at) throw new AppError("SESSION_EXPIRED", "Sessao encerrada.");
    if (row.identity_status !== "active") throw new AppError("FORBIDDEN", "Identidade desativada.");
    const now = Date.now();
    if (new Date(row.expires_at).getTime() <= now) {
      throw new AppError("SESSION_EXPIRED", "Sessao expirada.");
    }
    const idleMs = now - new Date(row.last_seen_at).getTime();
    if (idleMs > cfg.SESSION_IDLE_TIMEOUT_MINUTES * 60_000) {
      await t.query(`update auth_session set revoked_at = now() where id = $1`, [row.session_id]);
      throw new AppError("SESSION_EXPIRED", "Sessao encerrada por inatividade.");
    }
    await t.query(`update auth_session set last_seen_at = now() where id = $1`, [row.session_id]);

    const roleRows = await t.query<{ role_key: string }>(
      `select role_key from identity_role where identity_id = $1`, [row.identity_id],
    );
    const roles = roleRows.map((r) => r.role_key);
    const permRows = roles.length
      ? await t.query<{ permission_key: string }>(
          `select distinct permission_key from role_permission where role_key = any($1::text[])`,
          [roles],
        )
      : [];
    return {
      sessionId: row.session_id,
      identityId: row.identity_id,
      staffId: row.staff_id,
      staffCode: row.external_code,
      displayName: row.display_name ?? row.email ?? "Identidade sem cadastro",
      roles,
      permissions: new Set(permRows.map((p) => p.permission_key)),
    };
  });
}

export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.txAsOwner(async (t) => {
    await t.query(`update auth_session set revoked_at = now() where id = $1 and revoked_at is null`, [
      sessionId,
    ]);
  });
}

export function sessionCookieOptions() {
  const cfg = env();
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: cfg.isProductionLike,
    path: "/",
    maxAge: cfg.SESSION_TTL_MINUTES * 60,
  };
}
