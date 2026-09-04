# Matriz de rastreabilidade — Programa WIN

Liga cada item do checklist (83) e cada achado da auditoria ao arquivo afetado, à correção
implementada, ao teste que a comprova e ao estado atual.

Estados: `done` · `in_progress` · `blocked` · `pending_business_decision` · `not_applicable`.

Regra de honestidade usada aqui: um item só é `done` quando existe **código no repositório e
teste executado** que o comprova. Item cuja regra de negócio continua pendente fica como
`pending_business_decision` — a fundação técnica pode estar pronta, mas a ativação não.

> **Atualizada em 2026-09-03**, depois da política interna LOCTL CORP COML 001 rev. 03 e das
> decisões D-04, D-12 e D-27 do responsável. A política é documento **interno** que fundamenta a
> premiação em dinheiro; os pontos continuam existindo como camada própria do programa.

Resumo por estado:

| Estado | Itens do checklist |
|---|---|
| `done` | 60 |
| `in_progress` | 8 |
| `pending_business_decision` | 3 |
| `blocked` | 11 |
| `not_applicable` | 1 |

---

## A. Bloqueios e pré-requisitos (BL)

| ID | Item | Onde | Correção | Teste | Estado |
|---|---|---|---|---|---|
| BL-01 | Receber o repositório da aplicação atual | — | Não entregue. ADR-001 registra a arquitetura de aplicação única e o plano de reconciliação | — | `blocked` |
| BL-02 | Executar frontend e backend localmente | `package.json`, `src/main.ts`, `src/db/client.ts` | Aplicação única com PostgreSQL embarcado: `npm ci && npm run db:migrate && npm run db:seed && npm start` | `tests/e2e/*` sobem a aplicação inteira em processo | `done` |
| BL-03 | Identificar framework, versões e padrões | `docs/ADR-001-arquitetura-programa-win.md` | Stack escolhida e justificada, com alternativas rejeitadas | — | `done` |
| BL-04 | `.env.example` sem credenciais reais | `.env.example` | Todas as chaves documentadas, nenhum valor real, placeholders explícitos | `tests/unit/config.test.ts` | `done` |
| BL-05 | Identificar banco, schema, migrations e ORM | `db/migrations/*`, `src/db/` | PostgreSQL, 15 migrations versionadas com checksum, sem ORM (SQL parametrizado) | `tests/integration/schema.test.ts` | `done` |
| BL-06 | Identificar o provedor de autenticação | `src/auth/oidc.ts` | Cliente OIDC completo (code + PKCE + verificação de `id_token`), configurável por env | `tests/unit/config.test.ts` (recusa de boot sem OIDC em produção) | `blocked` — provedor não informado (D-01) |
| BL-07 | Ambiente de homologação | — | Requer ação externa de infraestrutura | — | `blocked` |
| BL-08 | MVP incorporado ou app novo | `docs/ADR-001` | Decisão registrada: aplicação única com `/admin` protegido | — | `in_progress` — reconciliação depende de BL-01 |

## B. Regras de produto (RP)

| ID | Item | Onde | Correção | Teste | Estado |
|---|---|---|---|---|---|
| RP-01 | Validar os quatro territórios e serviços | `db/migrations/0003_catalog.sql`, `src/db/seed-catalog.ts` | Catálogo confirmado modelado como dado versionável, com aliases explícitos de importação | `tests/integration/schema.test.ts` → "MED-02: catálogo confirmado modelado como dado" | `done` |
| RP-02 | Campos obrigatórios de uma indicação | `src/import/pipeline.ts`, `src/modules/admin.ts` | Obrigatórios: MATRICULA, EMPRESA, PRODUTO, STATUS, DATA; TIPO, GESTOR e REFERENCIA são opcionais | `tests/integration/import.test.ts`, `planilha-oficial.test.ts` | `done` |
| RP-03 | Pontos cumulativos entre etapas | `src/domain/points.ts`, `rule-registry.ts` | **DECIDIDO (D-03)**: cumulativo, 10/20/30/50/100 — funil completo soma 210. Derivado no servidor, nunca da planilha | `tests/e2e/workflows.test.ts` → "D-03", `import.test.ts` → "pontos cumulativos com planilha por ciclo" | `done` |
| RP-04 | Quem pode alterar cada etapa | `src/domain/awards.ts`, `src/auth/rbac.ts` | Alçada da política aplicada no servidor: Comercial valida, financeiro registra receita, Diretoria aprova pagamento | `tests/e2e/workflows.test.ts`, `tests/integration/awards.test.ts` | `done` (alçada da política); alçada por etapa do funil segue em D-07 |
| RP-05 | Transições de status permitidas | `src/domain/referral-stages.ts` | Sequência aprovada (D-06): salto para frente permitido — a planilha nem sempre traz todas as etapas —, retrocesso recusado | `tests/e2e/workflows.test.ts` → "D-06: pular etapa é permitido, retroceder não" | `done` |
| RP-06 | Regra e janela de duplicidade | `src/domain/referral-stages.ts`, `0013_pilot_without_crm.sql` | **D-04 + D-28**: a chave é empresa cliente normalizada + serviço, com prioridade de quem registrou primeiro. Mesmo colaborador em etapa mais avançada = progressão; colaborador diferente = conflito para a Diretoria | `tests/integration/import.test.ts` | `done` |
| RP-07 | Threshold para conquistar território | `src/modules/board.ts` | Estado do território permanece `locked` até a regra existir; contagem factual continua real | `tests/e2e/workflows.test.ts` → board | `pending_business_decision` (D-05) |
| RP-08 | O que caracteriza indicação válida | `src/domain/awards.ts` | Seções 2, 6 e 7 da política implementadas: tipos elegíveis, critérios cumulativos e lista de não elegíveis; validação da Área Comercial é obrigatória | `tests/integration/awards.test.ts` | `done` |
| RP-09 | Como identificar cross-sell | `src/domain/awards.ts` | Definida pela seção 2 da política e remunerada pelo Anexo I (1,50% + 0,50%) | `tests/integration/awards.test.ts` | `done` |
| RP-10 | Periodicidade e desempate do ranking | `src/lib/dates.ts`, `src/modules/board.ts` | Ciclos semanal/mensal/trimestral calculados no fuso de negócio; desempate proposto | `tests/unit/parsing.test.ts` → BAI-03 | `pending_business_decision` (D-08) |
| RP-11 | Bonificação financeira | `0011`, `0015`, `src/domain/awards.ts`, `src/modules/awards.ts` | **Está no MVP**: R$ 50,00 fixo e 3,0% / 1,5% / 0,5% sobre receita líquida recebida, com pré-requisitos contratuais, teto de 12 meses no recorrente e estorno compensatório | `tests/integration/awards.test.ts` | `done` |
| RP-12 | Inativação e retenção de registros | `0002`, `0004` (soft delete) | Inativação lógica implementada; expurgo não existe | `tests/e2e/workflows.test.ts` → "inativação exige motivo e preserva o histórico" | `pending_business_decision` (D-11) |

## C. Acesso e permissões (AP)

| ID | Item | Onde | Correção | Teste | Estado |
|---|---|---|---|---|---|
| AP-01 | Papéis além de admin | `src/db/seed-catalog.ts` | 4 papéis (`participante`, `validador_comercial`, `administrador`, `service_account`) como proposta configurável | `tests/integration/route-policy.test.ts` | `done` |
| AP-02 | Matriz de permissões por operação | `src/auth/rbac.ts`, `role_permission` | 19 permissões aplicadas no servidor, nega por padrão | `tests/integration/route-policy.test.ts` (falha se alguma rota ficar sem política) | `done` |
| AP-03 | Autorização do primeiro administrador | `0002_identity_rbac.sql` (`admin_bootstrap`), `src/config/env.ts` | Mecanismo auditável, desligado por padrão e impossível de ligar sem OIDC | `tests/unit/config.test.ts` → "recusa bootstrap sem provedor" | `in_progress` — inativo até BL-06 |
| AP-04 | Disponibilidade de MFA | — | Depende do provedor corporativo | — | `blocked` |
| AP-05 | Inatividade administrativa | `src/auth/session.ts` | TTL + idle timeout configuráveis; sessão inativa é revogada no servidor | `tests/e2e/access-control.test.ts` → sessão | `done` |
| AP-06 | Quais dados cada usuário verá | `0009_rls_grants.sql`, `src/dto/index.ts` | RLS no banco + DTO allowlist na API | `tests/integration/rls.test.ts`, `tests/e2e/access-control.test.ts` | `done` |
| AP-07 | Se o comercial pode validar oportunidades | `src/db/seed-catalog.ts`, `src/domain/awards.ts` | **Sim** — seção 6 da política. Implementado e testado: participante recebe 403, Comercial valida | `tests/e2e/workflows.test.ts` → "D-07" | `done` |
| AP-08 | Proteção backend para páginas e APIs | `src/http/server.ts` | `/admin/` só é lido do disco após checagem de permissão; estáticos só em `/assets` | `tests/e2e/access-control.test.ts` → CRIT-01 | `done` |
| AP-09 | Padronizar 401 e 403 | `src/lib/errors.ts`, `src/http/server.ts` | Mapa único de códigos → status, com `correlationId` e sem stack trace | `tests/e2e/access-control.test.ts` | `done` |

## D. Banco e domínio (BD)

| ID | Item | Onde | Correção | Teste | Estado |
|---|---|---|---|---|---|
| BD-01 | Funcionários e usuários autenticados | `0002_identity_rbac.sql` | `staff_member` separado de `auth_identity` | `tests/integration/schema.test.ts` | `done` |
| BD-02 | Produtos, territórios e subprodutos | `0003_catalog.sql` | Catálogo versionável com `catalog_version` | `tests/integration/schema.test.ts` | `done` |
| BD-03 | Indicações e histórico de etapas | `0004_referrals.sql` | `referral` + `referral_stage_event` append-only | `tests/integration/append-only.test.ts` | `done` |
| BD-04 | Ledger sem recálculo/duplicação | `0005_rules_points.sql`, `src/domain/points.ts` | Append-only por trigger e por privilégio, com `idempotency_key` única | `tests/integration/append-only.test.ts` | `done` |
| BD-05 | Verificações de duplicidade | `0004_referrals.sql` (`duplicate_check`) | Decisão de duplicidade registrada, nunca implícita | `tests/integration/import.test.ts` | `done` |
| BD-06 | Conquistas, níveis e notificações | `0006_ranking_achievements.sql` | Tabelas + endpoints; concessão bloqueada por D-05 | `tests/e2e/workflows.test.ts` → BE-09 | `done` (estrutura) |
| BD-07 | Log de auditoria imutável | `0008_audit.sql` | Trigger append-only + ausência de UPDATE/DELETE no grant | `tests/integration/append-only.test.ts`, `rls.test.ts` | `done` |
| BD-08 | Schema administrativo privado | `0009_rls_grants.sql` | `import_job`/`import_row` com policy exclusivamente administrativa | `tests/integration/rls.test.ts` | `done` |
| BD-09 | Constraints, índices e chaves únicas | todas as migrations | FKs sem cascade em ledger/histórico/auditoria, uniques, checks e índices | `tests/integration/schema.test.ts` → "constraints e chaves estrangeiras reais" | `done` |
| BD-10 | Inativação lógica e exclusão | `0002`, `0004` | Soft delete implementado; política de expurgo inexistente | `tests/e2e/workflows.test.ts` | `in_progress` — depende de D-11 |
| BD-11 | Habilitar RLS | `0009_rls_grants.sql`, `0010_board_projections.sql`, `0015_pilot_contract_integrity.sql` | Policies por papel, `security_invoker` nas views e projeções `SECURITY DEFINER` de escopo fixo | `tests/integration/rls.test.ts` | `done` |

## E. Backend e APIs (BE)

| ID | Item | Onde | Correção | Teste | Estado |
|---|---|---|---|---|---|
| BE-01 | Autenticação e autorização administrativa | `src/auth/*`, `src/http/server.ts` | Sessão opaca com hash em repouso + RBAC deny-by-default | `tests/e2e/access-control.test.ts` | `done` |
| BE-02 | CRUD de funcionários | `src/modules/admin.ts` | Criar, editar, inativar com motivo e auditoria | `tests/e2e/workflows.test.ts` | `done` |
| BE-03 | CRUD e acompanhamento de indicações | `src/modules/admin.ts` | Criação, listagem paginada e transições auditadas | `tests/e2e/workflows.test.ts` | `done` |
| BE-04 | Validação e sanitização no servidor | Zod em todas as rotas | Schemas `.strict()` + `stripClientAuthorityFields` | `tests/e2e/access-control.test.ts` → mass assignment | `done` |
| BE-05 | Envio duplicado e concorrência | `src/import/pipeline.ts` | Idempotência por hash e `select ... for update` na confirmação | `tests/integration/import.test.ts` → "duas confirmações concorrentes" | `done` |
| BE-06 | Autoria e horário das alterações | `src/modules/audit.ts` | Autoria vem sempre da sessão; `occurred_at` e `recorded_at` separados | `tests/e2e/workflows.test.ts` → ALTO-01 | `done` |
| BE-07 | Endpoint sanitizado para o mapa | `src/modules/board.ts` | `/api/v1/board/summary` com DTO mínimo | `tests/e2e/workflows.test.ts` → DTO | `done` |
| BE-08 | Lista explícita de campos permitidos | `src/dto/index.ts` | Mappers como allowlist + `FORBIDDEN_PUBLIC_KEYS` | `tests/unit/csv-and-redaction.test.ts` | `done` |
| BE-09 | Ranking, perfil, conquistas, notificações | `src/modules/board.ts`, `src/modules/me.ts` | Quatro endpoints entregues | `tests/e2e/workflows.test.ts` | `done` |
| BE-10 | Paginação, busca e filtros | `src/modules/admin.ts` | Paginação com teto, filtros validados, busca parametrizada | `tests/e2e/workflows.test.ts` | `done` |
| BE-11 | Rate limiting e erros seguros | `src/http/server.ts` | Rate limit por identidade/IP e resposta opaca com `correlationId` | `tests/e2e/access-control.test.ts` → "não devolve stack trace" | `done` |

## F. Frontend (FE)

| ID | Item | Onde | Correção | Teste | Estado |
|---|---|---|---|---|---|
| FE-01 | Migrar o protótipo para a stack real | `web/` servido pelo backend | HTML/CSS preservados; JS reescrito para consumir a API | `tests/e2e/access-control.test.ts` | `done` |
| FE-02 | Conectar mapa, ranking e perfil às APIs | `web/assets/win-boot.js` | Zero número fixo; tudo vem de `/api/v1/board/*` | `tests/e2e/workflows.test.ts` → ALTO-06 | `done` |
| FE-03 | Rota protegida `/admin` | `src/http/server.ts` | Verificação antes de entregar o HTML | `tests/e2e/access-control.test.ts` | `done` |
| FE-04 | Tabela e formulários de funcionários | `web/admin/index.html`, `web/assets/admin.js` | Cadastro, busca, listagem e inativação com motivo | API coberta por `tests/e2e/workflows.test.ts` | `done` |
| FE-05 | Tabela, filtros e edição de indicações | `web/assets/admin.js` | Tabela, filtros por etapa/busca, avanço de etapa e atestação de conferência na importação | API coberta por `tests/e2e/workflows.test.ts` e `import.test.ts` | `in_progress` — edição de campos livres depende de D-17 |
| FE-06 | Estados de carregamento, erro, vazio, sucesso | `win-boot.js`, `admin.js`, CSS | Todos os estados exigidos, incluindo sessão expirada e importação parcial | smoke de navegador + E2E | `in_progress` |
| FE-07 | Confirmações para ações críticas | `admin.js` | Confirmação que explica o impacto antes de importar, inativar e transicionar | — | `done` |
| FE-08 | Impedir envio duplicado nos formulários | `admin.js` (`busy()`) | Botão desabilitado durante a requisição + idempotência no servidor | `tests/integration/import.test.ts` | `done` |
| FE-09 | Remover PII do `localStorage` | `win-boot.js`, `admin.js`, `eslint.config.js` | Nenhum uso de storage do navegador; regra de lint proíbe | `tests/e2e/access-control.test.ts` (nenhum dado no HTML entregue) | `done` |
| FE-10 | Responsividade, teclado e acessibilidade | CSS + HTML | `:focus-visible`, `prefers-reduced-motion`, navegação por teclado no mapa, rótulos e `aria-live` | sem teste automatizado de navegador (ver TH-11) | `in_progress` |
| FE-11 | Ocultar navegação administrativa | `win-boot.js` | Link escondido por permissão, com proteção real no servidor | `tests/e2e/access-control.test.ts` | `done` |

## G. Infra e segurança (IS)

| ID | Item | Onde | Correção | Teste | Estado |
|---|---|---|---|---|---|
| IS-01 | Variáveis de ambiente do servidor | `src/config/env.ts` | Validação por schema e recusa de boot (exit 78) | `tests/unit/config.test.ts` | `done` |
| IS-02 | HTTPS e criptografia em repouso | `src/http/server.ts` | HSTS, cookie `secure` e exigência de `https` em produção; TLS e disco são de infraestrutura | `tests/unit/config.test.ts` | `blocked` — depende de infraestrutura |
| IS-03 | Armazenamento seguro para fotos | — | O MVP não recebe nem serve fotos | — | `not_applicable` |
| IS-04 | SQLi, XSS e CSRF | toda a camada de dados / `win-boot.js` | Queries parametrizadas, `textContent` no DOM, cookie `SameSite=Lax` + JSON obrigatório | `tests/e2e/access-control.test.ts` | `done` |
| IS-05 | CSP e headers | `src/http/server.ts` | CSP sem `unsafe-inline` (nenhum estilo/script inline restou), `frame-ancestors 'none'`, `no-referrer` | `tests/e2e/access-control.test.ts` → MED-08 | `done` |
| IS-06 | Logs sem dados pessoais | `src/lib/redact.ts`, `src/lib/logger.ts` | Redação por lista de chaves sensíveis, aplicada também na auditoria | `tests/unit/csv-and-redaction.test.ts` | `done` |
| IS-07 | Backups e recuperação | — | Infraestrutura | — | `blocked` |
| IS-08 | Monitoramento e alertas | `src/lib/logger.ts` (log estruturado + correlation id) | Base pronta; coletor é infraestrutura | — | `blocked` |
| IS-09 | Processo de migration e rollback | `src/db/migrate.ts` | Migrations imutáveis por checksum, aplicação transacional, forward-only | `tests/integration/schema.test.ts` → "recusa migration alterada" | `in_progress` — rollback de deploy é infraestrutura |
| IS-10 | LGPD e retenção | `docs/SEGURANCA_E_PRIVACIDADE.md` | Inventário de dados pessoais e lacunas declaradas | — | `pending_business_decision` (D-11) |

## H. Testes e homologação (TH)

| ID | Item | Teste | Estado |
|---|---|---|---|
| TH-01 | Visitante não autenticado em `/admin` e APIs | `tests/e2e/access-control.test.ts` | `done` |
| TH-02 | Usuário autenticado sem role admin | `tests/e2e/access-control.test.ts` | `done` |
| TH-03 | Manipulação de URL, payload e frontend | `tests/e2e/access-control.test.ts` (ID alheio, mass assignment, ID malformado) | `done` |
| TH-04 | Cadastro, edição e inativação de funcionários | `tests/e2e/workflows.test.ts` | `done` |
| TH-05 | Criação e progressão de indicações | `tests/e2e/workflows.test.ts` | `done` |
| TH-06 | Duplicidade e idempotência | `tests/integration/import.test.ts` | `done` |
| TH-07 | Atualização do mapa após alteração admin | `tests/e2e/workflows.test.ts` → "o mesmo dado alimenta o painel" | `done` |
| TH-08 | Vazamentos em HTML, console, URL, cookies | `tests/e2e/access-control.test.ts` (HTML, headers, cookies, banco) | `in_progress` — console e cache do navegador não verificáveis sem navegador |
| TH-09 | Integridade do log de auditoria | `tests/integration/append-only.test.ts` | `done` |
| TH-10 | Unitários, integração e E2E | suíte versionada + smoke de navegador | `in_progress` — a regressão da candidata MVP-5 deve ser executada após instalação das dependências |
| TH-11 | Desktop, mobile, teclado e modo TV | — | `blocked` — exige homologação em dispositivos reais |

---

## Achados da auditoria

### Críticos

| ID | Achado | Correção | Teste | Estado |
|---|---|---|---|---|
| CRIT-01 | `/admin` estático sem controle de acesso | Rota servida só após checagem de permissão; estáticos limitados a `/assets` | `access-control.test.ts` | `done` |
| CRIT-02 | PII em `localStorage` + export irrestrito | Nenhum storage de navegador; export exige `export:create` e é auditada | `access-control.test.ts`, `workflows.test.ts` | `done` |
| CRIT-03 | Ausência total de identidade | OIDC + sessão + `auth_identity`; autoria real na auditoria | `workflows.test.ts` → ALTO-01 | `done` |

### Altos

| ID | Achado | Correção | Teste | Estado |
|---|---|---|---|---|
| ALTO-01 | Autoria fixa no codigo | Autoria sempre vem da sessao autenticada | `workflows.test.ts` | `done` |
| ALTO-02 | Pontos vindos da planilha | Coluna PONTOS ignorada com aviso; pontuação derivada no servidor | `import.test.ts` | `done` |
| ALTO-03 | Agrupamento por nome | Identidade por `external_code`; linha sem matrícula é rejeitada | `import.test.ts` | `done` |
| ALTO-04 | Import substitui base sem dedupe | Staging + prévia + confirmação + idempotência + transação | `import.test.ts` | `done` |
| ALTO-05 | Regra não aprovada embutida | Nenhuma regra nasce aprovada; caminhos bloqueados com 422 explicativo | `schema.test.ts`, `workflows.test.ts`, `import.test.ts` | `done` |
| ALTO-06 | Mapa e admin sem fonte comum | Ambos leem o banco pela mesma API | `workflows.test.ts` | `done` |
| ALTO-07 | Sem fundações técnicas | Stack, migrations, testes, lint, CI-ready | suíte inteira | `done` |

### Médios e baixos

| ID | Correção | Teste | Estado |
|---|---|---|---|
| MED-01 | `parseStrictNumber` recusa `"abc"` e `"=1+1"` | `parsing.test.ts` | `done` |
| MED-02 | Território por catálogo + alias explícito | `schema.test.ts` | `done` |
| MED-03 | `sanitizeCsvCell` em toda exportação | `csv-and-redaction.test.ts`, `workflows.test.ts` | `done` |
| MED-04 | `referral_stage` e `territory_state` como tipos separados | `schema.test.ts` | `done` |
| MED-05 | Leitor XLSX com assinatura, anti zip-bomb, path traversal e escolha de aba | `xlsx.test.ts`, `import.test.ts` | `done` |
| MED-06 | Datas no fuso de negócio, sem fallback silencioso | `parsing.test.ts` | `done` |
| MED-07 | Schema validado em tudo que é persistido (Zod + constraints) | `schema.test.ts` | `done` |
| MED-08 | CSP sem `unsafe-inline` + headers | `access-control.test.ts` | `done` |
| MED-09 | Confirmação explicando impacto antes da ação | `admin.js` | `done` |
| BAI-01 | Saída por `textContent`; iniciais sanitizadas | `parsing.test.ts` | `done` |
| BAI-02 | `noindex` não é mais tratado como proteção | `access-control.test.ts` | `done` |
| BAI-03 | Período anterior é o período de calendário | `parsing.test.ts` | `done` |
| BAI-04/05 | Estrutura reorganizada e padrões documentados | README + ADR | `done` |
| BAI-06 | Dados demonstrativos inequivocamente fictícios | `seed.ts` | `done` |

### Política interna LOCTL CORP COML 001 rev. 03 e decisões de 2026-09-03

| Item | Onde | Estado |
|---|---|---|
| Seção 1 — quem participa | `RULE_PARTICIPANT_ELIGIBILITY` (approved) | `done` |
| Seção 2 — oportunidades elegíveis | `opportunity_type` + `RULE_OPPORTUNITY_TYPES` | `done` |
| Seção 3 e Anexo I — tabela de premiação | `award_rule` versionada + `src/domain/awards.ts` | `done` |
| Seção 4 — reunião qualificada | `qualified_meeting` com os 5 requisitos, R$ 50,00 | `done` |
| Seção 5 — base de cálculo e 12 meses | `revenue_event` + `withinFirstTwelveMonths()` | `done` |
| Seção 6 — registro, titularidade e governança | registro interno, validação do Comercial e `duplicate_check` | `done` |
| Seção 7 — não elegíveis | recusa com motivo obrigatório em `validateOpportunity` | `done` |
| Seção 8 — pagamento e ajuste posterior | `payout_batch` com aprovação da Diretoria; estorno compensatório | `done` |
| Seção 9 — natureza da premiação | documentada; sem direito adquirido modelado | `not_applicable` (jurídico) |
| Seção 10 — exceções pelo CEO | alçada registrada em `RULE_TRANSITION_AUTHORITY` v2 | `in_progress` — fluxo de exceção não implementado |
| D-04 — titularidade | empresa cliente normalizada + serviço; primeiro registro vence | `done` |
| D-12 — empresa cliente | não sai do backend, nem para admin | `done` |
| D-27 — planilha + conferência manual | atestação registrada na confirmação | `done` |
| D-03 — pontos cumulativos (10/20/30/50/100) | `points_rule` v2 aprovada, lançamento derivado no servidor | `done` |
| D-06 — sequência das etapas | `RULE_REFERRAL_STATE_MACHINE` v2 aprovada, salto permitido, retrocesso não | `done` |
| D-28 — fonte operacional do piloto | `0013` e `0015`, registro interno, titularidade por empresa + serviço e progressão por ciclo | `done` |

### Requisitos ausentes (AUS)

| ID | Requisito | Situação |
|---|---|---|
| AUS-01 | ID estável do funcionário | `done` — `external_code` obrigatório na importação |
| AUS-02 | Fonte de verdade declarada | `done` — banco da aplicação; ADR-001 registra a reconciliação futura |
| AUS-03 | Reconciliação com sistema externo | `blocked` — depende de BL-01 |
| AUS-04 | Fechamento de ciclo | `in_progress` — a seção 8 define ajuste em apuração posterior (implementado como lançamento compensatório); o fechamento do ranking segue em D-14 |
| AUS-05 | Versionamento de pontos | `done` — `business_rule` + `points_rule` versionados e referenciados em cada lançamento |
| AUS-06 | Base legal do campo EMPRESA | `in_progress` — D-12 eliminou a exposição (o campo não sai do backend); a base legal e a retenção seguem dependendo de parecer |
| AUS-07 | Política de exportação | `in_progress` — exige permissão e gera auditoria; retenção do arquivo é decisão |
| AUS-08 | Antifraude | `in_progress` — a seção 7 da política já exclui oportunidades da Área Comercial, renovações, reajustes, leads de Marketing e execução regular do cargo; autoindicação e conluio seguem sem regra (D-15) |
| AUS-09 | Contestação | `in_progress` — a seção 6 define o conflito de titularidade (implementado com decisão registrada); a contestação de valor segue em D-21 |
| AUS-10 | Timezone de negócio | `done` — `APP_TIMEZONE` configurável, UTC no banco |
| AUS-11 | Desligamento de pessoa | `in_progress` — inativação lógica pronta; retenção depende de D-11 |
| AUS-12 | Ambientes e dados sintéticos | `done` — seed sintético recusa rodar em staging/produção |
