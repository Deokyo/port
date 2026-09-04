import type { Db, Queryable } from "./client";
import { slugify } from "../lib/text";

/**
 * Catalogo CONFIRMADO (RP-01) modelado como dados versionaveis.
 * MED-02: a classificacao passa a ser relacionamento + alias explicito.
 * Nao existe mais fallback silencioso para "Performance".
 */
export const CONFIRMED_CATALOG = {
  label: "catalogo-win-2026-09",
  source: "Status_Checklist_Programa_WIN.docx — item RP-01 (CONFIRMADO)",
  territories: [
    { name: "Performance", services: ["Fiscal", "Financeiro", "Folha", "Contabil", "TI"] },
    { name: "Governanca", services: ["Auditoria", "Tributaria"] },
    { name: "Expansao", services: ["M&A", "Representacao Legal"] },
    { name: "Pessoas", services: ["Beneficios", "Seguros", "Talents"] },
  ],
} as const;

/** Aliases aceitos na importacao. Fora desta lista, a linha e rejeitada (nunca adivinhada). */
const EXTRA_ALIASES: Record<string, string[]> = {
  contabil: ["contabilidade", "bpo contabil"],
  ti: ["tecnologia", "tecnologia da informacao"],
  fiscal: ["bpo fiscal"],
  financeiro: ["bpo financeiro"],
  folha: ["bpo folha", "folha de pagamento"],
  tributaria: ["tributario", "reforma tributaria"],
  "m-a": ["m&a", "fusoes e aquisicoes"],
  "representacao-legal": ["representacao legal", "representacao"],
  talents: ["staff loan", "recrutamento"],
};

export async function seedCatalog(db: Db): Promise<{ catalogVersionId: string }> {
  return db.txAsOwner(async (t) => {
    const existing = await t.query<{ id: string }>(
      "select id from catalog_version where label = $1",
      [CONFIRMED_CATALOG.label],
    );
    if (existing[0]) return { catalogVersionId: existing[0].id };

    const [version] = await t.query<{ id: string }>(
      `insert into catalog_version (label, status, source) values ($1, 'active', $2) returning id`,
      [CONFIRMED_CATALOG.label, CONFIRMED_CATALOG.source],
    );
    const catalogVersionId = version!.id;

    let territoryOrder = 0;
    for (const territory of CONFIRMED_CATALOG.territories) {
      const [row] = await t.query<{ id: string }>(
        `insert into territory (catalog_version_id, slug, name, display_order)
         values ($1, $2, $3, $4) returning id`,
        [catalogVersionId, slugify(territory.name), territory.name, territoryOrder++],
      );
      let serviceOrder = 0;
      for (const serviceName of territory.services) {
        const slug = slugify(serviceName);
        const [svc] = await t.query<{ id: string }>(
          `insert into service (territory_id, slug, name, display_order)
           values ($1, $2, $3, $4) returning id`,
          [row!.id, slug, serviceName, serviceOrder++],
        );
        const aliases = new Set<string>([slug, serviceName.toLowerCase(), ...(EXTRA_ALIASES[slug] ?? [])]);
        for (const alias of aliases) {
          await t.query(
            `insert into service_alias (service_id, alias_key, catalog_version_id)
             values ($1, $2, $3) on conflict (catalog_version_id, alias_key) do nothing`,
            [svc!.id, alias, catalogVersionId],
          );
        }
      }
    }
    return { catalogVersionId };
  });
}

export const PERMISSIONS: Array<[string, string]> = [
  ["admin:access", "Abrir a area administrativa"],
  ["staff:read", "Listar funcionarios"],
  ["staff:write", "Criar, editar e inativar funcionarios"],
  ["referral:read", "Ler as proprias indicacoes"],
  ["referral:read_all", "Ler indicacoes de todos os participantes"],
  ["referral:write", "Criar e editar indicacoes"],
  ["referral:transition", "Executar transicao de etapa"],
  ["catalog:read", "Ler o catalogo de territorios e servicos"],
  ["import:create", "Enviar planilha para validacao"],
  ["import:read", "Consultar importacoes e previas"],
  ["import:confirm", "Confirmar a aplicacao de uma importacao"],
  ["points:read", "Consultar saldo e extrato de pontos"],
  ["points:adjust", "Lancar ajuste ou correcao no ledger"],
  ["audit:read", "Consultar a trilha de auditoria"],
  ["rule:read", "Consultar as regras de negocio e seu status"],
  ["rule:approve", "Registrar aprovacao formal de regra"],
  ["board:read", "Ler os dados do WIN Board"],
  ["profile:read", "Ler o proprio perfil e progresso"],
  ["notification:read", "Ler as proprias notificacoes"],
  ["export:create", "Gerar exportacao CSV"],
  // Politica LOCTL CORP COML 001 rev. 03
  ["opportunity:validate", "Validar elegibilidade da oportunidade (Area Comercial)"],
  ["meeting:validate", "Validar reuniao qualificada (Area Comercial)"],
  ["revenue:record", "Registrar receita liquida recebida e estornos"],
  ["award:read", "Consultar o proprio extrato de premiacao"],
  ["award:read:all", "Consultar a apuracao de todos os participantes"],
  ["payout:manage", "Montar lote de pagamento"],
  ["payout:approve", "Aprovar o pagamento do lote (Diretoria)"],
  ["titularity:resolve", "Decidir conflito de titularidade (Diretoria + Comercial)"],
];

export const ROLES: Array<{ key: string; name: string; description: string; permissions: string[] }> = [
  {
    key: "participante",
    name: "Participante",
    description: "Funcionario participante do programa. Enxerga apenas os proprios dados.",
    permissions: [
      "board:read", "profile:read", "notification:read", "referral:read", "catalog:read",
      "points:read", "award:read",
    ],
  },
  {
    key: "validador_comercial",
    name: "Validador comercial",
    description:
      "Area Comercial. Valida a elegibilidade da oportunidade e a reuniao qualificada " +
      "(politica LOCTL CORP COML 001 rev. 03, secoes 4 e 6).",
    permissions: [
      "board:read", "profile:read", "notification:read", "catalog:read", "points:read",
      "staff:read", "referral:read", "referral:read_all", "referral:write", "referral:transition",
      // Secao 6: a validacao e da Area Comercial — RULE_TRANSITION_AUTHORITY v2.
      // O registro da receita recebida NAO entra aqui: e ato financeiro/administrativo.
      "opportunity:validate", "meeting:validate",
      "award:read", "award:read:all",
    ],
  },
  {
    key: "administrador",
    name: "Administrador",
    description: "Administra o programa. Nao pode alterar ledger nem auditoria (append-only).",
    permissions: [
      "admin:access", "board:read", "profile:read", "notification:read", "catalog:read",
      "staff:read", "staff:write", "referral:read", "referral:read_all", "referral:write",
      "referral:transition",
      "import:create", "import:read", "import:confirm", "points:read", "points:adjust",
      "audit:read", "rule:read", "rule:approve", "export:create",
      "opportunity:validate", "meeting:validate", "revenue:record", "award:read", "award:read:all",
      "payout:manage",
    ],
  },
  {
    key: "diretoria",
    name: "Diretoria",
    description:
      "Aprova o pagamento da premiacao e decide conflito de titularidade " +
      "(politica LOCTL CORP COML 001 rev. 03, secoes 6 e 8).",
    permissions: [
      "board:read", "profile:read", "catalog:read", "staff:read", "referral:read",
      "award:read", "award:read:all", "payout:manage", "payout:approve", "titularity:resolve",
      "rule:read", "audit:read",
    ],
  },
  {
    key: "service_account",
    name: "Servico interno",
    description: "Jobs internos. Sem acesso interativo.",
    permissions: ["import:read", "points:read", "rule:read", "catalog:read", "award:read:all"],
  },
];

export async function seedRbac(db: Db): Promise<void> {
  await db.txAsOwner(async (t: Queryable) => {
    for (const [key, description] of PERMISSIONS) {
      await t.query(
        `insert into permission (key, description) values ($1, $2)
         on conflict (key) do update set description = excluded.description`,
        [key, description],
      );
    }
    for (const role of ROLES) {
      const approvedByPolicy = role.key === "diretoria" || role.key === "validador_comercial";
      await t.query(
        `insert into role (key, name, description, is_system, status)
         values ($1, $2, $3, true, $4)
         on conflict (key) do update set name = excluded.name, description = excluded.description`,
        [role.key, role.name, role.description, approvedByPolicy ? "approved" : "proposed"],
      );
      for (const permission of role.permissions) {
        await t.query(
          `insert into role_permission (role_key, permission_key) values ($1, $2)
           on conflict do nothing`,
          [role.key, permission],
        );
      }
    }
  });
}
