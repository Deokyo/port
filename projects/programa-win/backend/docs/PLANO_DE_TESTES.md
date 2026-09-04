# Plano de testes — Programa WIN

Cada teste existe para provar um requisito do checklist ou fechar um achado da auditoria. Testes
sem rastreabilidade não entram na suíte.

## Como executar

```bash
npm ci
npm run typecheck     # tsc --noEmit
npm run lint          # eslint src tests
npm test              # toda a suíte
npm run test:unit
npm run test:integration
npm run test:e2e
```

Nenhum serviço externo é necessário. Cada arquivo de teste sobe um **PostgreSQL embarcado em
memória** (PGlite), aplica as 15 migrations e roda os seeds — o mesmo SQL que rodaria num servidor.
Isso significa que constraints, triggers, RLS e transações são exercitados de verdade, não com
mock.

## Fixtures e o que elas deliberadamente não fazem

`tests/helpers/app.ts` oferece:

- `createTestContext()` — banco limpo + migrations + seed + servidor Fastify pronto.
- `login()` / `asAdmin()` / `asValidator()` / `asParticipant()` — sessão pela rota de teste, que
  só existe com `NODE_ENV=test` **e** `AUTH_TEST_MODE=true`.
- `approveRule(db, key)` — **aprova uma regra apenas dentro do teste**, registrando
  "Aprovador Sintético (fixture de teste)" como aprovador.
- `buildCsv()` / `multipart()` — planilhas e uploads em memória.

`approveRule` é o mecanismo que permite exercitar os caminhos bloqueados por decisão de negócio
(confirmação de importação, transições, lançamento de pontos) **sem** que o sistema entregue
qualquer regra aprovada por padrão. O teste `schema.test.ts` verifica exatamente isso: o seed
padrão não entrega nenhuma regra aprovada nem lançamento no ledger.

---

## 1. Unitários — `tests/unit/`

| Arquivo | Cobre | Requisito |
|---|---|---|
| `parsing.test.ts` | parser numérico estrito (`"abc"` e `"=1+1"` recusados), datas no fuso de negócio, serial do Excel, período de calendário anterior, normalização e iniciais | MED-01, MED-06, BAI-01, BAI-03, AUS-10 |
| `csv-and-redaction.test.ts` | neutralização de fórmula em toda célula, leitura de CSV com aspas/BOM, redação de PII e credenciais no log, DTO do board sem chave proibida | MED-03, IS-06, BE-08 |
| `config.test.ts` | recusa de boot em produção sem `DATABASE_URL`, segredo forte, `https` e OIDC; recusa de `AUTH_TEST_MODE` fora de `test`; recusa de bootstrap sem provedor; timezone inválido | IS-01, AP-03, Fase 1 |
| `xlsx.test.ts` | rejeição por assinatura e por estrutura interna inválida | MED-05 |

## 2. Integração — `tests/integration/`

| Arquivo | Cobre | Requisito |
|---|---|---|
| `schema.test.ts` | banco criado do zero, segunda execução idempotente, todas as tabelas do modelo, recusa de migration alterada, FKs e constraints reais, impossibilidade de marcar regra aprovada sem aprovador, seed sem regra aprovada nem ponto, catálogo como dado | BD-01..09, IS-09, ALTO-05, MED-02 |
| `append-only.test.ts` | UPDATE e DELETE bloqueados em lançamento **real** do ledger, correção por lançamento compensatório, correção sem motivo recusada, idempotência, auditoria e histórico de etapas também imutáveis | BD-04, BD-07, TH-09 |
| `rls.test.ts` | participante só enxerga as próprias indicações, resistência a consulta endereçando linha alheia, auditoria fechada ao participante, importação exclusivamente administrativa, impossibilidade de apagar histórico com SQL direto, view respeitando `security_invoker` | BD-08, BD-11, AP-06 |
| `import.test.ts` | staging sem aplicar nada, coluna PONTOS ignorada, idempotência por conteúdo, erro por linha sem vazar dado, cabeçalho incompleto, extensão incompatível com conteúdo, confirmação bloqueada sem regra, consolidação transacional com e sem pontuação aprovada, dupla confirmação, **duas confirmações concorrentes**, duplicidade dentro do arquivo | ALTO-02, ALTO-04, ALTO-05, BE-05, TH-06 |
| `awards.test.ts` | tabela do Anexo I aplicada sobre receita líquida recebida, reunião qualificada com e sem requisitos, teto de 12 meses no recorrente, estorno compensatório, idempotência da receita, append-only do ledger monetário e portão de aprovação da Diretoria | Política seções 4, 5, 6, 8 e Anexo I |
| `route-policy.test.ts` | nenhuma rota sem política declarada, toda permissão existe no catálogo, rotas públicas são exatamente as esperadas, nenhuma rota administrativa depende de permissão do participante | AP-02, AP-08, Fase 4 |

`route-policy.test.ts` já pegou um erro real de desenho nesta base: uma rota administrativa de
apuração exigia a mesma permissão que o participante possui. O desenho foi corrigido, não o teste.

`route-policy.test.ts` é o teste que impede regressão silenciosa: se alguém registrar uma rota
nova sem declarar política, a suíte quebra.

## 3. E2E (HTTP ponta a ponta) — `tests/e2e/`

Sobem a aplicação inteira e falam com ela por HTTP, exatamente como o navegador faria.

| Arquivo | Cobre | Requisito |
|---|---|---|
| `access-control.test.ts` | visitante anônimo em `/admin` (401 sem vazar HTML), autenticado sem papel (403), identidade sem papel algum, administrador com acesso, painel inacessível por outro caminho estático, negação virando auditoria, participante barrado em rotas administrativas, participante tentando ID alheio, mass assignment ignorado, ID malformado → 422, sessão revogada, cookie `HttpOnly` e token só em hash no banco, CSP e cache, healthcheck sem informação sensível, erro sem stack trace | CRIT-01, CRIT-02, AP-06, AP-09, MED-08, TH-01, TH-02, TH-03, TH-08 |
| `workflows.test.ts` | board com números derivados do banco, placar zerado com motivo declarado, DTO sem empresa cliente nem ID interno, mesma fonte alimentando o painel, CRUD de funcionário e indicação, transição recusada sem regra aprovada, transição válida e inválida com a regra aprovada, repetição sem duplicar evento, alçada por papel, autoria de sessão, inativação com motivo preservando histórico, importação com prévia e sem aplicação, reenvio idempotente, participante barrado no upload, exportação neutralizada, auditoria com autor, conquistas bloqueadas por decisão | ALTO-01, ALTO-05, ALTO-06, BE-02, BE-03, BE-09, TH-04, TH-05, TH-07, MED-03 |

## 4. Segurança e privacidade — o que é inspecionado

| Superfície | Como é verificado | Onde |
|---|---|---|
| HTML entregue | corpo da resposta de `/admin/` para anônimo não contém marcação do painel | `access-control.test.ts` |
| Respostas de API | `FORBIDDEN_PUBLIC_KEYS` ausentes no DTO do board | `csv-and-redaction.test.ts`, `workflows.test.ts` |
| Headers | CSP sem `unsafe-inline`, `cache-control: no-store` em rota privada | `access-control.test.ts` |
| Cookies | `HttpOnly` presente; token em claro ausente do banco | `access-control.test.ts` |
| Storage do navegador | ausência de código: nenhum uso de `localStorage`/`sessionStorage`, com regra de lint que proíbe | `eslint.config.js` |
| Logs | redação por lista de chaves sensíveis | `csv-and-redaction.test.ts` |
| Exportação | fórmula neutralizada no CSV real gerado pela API | `workflows.test.ts` |
| Evidências | nenhum dado pessoal real: toda a base é sintética e fictícia | `seed.ts` |

## 5. Limitações declaradas do plano

1. **E2E de navegador não é executável neste ambiente.** O download do runtime do Playwright
   depende de host não liberado na rede da máquina de build. Os testes E2E aqui são HTTP ponta a
   ponta contra a aplicação real — cobrem servidor, banco, autorização e contratos, mas **não**
   cobrem renderização, foco visível, leitor de tela, zoom, reflow e modo TV. TH-11 e FE-10
   permanecem abertos e exigem homologação manual ou uma máquina com acesso ao download.
2. **OIDC não é verificável sem provedor.** O cliente está implementado e tipado, mas o fluxo real
   (discovery, troca de código, verificação de JWKS) não pode ser testado ponta a ponta até que
   D-01 seja respondido. Só a recusa de configuração está testada.
3. **RLS validada no PostgreSQL embarcado (PGlite 0.5.8 / PostgreSQL 18.3).** É o mesmo motor,
   mas a homologação deve repetir a suíte de integração contra o servidor PostgreSQL real da
   Locatelli antes do go-live.
4. **Concorrência testada em duas confirmações simultâneas** dentro do mesmo processo. Carga
   real e concorrência distribuída não foram exercitadas.
5. **A conferência é humana.** O sistema não valida se a planilha está correta: ele registra
   quem atestou a conferência, quando e sobre quais linhas. Erro de conferência é erro de
   processo, e a trilha serve para reconstituí-lo — não para evitá-lo.

## 6. Critério de pronto para homologação

Um item só é considerado pronto com evidência executada. O estado atual de cada um está em
`docs/MATRIZ_RASTREABILIDADE.md`, e o resultado da última execução em
`docs/EVIDENCIAS_DE_TESTE.md`.
