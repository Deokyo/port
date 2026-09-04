/**
 * Fase 2 — Rules Pack executavel.
 * ALTO-05/AUS-05: nenhuma regra informal nasce aprovada. Regras sustentadas pela politica
 * assinada entram com a referencia documental; as demais exigem aprovador identificado.
 * Este arquivo e a fonte de verdade do TEXTO da regra; o banco e a fonte do STATUS.
 */
export type RuleStatus = "proposed" | "pending" | "approved" | "retired";

export interface RuleApproval {
  approverName: string;
  approverRole: string;
  approvedAt: string;
  effectiveFrom: string;
  source: string;
}

export interface RuleSeed {
  key: string;
  version: number;
  name: string;
  status: RuleStatus;
  statement: string;
  definition: Record<string, unknown>;
  decisionId: string;
  /** Presente somente quando existe documento aprovado e assinado que sustenta a regra. */
  approval?: RuleApproval;
  /**
   * Presente quando a regra vem de decisao verbal/registrada do responsavel. O aprovador NAO
   * fica no codigo: e resolvido em tempo de seed a partir de WIN_DECISION_APPROVER.
   */
  decidedAt?: string;
}

/**
 * Documento que aprova formalmente o Programa WIN.
 *
 * O aprovador identificavel e o DOCUMENTO ASSINADO, referenciado pelo seu codigo e revisao.
 * Nomes de signatarios, CPFs e o link de validacao NAO ficam no codigo: sao dados pessoais de
 * terceiros e o repositorio pode ser compartilhado. Quem precisa auditar a assinatura vai ao
 * documento fisico/eletronico, cuja referencia esta abaixo.
 */
export const SIGNED_POLICY = {
  code: "LOCTL CORP COML 001",
  revision: "03",
  title: "Politica corporativa de incentivo a geracao de novos negocios — Programa WIN",
  issuedAt: "2026-09-01",
  effectiveFrom: "2026-09-01T00:00:00-03:00",
  lastSignatureAt: "2026-08-31T16:56:42-03:00",
  approverName: "LOCTL CORP COML 001 rev. 03 — documento assinado eletronicamente",
  approverRole: "People & Culture, Juridico e Comercial (assinatura eletronica avancada)",
} as const;

const POLICY_APPROVAL = (section: string): RuleApproval => ({
  approverName: SIGNED_POLICY.approverName,
  approverRole: SIGNED_POLICY.approverRole,
  approvedAt: SIGNED_POLICY.lastSignatureAt,
  effectiveFrom: SIGNED_POLICY.effectiveFrom,
  source: `${SIGNED_POLICY.code} rev. ${SIGNED_POLICY.revision} — ${section}`,
});

/**
 * Decisoes tomadas fora do documento assinado (D-03, D-04, D-06, D-27, D-28).
 *
 * O gate do Rules Pack exige aprovador IDENTIFICAVEL. "Responsavel pelo Programa WIN" e um
 * cargo, nao uma pessoa — nao satisfaz o gate. Por isso o nome vem de configuracao
 * (WIN_DECISION_APPROVER) e NAO do codigo. Sem ele, estas regras permanecem 'proposed' e as
 * funcionalidades que dependem delas seguem desligadas. E deliberado: e melhor o piloto comecar
 * desligado do que comecar com aprovacao anonima no registro.
 */
export function decisionApproval(
  approverName: string | undefined, decidedAt: string,
): RuleApproval | undefined {
  if (!approverName || !approverName.trim()) return undefined;
  return {
    approverName: approverName.trim(),
    approverRole: "Responsavel pelo Programa WIN — Locatelli Group",
    approvedAt: decidedAt,
    effectiveFrom: decidedAt,
    source: `Decisao registrada em ${decidedAt.slice(0, 10)} (WIN_DECISION_APPROVER)`,
  };
}

export const DECISION_RULE_KEYS = [
  "RULE_POINTS_ACCRUAL", "RULE_DUPLICATE_KEY", "RULE_REFERRAL_STATE_MACHINE",
  "RULE_OPERATING_MODEL", "RULE_SHARED_AWARD_SPLIT", "RULE_OPPORTUNITY_TYPES",
  "RULE_QUALIFIED_MEETING", "RULE_REFERRAL_VALIDITY", "RULE_CLIENT_COMPANY_VISIBILITY",
] as const;

export const RULE_SEEDS: readonly RuleSeed[] = [
  {
    key: "RULE_POINTS_ACCRUAL",
    version: 1,
    name: "Cumulatividade dos pontos entre etapas",
    status: "proposed",
    decisionId: "D-03",
    statement:
      "ESCOPO CONFIRMADO pelo responsavel em 2026-09-03: os pontos existem para os colaboradores " +
      "e sao camada propria do programa. A politica LOCTL CORP COML 001 rev. 03 e documento " +
      "interno que rege a PREMIACAO EM DINHEIRO; ela nao trata de pontos, e as duas camadas " +
      "convivem. O que ainda falta e o VALOR por etapa e o modo de acumulo. " +
      "PROPOSTA: a pontuacao e nao cumulativa — ao avancar de etapa, lanca-se a diferenca entre a " +
      "pontuacao da nova etapa e a soma ja creditada para a indicacao, de forma que o total por " +
      "indicacao seja sempre igual ao valor da etapa atingida. Alternativa A: cumulativa (soma cada " +
      "etapa). Alternativa B: somente a etapa final pontua.",
    definition: {
      mode: "non_cumulative_delta",
      alternatives: ["cumulative_sum", "final_stage_only"],
      stagePoints: {
        identified: 10, meeting_scheduled: 20, meeting_held: 30, proposal_sent: 50, sale_won: 100, lost: 0,
      },
      impact:
        "Cumulativa multiplica por ~2,1x o total de uma indicacao que percorre todo o funil.",
    },
  },
  {
    key: "RULE_POINTS_ADJUSTMENT",
    version: 1,
    name: "Concessao, estorno e correcao de pontos",
    status: "proposed",
    decisionId: "D-17",
    statement:
      "PROPOSTA: correcao somente por lancamento compensatorio no ledger, com motivo obrigatorio e " +
      "autoria de sessao. Estorno exige a mesma alcada da concessao. Nunca UPDATE/DELETE.",
    definition: { requiresReason: true, compensatingOnly: true, minRole: "administrador" },
  },
  {
    key: "RULE_SHARED_AWARD_SPLIT",
    version: 1,
    name: "Rateio de premiacao compartilhada",
    status: "pending",
    decisionId: "D-29",
    statement:
      "PENDENTE: definir percentuais, arredondamento, vigencia e tratamento de lancamentos " +
      "anteriores antes de permitir premiacao compartilhada.",
    definition: {},
  },
  {
    key: "RULE_DUPLICATE_KEY",
    version: 1,
    name: "Chave e janela de duplicidade",
    status: "proposed",
    decisionId: "D-04",
    statement:
      "PROPOSTA: duas indicacoes sao duplicadas quando coincidem funcionario, servico e empresa " +
      "cliente normalizada dentro de uma janela de 90 dias corridos. Alternativa A: chave sem " +
      "funcionario (duas pessoas nao podem indicar o mesmo cliente). Alternativa B: janela por ciclo.",
    definition: {
      fields: ["staff_id", "service_id", "client_company_normalized"],
      windowDays: 90,
      alternatives: ["global_by_client", "per_cycle_window"],
      onConflict: "flag_for_human_decision",
    },
  },
  {
    key: "RULE_REFERRAL_STATE_MACHINE",
    version: 1,
    name: "Estados e transicoes oficiais da indicacao",
    status: "proposed",
    decisionId: "D-06",
    statement:
      "PROPOSTA: identified -> meeting_scheduled -> meeting_held -> proposal_sent -> sale_won. " +
      "'lost' e alcancavel de qualquer estado nao terminal. Retrocesso proibido; correcao por " +
      "novo evento com motivo. Estados terminais: sale_won, lost.",
    definition: {
      transitions: {
        identified: ["meeting_scheduled", "lost"],
        meeting_scheduled: ["meeting_held", "lost"],
        meeting_held: ["proposal_sent", "lost"],
        proposal_sent: ["sale_won", "lost"],
        sale_won: [],
        lost: [],
      },
      allowBackward: false,
    },
  },
  {
    key: "RULE_TRANSITION_AUTHORITY",
    version: 1,
    name: "Ator autorizado em cada transicao",
    status: "proposed",
    decisionId: "D-07",
    statement:
      "PROPOSTA: participante registra apenas 'identified'. Da etapa 'meeting_held' em diante, " +
      "somente validador_comercial ou administrador. 'sale_won' exige validador_comercial.",
    definition: {
      byStage: {
        identified: ["participante", "validador_comercial", "administrador"],
        meeting_scheduled: ["validador_comercial", "administrador"],
        meeting_held: ["validador_comercial", "administrador"],
        proposal_sent: ["validador_comercial", "administrador"],
        sale_won: ["validador_comercial"],
        lost: ["validador_comercial", "administrador"],
      },
    },
  },
  {
    key: "RULE_REFERRAL_VALIDITY",
    version: 1,
    name: "Criterio de indicacao valida",
    status: "pending",
    decisionId: "D-18",
    statement:
      "PENDENTE: nao ha criterio comercial informado. Nao ha recomendacao tecnica possivel sem " +
      "definicao de negocio (ex.: cliente ja ativo conta? prospect frio conta?).",
    definition: {},
  },
  {
    key: "RULE_TERRITORY_THRESHOLD",
    version: 1,
    name: "Threshold de conquista de territorio",
    status: "proposed",
    decisionId: "D-05",
    statement:
      "ATENCAO: a politica assinada LOCTL CORP COML 001 rev. 03 NAO menciona pontos, territorios nem ranking. Esta camada de gamificacao continua sem respaldo documental e permanece desligada ate decisao propria. PROPOSTA: um servico e 'conquistado' quando existe ao menos uma indicacao em 'sale_won' " +
      "para aquele servico. O territorio e conquistado quando 100% dos servicos do territorio " +
      "estao conquistados. Alternativa A: percentual configuravel. Alternativa B: por pontos.",
    definition: { serviceRule: "at_least_one_sale_won", territoryRule: "all_services", alternatives: ["percentage", "points"] },
  },
  {
    key: "RULE_TERRITORY_RETENTION",
    version: 1,
    name: "Manutencao, perda ou expiracao de territorio",
    status: "pending",
    decisionId: "D-19",
    statement: "ATENCAO: a politica assinada LOCTL CORP COML 001 rev. 03 NAO menciona pontos, territorios nem ranking. Esta camada de gamificacao continua sem respaldo documental e permanece desligada ate decisao propria. PENDENTE: nao informado se a conquista e permanente, por ciclo ou expiravel.",
    definition: {},
  },
  {
    key: "RULE_RANKING_CYCLE",
    version: 1,
    name: "Periodicidade oficial e desempate do ranking",
    status: "proposed",
    decisionId: "D-08",
    statement:
      "ATENCAO: a politica assinada LOCTL CORP COML 001 rev. 03 NAO menciona pontos, territorios nem ranking. Esta camada de gamificacao continua sem respaldo documental e permanece desligada ate decisao propria. PROPOSTA: ciclo oficial mensal (semanal e trimestral seguem como visoes). Desempate: " +
      "1) maior numero de indicacoes em 'sale_won'; 2) menor tempo medio ate 'sale_won'; " +
      "3) ordem alfabetica do codigo do funcionario (deterministico e auditavel).",
    definition: {
      officialPeriodicity: "monthly",
      tiebreakers: ["sale_won_count", "avg_time_to_win", "staff_external_code"],
    },
  },
  {
    key: "RULE_CROSS_SELL",
    version: 1,
    name: "Identificacao de cross-sell",
    status: "pending",
    decisionId: "D-20",
    statement: "PENDENTE: intencao registrada no briefing, sem regra operacional.",
    definition: {},
  },
  {
    key: "RULE_FINANCIAL_BONUS",
    version: 1,
    name: "Bonificacao financeira",
    status: "pending",
    decisionId: "D-09",
    statement:
      "PENDENTE: escopo nao confirmado. O sistema nao calcula, nao exibe e nao persiste valor " +
      "de bonificacao enquanto esta regra nao for aprovada.",
    definition: { inMvp: false, evidence: "ausencia no prototipo nao e decisao de escopo" },
  },

  /* ======================================================================== */
  /* REGRAS APROVADAS PELA POLITICA ASSINADA (LOCTL CORP COML 001 rev. 03).    */
  /* Entram como versao 2 (ou versao 1, quando a chave e nova) para preservar  */
  /* a versao 1 'proposed' como registro historico do que foi suposto antes.   */
  /* ======================================================================== */
  {
    key: "RULE_OPERATING_MODEL",
    version: 1,
    name: "Historico: planilha e conferencia manual",
    status: "retired",
    decisionId: "D-27",
    // Aprovador vem de WIN_DECISION_APPROVER; sem ele esta regra fica 'proposed'.
    decidedAt: "2026-09-03T00:00:00Z",
    statement:
      "No estagio atual os dados entram por planilha Excel e a conferencia e feita MANUALMENTE " +
      "por pessoa identificada. O sistema nao substitui essa conferencia: ele a torna auditavel. " +
      "Quem confirma a importacao atesta a conferencia, e esse ato fica registrado com autoria de " +
      "sessao, data e o conjunto exato de linhas atestadas. Integracoes automaticas sao " +
      "evolucao futura, nao premissa do MVP.",
    definition: {
      dataEntry: "spreadsheet_upload",
      conference: "manual_attested_on_confirm",
      attestationRequired: true,
    },
  },
  {
    key: "RULE_POINTS_ACCRUAL",
    version: 2,
    name: "Pontuacao cumulativa por etapa",
    status: "approved",
    decisionId: "D-03",
    // Aprovador vem de WIN_DECISION_APPROVER; sem ele esta regra fica 'proposed'.
    decidedAt: "2026-09-03T00:00:00Z",
    statement:
      "DECIDIDO em 2026-09-03: a pontuacao e CUMULATIVA. Cada etapa alcancada soma os seus " +
      "pontos ao total do colaborador. Uma indicacao que percorre todo o funil acumula " +
      "10 + 20 + 30 + 50 + 100 = 210 pontos. Etapa perdida nao pontua. Etapa nao registrada nao " +
      "paga retroativamente: pontua-se a etapa efetivamente informada no momento em que ela e " +
      "registrada. Os pontos sao camada de engajamento e convivem com a premiacao em dinheiro; " +
      "nao sao conversiveis entre si.",
    definition: {
      mode: "cumulative_sum",
      stagePoints: {
        identified: 10, meeting_scheduled: 20, meeting_held: 30, proposal_sent: 50,
        sale_won: 100, lost: 0,
      },
      skippedStagesPay: false,
      coexistsWith: "RULE_FINANCIAL_BONUS — pontos engajam, premiacao paga.",
    },
  },
  {
    key: "RULE_REFERRAL_STATE_MACHINE",
    version: 2,
    name: "Sequencia oficial das etapas da indicacao",
    status: "approved",
    decisionId: "D-06",
    // Aprovador vem de WIN_DECISION_APPROVER; sem ele esta regra fica 'proposed'.
    decidedAt: "2026-09-03T00:00:00Z",
    statement:
      "Sequencia confirmada de forma implicita ao aprovar a pontuacao cumulativa por etapa " +
      "(D-03): identified -> meeting_scheduled -> meeting_held -> proposal_sent -> sale_won. " +
      "'lost' e alcancavel de qualquer etapa nao terminal. Retrocesso continua proibido; " +
      "correcao se faz por novo evento com motivo, nunca reescrevendo o historico.",
    definition: {
      transitions: {
        identified: ["meeting_scheduled", "meeting_held", "proposal_sent", "sale_won", "lost"],
        meeting_scheduled: ["meeting_held", "proposal_sent", "sale_won", "lost"],
        meeting_held: ["proposal_sent", "sale_won", "lost"],
        proposal_sent: ["sale_won", "lost"],
        sale_won: [],
        lost: [],
      },
      order: ["identified", "meeting_scheduled", "meeting_held", "proposal_sent", "sale_won"],
      allowBackward: false,
      allowSkip: true,
    },
  },
  {
    key: "RULE_DUPLICATE_KEY",
    version: 3,
    name: "Titularidade do piloto: empresa cliente e servico",
    status: "approved",
    decisionId: "D-04",
    // Aprovador vem de WIN_DECISION_APPROVER; sem ele esta regra fica 'proposed'.
    decidedAt: "2026-09-03T00:00:00Z",
    statement:
      "No piloto por planilha (D-28), a oportunidade e identificada por empresa cliente " +
      "normalizada + servico. Vale quem registrou primeiro. Uma reivindicacao posterior do " +
      "MESMO colaborador com etapa mais avancada e tratada como PROGRESSAO da mesma " +
      "oportunidade. De colaborador diferente, vira conflito de titularidade pendente para a " +
      "Diretoria com o Comercial — o sistema nao decide.",
    definition: {
      key: ["client_company_normalized", "service_id"],
      tieBreak: "first_registration_wins",
      windowDays: null,
      progressionOnAdvancedStage: true,
      conflictResolution: {
        authority: ["diretoria", "comercial"],
        outcomes: ["single_owner", "shared_award"],
        requiresRecordedDecision: true,
      },
    },
  },
  {
    key: "RULE_OPERATING_MODEL",
    version: 2,
    name: "Piloto: planilha Excel e conferencia manual",
    status: "approved",
    decisionId: "D-28",
    // Aprovador vem de WIN_DECISION_APPROVER; sem ele esta regra fica 'proposed'.
    decidedAt: "2026-09-03T00:00:00Z",
    statement:
      "No primeiro momento os dados sobem por planilha Excel e a conferencia e manual, para " +
      "testar a aderencia do programa antes de escalar. Quem " +
      "confirma a importacao atesta a conferencia, com autoria de sessao, data e quantidade de " +
      "linhas. O registro no Programa WIN nao dispensa a validacao comercial.",
    definition: {
      dataEntry: "spreadsheet_upload",
      conference: "manual_attested_on_confirm",
      // A v2 substitui a v1: precisa reafirmar a obrigatoriedade, senao a versao vigente
      // silenciosamente deixaria de exigir a atestacao.
      attestationRequired: true,
      systemOfRecord: "programa_win",
      stage: "pilot",
    },
  },
  {
    key: "RULE_OPPORTUNITY_TYPES",
    version: 2,
    name: "Tipos de oportunidade no piloto por planilha",
    status: "approved",
    decisionId: "D-28",
    decidedAt: "2026-09-03T00:00:00Z",
    statement:
      "Os quatro tipos aprovados continuam vigentes. Durante o piloto, cada oportunidade e " +
      "registrada de forma auditavel no proprio Programa WIN e validada pela Area Comercial.",
    definition: {
      types: ["new_client", "new_service", "cross_sell", "up_sell"],
      systemOfRecord: "programa_win",
      requiresCommercialValidation: true,
    },
  },
  {
    key: "RULE_QUALIFIED_MEETING",
    version: 2,
    name: "Reuniao qualificada no piloto por planilha",
    status: "approved",
    decisionId: "D-28",
    decidedAt: "2026-09-03T00:00:00Z",
    statement:
      "R$ 50,00 por reuniao efetivamente realizada quando todos os requisitos forem atendidos. " +
      "No piloto, o requisito operacional de registro e satisfeito pelo rastro auditavel do " +
      "Programa WIN; a validacao da Area Comercial permanece obrigatoria.",
    definition: {
      amount: "50.00",
      currency: "BRL",
      requirements: [
        "icp_fit", "decision_maker", "potential_identified", "meeting_held",
        "program_registered", "commercial_validated",
      ],
      cumulative: true,
      independentOfContract: true,
      perOpportunity: 1,
    },
  },
  {
    key: "RULE_REFERRAL_VALIDITY",
    version: 3,
    name: "Validade e governanca no piloto por planilha",
    status: "approved",
    decisionId: "D-28",
    decidedAt: "2026-09-03T00:00:00Z",
    statement:
      "A oportunidade do piloto e registrada no Programa WIN, atribuida a um participante, " +
      "conferida manualmente e validada pela Area Comercial. Nao se exige identificador externo. " +
      "O registro interno nao dispensa a verificacao de oportunidade preexistente nem as demais " +
      "condicoes da politica.",
    definition: {
      cumulativeCriteria: [
        "program_registration", "origin_attributable_to_participant",
        "not_previously_owned_by_commercial", "commercial_validation",
      ],
      systemOfRecord: "programa_win",
      ineligible: [
        "already_registered_by_commercial", "generated_by_commercial",
        "renewal_or_contractual_readjustment", "normal_contract_execution",
        "marketing_originated_only", "regular_duties_without_commercial_action",
        "brokerage_related",
      ],
      marketingException: "developed_by_participant_and_validated",
    },
  },
  {
    key: "RULE_CLIENT_COMPANY_VISIBILITY",
    version: 3,
    name: "Empresa cliente restrita no piloto",
    status: "approved",
    decisionId: "D-12",
    decidedAt: "2026-09-03T00:00:00Z",
    statement:
      "A empresa cliente nao sai do backend. Nenhuma resposta de API, tela ou exportacao carrega " +
      "seu nome. O campo permanece no banco apenas para deduplicacao e auditoria; a referencia " +
      "operacional opcional e um codigo interno informado na planilha.",
    definition: {
      exposedInApi: false,
      exposedInExport: false,
      visibleTo: [],
      retainedFor: ["deduplication", "audit"],
      operationalIdentifier: "client_reference",
    },
  },
  {
    key: "RULE_PARTICIPANT_ELIGIBILITY",
    version: 1,
    name: "Quem participa do Programa WIN",
    status: "approved",
    decisionId: "D-23",
    approval: POLICY_APPROVAL("secao 1 — Abrangencia e participantes"),
    statement:
      "Participam colaboradores CLT das empresas elegiveis do Grupo Locatelli. NAO participam: " +
      "colaboradores da Area Comercial com programa proprio de remuneracao variavel (salvo " +
      "previsao expressa), prestadores de servico e terceiros, socios, e colaboradores " +
      "vinculados a corretora do Grupo.",
    definition: {
      includes: ["clt_empresa_elegivel"],
      excludes: [
        "comercial_com_remuneracao_variavel",
        "prestador_ou_terceiro",
        "socio",
        "vinculado_corretora",
      ],
      exceptionRequires: "instrumento proprio expresso",
    },
  },
  {
    key: "RULE_OPPORTUNITY_TYPES",
    version: 1,
    name: "Tipos de oportunidade elegivel",
    status: "retired",
    decisionId: "D-20",
    approval: POLICY_APPROVAL("secao 2 — Oportunidades elegiveis"),
    statement:
      "Novo cliente: empresa sem contrato ativo, proposta em negociacao ou oportunidade " +
      "previamente registrada no CRM, que contrate em decorrencia da atuacao do colaborador. " +
      "Novo servico: expansao real de escopo para cliente da carteira. Cross-sell: cliente de " +
      "uma empresa do Grupo contrata servico de outra empresa ou area elegivel. Up-sell: " +
      "ampliacao relevante de escopo ou volume que nao decorra de obrigacao, reajuste ou " +
      "clausula ja prevista.",
    definition: {
      types: ["new_client", "new_service", "cross_sell", "up_sell"],
      crossSell: "contratacao entre empresas ou areas elegiveis do Grupo",
      upSellExcludes: ["obrigacao_contratual", "reajuste", "clausula_prevista"],
    },
  },
  {
    key: "RULE_QUALIFIED_MEETING",
    version: 1,
    name: "Reuniao qualificada",
    status: "retired",
    decisionId: "D-24",
    approval: POLICY_APPROVAL("secao 4 — Reuniao qualificada"),
    statement:
      "R$ 50,00 por reuniao efetivamente realizada, independentemente de contratacao posterior, " +
      "desde que TODOS os requisitos sejam atendidos cumulativamente: empresa aderente ao perfil " +
      "de cliente; participacao de decisor ou influenciador relevante; potencial identificado " +
      "para contratacao; reuniao efetivamente realizada; oportunidade registrada no Ploomes; " +
      "validacao pela Area Comercial.",
    definition: {
      amount: "50.00",
      currency: "BRL",
      requirements: [
        "icp_fit", "decision_maker", "potential_identified",
        "meeting_held", "ploomes_registered", "commercial_validated",
      ],
      cumulative: true,
      independentOfContract: true,
      perOpportunity: 1,
    },
  },
  {
    key: "RULE_FINANCIAL_BONUS",
    version: 2,
    name: "Tabela de premiacao (Anexo I)",
    status: "approved",
    decisionId: "D-09",
    approval: POLICY_APPROVAL("secao 3 e Anexo I — Modalidades de premiacao"),
    statement:
      "Reuniao qualificada realizada: R$ 50,00 ao colaborador, nao aplicavel ao gestor. " +
      "Novo servico / cross-sell / up-sell: 1,50% ao colaborador e 0,50% ao gestor. " +
      "Novo cliente por indicacao/networking: 3,00% ao colaborador. " +
      "Novo cliente originado diretamente pelo gestor: 3,00% ao gestor.",
    definition: {
      currency: "BRL",
      table: [
        { situation: "qualified_meeting", beneficiary: "collaborator", kind: "fixed", fixedAmount: "50.00" },
        { situation: "new_service_cross_up_sell", beneficiary: "collaborator", kind: "percentage", rate: "0.0150" },
        { situation: "new_service_cross_up_sell", beneficiary: "manager", kind: "percentage", rate: "0.0050" },
        { situation: "new_client_referral", beneficiary: "collaborator", kind: "percentage", rate: "0.0300" },
        { situation: "new_client_by_manager", beneficiary: "manager", kind: "percentage", rate: "0.0300" },
      ],
      coexistsWith: "RULE_POINTS_ACCRUAL — camadas distintas: pontos engajam, premiacao paga.",
    },
  },
  {
    key: "RULE_CALCULATION_BASE",
    version: 1,
    name: "Base de calculo — receita liquida",
    status: "approved",
    decisionId: "D-25",
    approval: POLICY_APPROVAL("secao 5 — Base de calculo"),
    statement:
      "Receita liquida e a receita efetivamente RECEBIDA pela empresa elegivel, excluidos " +
      "impostos incidentes, descontos comerciais, reembolsos, cancelamentos, estornos, " +
      "inadimplencia e demais deducoes. Projetos com faturamento unico: percentual sobre a " +
      "receita liquida efetivamente recebida. Contratos recorrentes: percentual sobre a receita " +
      "liquida efetivamente recebida nos primeiros 12 meses do contrato.",
    definition: {
      basis: "net_revenue_received",
      excludes: ["impostos", "descontos", "reembolsos", "cancelamentos", "estornos", "inadimplencia"],
      oneOff: { window: null },
      recurring: { windowMonths: 12, anchor: "contract_signed_at" },
      rounding: "half_up_2_decimals_no_float",
    },
  },
  {
    key: "RULE_REFERRAL_VALIDITY",
    version: 2,
    name: "Registro, titularidade e governanca da oportunidade",
    status: "retired",
    decisionId: "D-18",
    approval: POLICY_APPROVAL("secoes 6 e 7 — Registro, titularidade, governanca e nao elegiveis"),
    statement:
      "A oportunidade so e elegivel quando cumprir CUMULATIVAMENTE: registro previo no Ploomes; " +
      "origem comprovadamente atribuida ao colaborador; nao estar previamente registrada ou em " +
      "negociacao pela Area Comercial; validacao pela Area Comercial; e as demais condicoes da " +
      "Politica. Nao sao elegiveis, entre outras: oportunidades ja registradas ou geradas pelo " +
      "Comercial; renovacoes, reajustes e aditivos de clausula existente; receitas de execucao " +
      "normal do contrato; oportunidades originadas exclusivamente por campanhas de Marketing; " +
      "contratacao decorrente apenas da execucao regular das atividades do colaborador; e tudo " +
      "relacionado a corretora do Grupo. Excecao: lead de Marketing torna-se elegivel se for " +
      "efetivamente desenvolvido pelo colaborador, gerando nova oportunidade registrada, " +
      "comprovada e validada pelo Comercial.",
    definition: {
      cumulativeCriteria: [
        "ploomes_prior_registration",
        "origin_attributable_to_collaborator",
        "not_previously_owned_by_commercial",
        "commercial_validation",
      ],
      ineligible: [
        "already_registered_by_commercial",
        "generated_by_commercial",
        "renewal_or_contractual_readjustment",
        "normal_contract_execution",
        "marketing_originated_only",
        "regular_duties_without_commercial_action",
        "brokerage_related",
      ],
      marketingException: "developed_by_collaborator_and_validated",
    },
  },
  {
    key: "RULE_DUPLICATE_KEY",
    version: 2,
    name: "Historico: titularidade por identificador de CRM",
    status: "retired",
    decisionId: "D-04",
    approval: POLICY_APPROVAL("secao 6 — Conflito de titularidade"),
    statement:
      "A chave da oportunidade e o registro no Ploomes: uma oportunidade tem um unico titular. " +
      "Prioridade de quem registrou primeiro (decisao do responsavel, 2026-09-03). Quando dois " +
      "ou mais colaboradores reivindicarem a mesma oportunidade, a Diretoria, em conjunto com a " +
      "Area Comercial, avalia as evidencias e pode definir um unico responsavel ou estabelecer o " +
      "compartilhamento da premiacao — decisao registrada, nunca automatica.",
    definition: {
      key: ["ploomes_id"],
      tieBreak: "first_registration_wins",
      conflictResolution: {
        authority: ["diretoria", "comercial"],
        outcomes: ["single_owner", "shared_award"],
        requiresRecordedDecision: true,
      },
      windowDays: null,
    },
  },
  {
    key: "RULE_CLIENT_COMPANY_VISIBILITY",
    version: 2,
    name: "Empresa cliente restrita ao backend",
    status: "retired",
    decisionId: "D-12",
    approval: POLICY_APPROVAL("decisao do responsavel em 2026-09-03, sobre a politica vigente"),
    statement:
      "A empresa cliente NAO sai do backend. Nenhuma resposta de API, DTO, tela ou exportacao " +
      "carrega o nome da empresa cliente — nem para administradores. O campo permanece no banco " +
      "apenas para deduplicacao, auditoria e reconciliacao com o Ploomes. A identificacao " +
      "operacional da oportunidade e feita pelo codigo do Ploomes.",
    definition: {
      exposedInApi: false,
      exposedInExport: false,
      visibleTo: [],
      retainedFor: ["deduplication", "audit", "ploomes_reconciliation"],
      operationalIdentifier: "ploomes_id",
    },
  },
  {
    key: "RULE_TRANSITION_AUTHORITY",
    version: 2,
    name: "Alcada de validacao, aprovacao e excecao",
    status: "approved",
    decisionId: "D-07",
    approval: POLICY_APPROVAL("secoes 6, 8 e 10 — governanca, pagamento e excecoes"),
    statement:
      "A Area Comercial valida a elegibilidade da oportunidade e a reuniao qualificada. A " +
      "Diretoria aprova o pagamento, que ocorre na folha subsequente. Conflito de titularidade e " +
      "decidido pela Diretoria em conjunto com o Comercial. Qualquer excecao a Politica exige " +
      "aprovacao previa do CEO | Managing Partner, com registro da justificativa e da decisao.",
    definition: {
      validate: ["validador_comercial", "administrador"],
      approvePayout: ["diretoria"],
      resolveTitularity: ["diretoria"],
      grantException: ["ceo"],
      requiresRecordedJustification: true,
    },
  },
  {
    key: "RULE_PAYMENT",
    version: 1,
    name: "Pagamento e ajuste posterior",
    status: "approved",
    decisionId: "D-26",
    approval: POLICY_APPROVAL("secao 8 — Pagamento da premiacao"),
    statement:
      "A premiacao por geracao de novos negocios e devida apos assinatura do contrato, inicio da " +
      "prestacao, emissao da primeira nota fiscal quando aplicavel e RECEBIMENTO da receita que " +
      "constitui a base de calculo. O pagamento ocorre na folha subsequente a validacao do " +
      "Comercial e a aprovacao da Diretoria. Cancelamentos, estornos, devolucoes ou nao " +
      "recebimento geram ajuste em apuracao posterior.",
    definition: {
      accrualTrigger: "net_revenue_received",
      prerequisites: ["contract_signed", "service_started", "first_invoice_when_applicable", "revenue_received"],
      payrollTiming: "folha_subsequente",
      requiresDirectorApproval: true,
      adjustmentOnReversal: "compensating_entry",
    },
  },
  {
    key: "RULE_AWARD_ADJUSTMENT",
    version: 1,
    name: "Estorno e correcao da premiacao",
    status: "approved",
    decisionId: "D-17",
    approval: POLICY_APPROVAL("secao 8 — ajuste em apuracao posterior"),
    statement:
      "Correcao de premiacao acontece exclusivamente por lancamento compensatorio no ledger, com " +
      "motivo obrigatorio e autoria de sessao. Nenhum lancamento historico e alterado ou apagado.",
    definition: { compensatingOnly: true, requiresReason: true, minRole: "administrador" },
  },
  {
    key: "RULE_RETENTION_INACTIVATION",
    version: 1,
    name: "Inativacao e retencao de registros",
    status: "pending",
    decisionId: "D-11",
    statement:
      "PENDENTE: depende de parecer do responsavel por privacidade. O schema ja suporta soft " +
      "delete; nenhuma rotina de expurgo esta ativa.",
    definition: {},
  },
  {
    key: "RULE_CYCLE_CLOSING",
    version: 1,
    name: "Fechamento e alteracao retroativa de ciclos",
    status: "proposed",
    decisionId: "D-14",
    statement:
      "ATENCAO: a politica assinada LOCTL CORP COML 001 rev. 03 NAO menciona pontos, territorios nem ranking. Esta camada de gamificacao continua sem respaldo documental e permanece desligada ate decisao propria. PROPOSTA: ao fechar um ciclo, grava-se ranking_snapshot imutavel. Fatos com data dentro de " +
      "um ciclo fechado sao aceitos, mas so afetam o ciclo corrente, nunca o snapshot publicado.",
    definition: { snapshotOnClose: true, retroactiveAffectsClosed: false },
  },
  {
    key: "RULE_CLIENT_COMPANY_VISIBILITY",
    version: 1,
    name: "Exibicao da empresa cliente",
    status: "proposed",
    decisionId: "D-12",
    statement:
      "PROPOSTA: empresa cliente NUNCA aparece em ranking, mapa ou perfil de terceiros. Visivel " +
      "apenas ao proprio indicador, ao validador e ao administrador. Padrao seguro ate aprovacao.",
    definition: { visibleTo: ["owner", "validador_comercial", "administrador"], defaultHidden: true },
  },
  {
    key: "RULE_ANTIFRAUD",
    version: 1,
    name: "Antifraude do programa",
    status: "pending",
    decisionId: "D-15",
    statement:
      "PENDENTE: nao ha regra para autoindicacao, conluio ou indicacao de cliente ja ativo.",
    definition: {},
  },
  {
    key: "RULE_POINTS_DISPUTE",
    version: 1,
    name: "Contestacao de pontuacao",
    status: "pending",
    decisionId: "D-21",
    statement:
      "PENDENTE: sem processo definido. A trilha de auditoria ja fornece a evidencia necessaria " +
      "para instruir uma contestacao quando o processo existir.",
    definition: {},
  },
];
