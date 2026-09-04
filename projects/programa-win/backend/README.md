# Programa WIN

Aplicacao unica do Programa WIN: WIN Board, painel administrativo, importacao por planilha,
PostgreSQL embarcado para uso local e APIs Fastify em TypeScript.

English version: [README in English](#english)

## Executar no Windows

Requisito: **Node.js 20.11 ou superior**.

1. Extraia o ZIP inteiro.
2. Abra a pasta `programa-win`.
3. Execute `INICIAR-WIN.bat`.

Na primeira vez, o arquivo instala as dependencias, cria `.pgdata`, aplica as migrations,
carrega dados sinteticos e abre o navegador em `http://localhost:3000`. O acesso local usa
uma sessao de teste limitada ao proprio computador; nao e login de producao.

Se a porta 3000 estiver ocupada, o iniciador escolhe automaticamente a primeira porta livre
ate 3010 e abre o navegador em `127.0.0.1`, no endereco correto. A tela de acesso local aparece
antes do WIN Board; a sessao sintetica so e criada quando o usuario escolhe entrar.

## Executar no Linux ou macOS

```bash
chmod +x iniciar-win.sh
./iniciar-win.sh
```

## Planilha oficial

Baixe o modelo diretamente em **Admin > Importar dados > Baixar modelo oficial XLSX**.
A aba importada automaticamente e `IMPORTAR_ADMIN`.

Colunas obrigatorias:

- `MATRICULA`, `EMPRESA`, `PRODUTO`, `STATUS`, `DATA`.

Colunas opcionais:

- `NOME`, `TIPO`, `GESTOR`, `REFERENCIA`.
- `PONTOS` e uma previa visual; o servidor sempre recalcula.

Fluxo: upload, validacao, previa, atestacao de conferencia e confirmacao. Linhas invalidas
nao sao consolidadas. A atestacao nao substitui a validacao comercial exigida para premiacao.
No piloto, o registro auditavel acontece no proprio Programa WIN.

## Estado do MVP

Implementado:

- WIN Board e painel administrativo alimentados pela mesma API;
- quatro territorios aprovados: Performance, Governanca, Expansao e Pessoas;
- importacao XLSX/CSV com selecao segura de aba, staging, idempotencia e auditoria;
- pontuacao versionada, quando houver aprovador configurado;
- premiacao por reuniao e por receita recebida;
- percentual liberado somente apos registrar faturamento, assinatura e inicio da prestacao;
- estornos parciais vinculados ao recebimento original, sem saldo invertido;
- lotes por janela de competencia e aprovacao exclusiva da Diretoria;
- RBAC, RLS, sessao opaca, CSP e DTOs com minimizacao de dados;
- acesso local guiado e banco PGlite persistente sem servidor externo.

Pendente por decisao ou integracao externa:

- provedor corporativo OIDC e bootstrap do primeiro administrador;
- regra de conquista e manutencao de territorio;
- ciclo e desempate do ranking oficial;
- percentual de rateio para premiacao compartilhada;
- retencao, expurgo e controles operacionais de producao.

Essas funcoes permanecem bloqueadas. O sistema nao inventa percentuais, thresholds ou alçadas.

## Comandos tecnicos

```bash
npm ci
npm run db:migrate
npm run db:seed
npm start
```

Validacao completa:

```bash
npm run typecheck
npm run lint
npm test
npm run test:browser
```

O smoke de navegador procura Chrome, Chromium ou `CHROME_BIN` e grava evidencias em
`artifacts/browser-smoke/`.

Estrutura principal:

```text
db/migrations/   schema e integridade
src/domain/      regras, pontos e premiacao
src/import/      parser XLSX/CSV e pipeline
src/modules/     APIs e autorizacao
web/             WIN Board e painel administrativo
tests/           unitarios, integracao e E2E
docs/            decisoes, seguranca e rastreabilidade
```

## English

The Programa WIN is a single TypeScript application containing the WIN Board, the admin
console, spreadsheet imports, Fastify APIs, and an embedded PostgreSQL-compatible PGlite
database for local evaluation.

### Run on Windows

Install **Node.js 20.11 or newer**, extract the complete ZIP, open the `programa-win` folder,
and run `INICIAR-WIN.bat`. On first launch it installs dependencies, creates the local database,
runs migrations and seeds synthetic data, then opens `http://localhost:3000` with a loopback-only
test session. This local session is not a production authentication mechanism. If port 3000
is already in use, the launcher automatically selects the first available port through 3010. It
opens `127.0.0.1` and shows the local access screen before creating the synthetic session.

On Linux or macOS, run:

```bash
chmod +x iniciar-win.sh
./iniciar-win.sh
```

### Official spreadsheet

Download it from **Admin > Importar dados > Baixar modelo oficial XLSX**. Required columns are
`MATRICULA`, `EMPRESA`, `PRODUTO`, `STATUS`, and `DATA`. `NOME`, `TIPO`, `GESTOR`, and
`REFERENCIA` are optional. `PONTOS` is only a preview; the server recalculates points.

The import flow is upload, validation, preview, conference attestation, and confirmation.
Invalid rows are never consolidated. Attestation does not replace commercial eligibility
validation. The pilot uses Programa WIN itself as its auditable system of record.

### Current boundaries

The local application, import pipeline, award ledger, partial reversals, payout competence,
authorization controls, and integrated interfaces are implemented. Corporate OIDC, territory
thresholds, official ranking rules, shared-award percentages, retention, and production
operations still require approved decisions or external configuration and remain disabled.

Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run test:browser` before promoting
an exact artifact to a homologation environment.
