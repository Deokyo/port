/**
 * Redacao de logs (Fase 5 / IS-06). Nenhum dado pessoal, credencial ou payload de
 * planilha pode chegar ao log.
 */
const SENSITIVE_KEYS = new Set([
  "name", "nome", "display_name", "displayname", "email", "e-mail", "phone", "telefone",
  "cpf", "cnpj", "company", "empresa", "client_company", "clientcompany", "raw", "rows",
  "password", "senha", "token", "secret", "authorization", "cookie", "session",
  "id_token", "access_token", "refresh_token", "client_secret", "buffer", "file",
  "note", "observacao", "body",
]);

const MAX_DEPTH = 4;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth >= MAX_DEPTH) return "[deep]";
  if (typeof value === "string") return value.length > 200 ? `[str:${value.length}]` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `[bytes:${value.length}]`;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return "[unknown]";
}

export function safeMeta(meta: Record<string, unknown>): Record<string, unknown> {
  return redact(meta) as Record<string, unknown>;
}
