/** Erros de aplicacao com codigo HTTP padronizado (Fase 4). */
export type ErrorCode =
  | "UNAUTHENTICATED"
  | "SESSION_EXPIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "IDEMPOTENT_REPLAY"
  | "VALIDATION_FAILED"
  | "PENDING_BUSINESS_RULE"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA"
  | "RATE_LIMITED"
  | "PROVIDER_NOT_CONFIGURED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENT_REPLAY: 409,
  VALIDATION_FAILED: 422,
  PENDING_BUSINESS_RULE: 422,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  RATE_LIMITED: 429,
  PROVIDER_NOT_CONFIGURED: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.status = STATUS[code];
  }
}

export const unauthenticated = (m = "Autenticacao necessaria.") => new AppError("UNAUTHENTICATED", m);
export const forbidden = (m = "Sem permissao para esta operacao.") => new AppError("FORBIDDEN", m);
export const notFound = (m = "Recurso nao encontrado.") => new AppError("NOT_FOUND", m);
export const conflict = (m: string, d?: Record<string, unknown>) => new AppError("CONFLICT", m, d);
export const validationFailed = (m: string, d?: Record<string, unknown>) =>
  new AppError("VALIDATION_FAILED", m, d);
export const pendingRule = (ruleKey: string) =>
  new AppError(
    "PENDING_BUSINESS_RULE",
    `A regra de negocio ${ruleKey} ainda nao foi aprovada. A fundacao tecnica esta pronta; ` +
      `a ativacao depende de decisao registrada (docs/DECISOES_PENDENTES_WIN.md).`,
    { ruleKey },
  );
