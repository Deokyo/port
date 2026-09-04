# Segurança e privacidade — Programa WIN

Documento operacional. Descreve **o que está implementado e verificado**, o que depende de
infraestrutura e o que continua sendo lacuna. Não é uma declaração de conformidade: nenhuma
afirmação de adequação integral à LGPD é feita aqui, porque isso exige parecer do responsável
pelo tratamento de dados da Locatelli Group (decisão D-11).

---

## 1. Inventário de dados pessoais

| Dado | Onde vive | Titular | Necessidade | Exposição |
|---|---|---|---|---|
| Nome do funcionário | `staff_member.display_name` | colaborador | identificar o participante no ranking | visível a autenticados |
| Matrícula (`external_code`) | `staff_member` | colaborador | chave estável de identidade (ALTO-03) | apenas admin/validador e o próprio |
| Área / unidade | `staff_member.business_unit` | colaborador | segmentação de relatório | apenas admin/validador |
| E-mail corporativo | `auth_identity.email` | colaborador | vínculo com o provedor OIDC | nunca sai em DTO |
| Subject OIDC | `auth_identity.subject` | colaborador | identidade federada | nunca sai em DTO |
| **Empresa cliente** | `referral.client_company` | **terceiro** | deduplicação e auditoria | **ninguém — não sai do backend (D-12)** |
| Referência interna opcional | `referral.client_reference` | — | reconciliação operacional do piloto | apenas admin |
| Receita líquida recebida | `revenue_event.net_amount` | terceiro (comercial) | base de cálculo da premiação (seção 5) | admin e Diretoria |
| Premiação apurada | `award_ledger.amount` | colaborador | pagamento em folha (seção 8) | o próprio, admin e Diretoria |
| Hash de IP | `audit_event.ip_hash` | colaborador | investigar acesso indevido | apenas admin |
| Hash de user-agent | `auth_session.user_agent_hash` | colaborador | detectar sequestro de sessão | ninguém (uso interno) |
| Linha bruta da planilha | `import_row.raw` | colaborador + terceiro | permitir correção e reprocessamento | apenas admin (RLS) |

**D-12 decidida em 2026-09-03 — a mais restritiva possível.** `client_company` é dado de
**terceiro**, não do colaborador. A decisão registrada é que o campo **não sai do backend**:
nenhuma resposta de API, DTO, tela ou exportação carrega o nome da empresa cliente — nem para o
administrador. Ele permanece no banco apenas para deduplicação e auditoria. Quando necessário,
a identificação operacional exposta ao administrador usa `client_reference`, um código interno
opcional (`RULE_CLIENT_COMPANY_VISIBILITY` v3).

Há teste automatizado que falha se o nome de qualquer empresa aparecer numa resposta ou numa
exportação. Isso reduz — mas não elimina — a exposição: a base legal e o tempo de retenção do
campo continuam dependendo de parecer (AUS-06).

**Dinheiro.** A premiação da política é valor devido a pessoa física, pago em folha. O ledger
monetário é append-only e o pagamento tem portão próprio: só a Diretoria aprova o lote (seção 8).
Quem registra a receita não escolhe o valor — ele é derivado da tabela do Anexo I na versão
aprovada e vigente.

**Dados que o sistema deliberadamente não coleta:** CPF, telefone, endereço, foto. O protótipo
previa foto de perfil; ela foi removida do MVP. Se voltar, IS-03 reabre.

---

## 2. Identidade e sessão

- Autenticação por **OIDC** (Authorization Code + PKCE), com verificação de assinatura do
  `id_token` contra o JWKS do provedor (`src/auth/oidc.ts`).
- **Não existe** senha padrão, e-mail de administrador embutido nem endpoint público de bootstrap.
- O provedor corporativo ainda não foi informado (D-01). Enquanto `OIDC_ISSUER` estiver vazio,
  o login responde **503** e `/admin` permanece inacessível. Isso é intencional.
- Sessão opaca de 32 bytes aleatórios. O banco guarda **apenas o SHA-256** do token
  (`auth_session.token_hash`) — um dump do banco não permite personificar ninguém.
- Cookie `HttpOnly`, `SameSite=Lax`, `Secure` em ambientes produtivos, `Path=/`.
- Expiração absoluta (`SESSION_TTL_MINUTES`) **e** por inatividade (`SESSION_IDLE_TIMEOUT_MINUTES`),
  ambas verificadas no servidor a cada requisição.
- Logout revoga a sessão no banco; o cookie sozinho não vale mais nada.

### Autenticação simulada
A rota `/api/v1/auth/test-login` só é **registrada** quando `NODE_ENV=test` **e**
`AUTH_TEST_MODE=true`. Além disso, `src/config/env.ts` **recusa a inicialização** da aplicação
(exit 78) se `AUTH_TEST_MODE` estiver ligado fora de `test`. São duas travas independentes.

---

## 3. Autorização

Três camadas, todas no servidor:

1. **Rota** — `requirePermission()` nega por padrão. `tests/integration/route-policy.test.ts`
   falha se qualquer rota for registrada sem declarar política.
2. **Objeto e campo** — DTOs são allowlist (`src/dto/index.ts`); `stripClientAuthorityFields()`
   descarta `roles`, `staffId`, `points`, `createdBy` e afins vindos do cliente (anti mass assignment).
3. **Linha (RLS)** — o backend conecta com a role `win_app`, que **não é owner** das tabelas.
   as policies restringem o que cada ator enxerga; o participante só alcança as próprias linhas
   mesmo com SQL direto.

Papéis enviados pelo cliente são **sempre ignorados**: a fonte é a sessão no servidor.

### Separação de atos
A política distribui alçadas e o RBAC as espelha, com a RLS reforçando no banco:

| Ato | Quem | Base |
|---|---|---|
| Validar elegibilidade e reunião qualificada | Área Comercial (`validador_comercial`) | seções 4 e 6 |
| Registrar receita líquida recebida | administrativo/financeiro | seção 5 — ato financeiro |
| Aprovar o lote de pagamento | Diretoria | seção 8 |
| Decidir conflito de titularidade | Diretoria + Comercial | seção 6 |
| Conceder exceção | CEO / Managing Partner | seção 10 |

Uma correção de RLS foi necessária aqui e está registrada na migration `0012`: a policy original
impedia a Área Comercial de gerar o lançamento de R$ 50,00 que a própria validação dela cria.
Migrations aplicadas são imutáveis, então a correção veio em arquivo novo.

### Conferência manual (D-27)
No estágio atual os dados entram por planilha e **a conferência é humana**. O sistema não finge
validar o que não pode: quem confirma a importação **atesta** a conferência, e o ato fica gravado
com identidade de sessão, data e o número exato de linhas cobertas. O registro no próprio
Programa WIN fornece o rastro operacional do piloto; a validação comercial continua obrigatória.

### Projeções agregadas
O WIN Board precisa mostrar números do programa inteiro, mas a RLS (corretamente) limita o
participante às próprias linhas. Em vez de afrouxar a policy ou consultar como owner, a migration
`0010_board_projections.sql` cria funções `SECURITY DEFINER` com **SQL fixo**: o que pode
atravessar a RLS é exatamente esse conjunto de agregados, revisável em code review. Nenhuma delas
devolve empresa cliente, contato ou observação interna, e `board_assert_scope()` impede pedir o
recorte de outra pessoa.

---

## 4. Privilégio mínimo no banco

- `win_app` recebe `SELECT/INSERT/UPDATE/DELETE` apenas onde faz sentido.
- Tabelas append-only (`points_ledger`, `audit_event`, `referral_stage_event`,
  `ranking_snapshot`, `achievement_grant`) recebem **somente `SELECT` e `INSERT`**. Não há UPDATE
  nem DELETE nem no nível de privilégio, além do trigger que os bloqueia. Defesa dupla.
- A view `points_balance` usa `security_invoker = true` — sem isso, ela rodaria com os
  privilégios do owner e furaria a RLS.
- Correção de pontos acontece por **lançamento compensatório** com motivo obrigatório. Histórico
  nunca é reescrito.

---

## 5. Entrada e saída

- **SQLi:** todas as consultas são parametrizadas. Nenhuma concatenação de string com valor de
  usuário em nenhum ponto do repositório.
- **XSS:** o frontend escreve dados da API exclusivamente por `textContent` / `createElement`.
  Não há renderização de conteúdo da API por `innerHTML` em `win-boot.js` ou `admin.js`.
- **CSP:** `default-src 'self'`, sem `unsafe-inline`. Foi por isso que o `<style>` inline do
  protótipo migrou para os arquivos CSS. Também `object-src 'none'`, `base-uri 'none'`,
  `frame-ancestors 'none'`, `referrer-policy: no-referrer`.
- **CSRF:** cookie `SameSite=Lax` + APIs mutantes que só aceitam JSON ou multipart, nunca
  `application/x-www-form-urlencoded` de origem cruzada.
- **CSV injection (MED-03):** toda célula exportada passa por `sanitizeCsvCell()`, que prefixa
  apóstrofo em qualquer valor iniciado por `=`, `+`, `-`, `@`, tab ou CR.
- **Upload:** extensão, MIME e **assinatura real** verificados; limite de bytes comprimidos e
  descomprimidos (anti zip-bomb); nomes com `..` ou `/` rejeitados; a planilha com várias abas
  exige escolha explícita em vez de chutar a primeira.
- **Rate limiting:** por identidade autenticada ou IP.
- **Erros:** resposta opaca com `correlationId`; stack trace nunca sai para o cliente.

---

## 6. Logs e auditoria

- Log estruturado em JSON, em `stderr`, com redação por lista de chaves sensíveis
  (`src/lib/redact.ts`): nome, e-mail, empresa, CPF/CNPJ, tokens, cookies, buffers e o payload
  bruto da planilha nunca são impressos.
- `audit_event` grava autoria real da sessão, papéis, ação, recurso, resultado, motivo da negação,
  `correlation_id` e **hash** do IP. O `metadata` também passa por redação antes de ser gravado.
- Negações de acesso (401/403) viram evento de auditoria — inclusive as anônimas.
- A trilha é append-only por trigger e por privilégio.

---

## 7. Ambientes

| | development | test | staging | production |
|---|---|---|---|---|
| Banco | PGlite embarcado | PGlite em memória | PostgreSQL (`pg`) | PostgreSQL (`pg`) |
| Migrations | automáticas no boot | automáticas | passo explícito de deploy | passo explícito de deploy |
| Seed sintético | permitido | permitido | **recusado** | **recusado** |
| Login de teste | indisponível | disponível | **impossível** | **impossível** |
| HSTS / cookie secure | não | não | sim | sim |

A aplicação **recusa iniciar** (exit 78) em staging/produção sem `DATABASE_URL`, sem
`SESSION_SECRET` forte, sem `https` na `APP_BASE_URL` ou sem OIDC configurado.

---

## 8. Dados de demonstração

Todos os dados do seed são sintéticos e inequivocamente fictícios: "Ana Exemplo",
"Bruno Fictício", "Empresa Alfa (fictícia)". A autoria fixa foi removida: eventos usam a
identidade da sessão. O gerador é determinístico (seed fixa), então a base é reproduzível.

---

## 9. Lacunas declaradas

| # | Lacuna | Responsável | Bloqueia |
|---|---|---|---|
| 1 | Provedor OIDC não informado | TI / Segurança | login real, `/admin` em uso, MFA (AP-04) |
| 2 | Base legal e retenção de `client_company` (a exposição já foi eliminada por D-12) | Privacidade / Jurídico | AUS-06 |
| 3 | Política de retenção e expurgo | Privacidade | D-11, IS-10, BD-10 |
| 4 | TLS, criptografia em repouso, backup, monitoramento | Infraestrutura | IS-02, IS-07, IS-08 |
| 5 | Regras antifraude | Negócio | D-15 |
| 6 | Processo de contestação de pontuação | Negócio / RH | D-21 |
| 7 | Homologação em navegador real (teclado, TV, mobile) | QA | TH-11, FE-10 |
| 8 | Valor dos pontos por etapa (o escopo dos pontos já está confirmado) | Negócio | D-03 |
| 9 | Retenção da receita e do valor pago após a apuração | Privacidade / Financeiro | seção 5 |

Nenhuma dessas lacunas foi contornada com suposição no código. Onde a decisão falta, o caminho
está tecnicamente pronto e **desligado**.
