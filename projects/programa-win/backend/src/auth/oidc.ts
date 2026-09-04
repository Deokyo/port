import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../config/env";
import { AppError } from "../lib/errors";

/**
 * Fase 4: autenticacao preparada para OIDC (Authorization Code + PKCE).
 * O provedor corporativo ainda nao foi informado (D-02), entao tudo aqui e configuravel
 * por variavel de ambiente e o fluxo responde 503 enquanto nao houver configuracao.
 * Nao existe senha padrao, e-mail de administrador embutido nem endpoint publico de bootstrap.
 */
interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}

let cachedDiscovery: { issuer: string; doc: Discovery } | null = null;

export function assertOidcConfigured(): void {
  if (!env().oidcConfigured) {
    throw new AppError(
      "PROVIDER_NOT_CONFIGURED",
      "Provedor de identidade nao configurado. Defina OIDC_ISSUER, OIDC_CLIENT_ID e " +
        "OIDC_CLIENT_SECRET (decisao D-02).",
    );
  }
}

export async function discover(fetchImpl: typeof fetch = fetch): Promise<Discovery> {
  assertOidcConfigured();
  const cfg = env();
  if (cachedDiscovery?.issuer === cfg.OIDC_ISSUER) return cachedDiscovery.doc;
  const url = `${cfg.OIDC_ISSUER.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new AppError("PROVIDER_NOT_CONFIGURED", "Falha ao descobrir o provedor OIDC.");
  const doc = (await res.json()) as Discovery;
  cachedDiscovery = { issuer: cfg.OIDC_ISSUER, doc };
  return doc;
}

export interface PkcePair { verifier: string; challenge: string; state: string }

export function createPkce(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: randomBytes(16).toString("base64url"),
  };
}

export async function buildAuthorizationUrl(pkce: PkcePair, fetchImpl?: typeof fetch): Promise<string> {
  const cfg = env();
  const doc = await discover(fetchImpl);
  const url = new URL(doc.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.OIDC_CLIENT_ID);
  url.searchParams.set("redirect_uri", `${cfg.APP_BASE_URL}${cfg.OIDC_REDIRECT_PATH}`);
  url.searchParams.set("scope", cfg.OIDC_SCOPES);
  url.searchParams.set("state", pkce.state);
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface OidcClaims { sub: string; email?: string; name?: string; iss: string }

export async function exchangeCode(
  code: string, verifier: string, fetchImpl: typeof fetch = fetch,
): Promise<OidcClaims> {
  const cfg = env();
  const doc = await discover(fetchImpl);
  const res = await fetchImpl(doc.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${cfg.APP_BASE_URL}${cfg.OIDC_REDIRECT_PATH}`,
      client_id: cfg.OIDC_CLIENT_ID,
      client_secret: cfg.OIDC_CLIENT_SECRET,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new AppError("UNAUTHENTICATED", "Falha na troca do codigo de autorizacao.");
  const payload = (await res.json()) as { id_token?: string };
  if (!payload.id_token) throw new AppError("UNAUTHENTICATED", "Provedor nao retornou id_token.");
  const jwks = createRemoteJWKSet(new URL(doc.jwks_uri));
  const { payload: claims } = await jwtVerify(payload.id_token, jwks, {
    issuer: doc.issuer,
    audience: cfg.OIDC_CLIENT_ID,
  });
  if (!claims.sub) throw new AppError("UNAUTHENTICATED", "id_token sem subject.");
  return {
    sub: String(claims.sub),
    email: claims.email ? String(claims.email) : undefined,
    name: claims.name ? String(claims.name) : undefined,
    iss: String(claims.iss),
  };
}
