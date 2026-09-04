import type { SessionPrincipal } from "../auth/session";
import type { Db } from "../db/client";

declare module "fastify" {
  interface FastifyRequest {
    principal?: SessionPrincipal;
    denialReason?: string;
    correlationId: string;
  }
  interface FastifyInstance {
    db: Db;
  }
}
export {};

declare module "fastify" {
  interface FastifyContextConfig {
    public?: boolean;
    permission?: string;
    description?: string;
  }
}
