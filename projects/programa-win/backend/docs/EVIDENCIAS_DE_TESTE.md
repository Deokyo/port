# Evidencias da candidata MVP-6

**Artefato:** Programa WIN 0.3.0, restauracao visual e correcao de assets de 04/09/2026

**Dados usados:** exclusivamente sinteticos

**Decisao de QA:** `BLOCKED` para homologacao ate executar a regressao com dependencias instaladas

Este registro nao reaproveita a afirmacao de que a versao anterior tinha passado. A MVP-6 altera
autenticacao local, entrega de assets, launcher e as duas interfaces; portanto, precisa de
regressao propria.

## Defeito reproduzido no Windows antes desta candidata

- o servidor 0.2.2 iniciou e `/healthz` respondeu `{"status":"ok"}` em `127.0.0.1`;
- `/` entregou o HTML, mas CSS, JavaScript e logo nao foram aplicados;
- causa confirmada por codigo e contrato da dependencia: `@fastify/static` 8 passa um
  `FastifyReply` ao callback `setHeaders`; a versao 0.2.1 havia trocado incorretamente
  `reply.header` por `response.setHeader`, causando a falha conjunta dos assets;
- `localhost` tambem divergia do host IPv4 em que o servidor local estava escutando.

## Verificacoes executadas nesta candidata

- sintaxe dos JavaScript do board, admin e smoke de navegador com `node --check`;
- sintaxe dos arquivos TypeScript alterados com o parser nativo do Node em modo strip-types;
- sintaxe do launcher Linux com `bash -n`;
- integridade de whitespace com `git diff --check`;
- 15 migrations SQL presentes e ordenadas, incluindo `0015_pilot_contract_integrity.sql`;
- `package-lock.json` regenerado e coerente com `package.json` em modo offline;
- XLSX oficial importado, inspecionado e renderizado nas quatro abas;
- varredura do XLSX sem erros de formula conhecidos;
- validacoes, formulas, tabela, listas controladas e cabeçalho de 10 colunas preservados;
- assets ativos do board/admin sem nomes reais, dados fixos do prototipo ou dependencia externa;
- assets publicos sem resolucao de sessao, com `FastifyReply.header`, cache local desativado,
  URLs versionadas e transacoes PGlite serializadas;
- regressao preparada para login seguido de assets e APIs concorrentes;
- launcher seleciona a primeira porta livre entre 3000 e 3010;
- launcher usa `127.0.0.1` de ponta a ponta, abre a tela de acesso e aguarda healthcheck, CSS,
  JavaScript e logo antes de abrir o navegador;
- mapa de quatro territorios com navegacao global, territorio e servico, breadcrumbs, busca,
  tooltip, teclado e painel contextual alimentado pela API;
- login visual, ranking, conquistas, perfil e notificacoes com estados reais ou pendentes;
- auditoria estatica de UX do board e admin sem achados criticos, altos ou medios;
- verificacao de sintaxe e integridade do ZIP final, registrada no empacotamento.

## Regressao automatizada preparada

A suite versionada cobre:

- banco criado do zero, checksum de migration, constraints, RLS e append-only;
- acesso anonimo, escalonamento de privilegio, sessao e DTOs minimos;
- XLSX com namespace arbitrario, selecao de aba e arquivo oficial real;
- staging, previa, atestacao obrigatoria, idempotencia, progressao e conflitos;
- pontos derivados no servidor e bloqueio de ajuste manual sem regra aprovada;
- reuniao qualificada, percentuais, janela recorrente e validacao comercial;
- estorno integral e parcial, repeticao idempotente e teto por recebimento;
- pre-requisitos contratuais e ordem temporal antes da premiacao percentual;
- lote por competencia, lote vazio/negativo e aprovacao da Diretoria;
- separacao entre atestacao da planilha e validacao comercial de elegibilidade;
- duplicata do staging promovida a conflito de titularidade auditavel;
- contrato visual, estados vazios/pendentes e ausencia de conteudo demonstrativo;
- tela de acesso local antes da sessao e logout de volta para a entrada;
- entrega HTTP real de CSS, JavaScript e logo, incluindo MIME e corpo nao vazio;
- navegacao por teclado do mapa ate territorio e clique ate servico;
- smoke real das quatro telas do WIN Board e do painel administrativo em desktop e mobile,
  por Chrome DevTools Protocol.

## Bloqueio deste ambiente

O proxy desta maquina devolveu HTTP 403 ao registro npm, impedindo baixar as dependencias do
projeto. Nao foi possivel executar aqui `tsc`, ESLint, Vitest, PGlite nem o smoke em Chrome.
Tambem nao ha Chrome/Chromium instalado neste ambiente. Leitura de codigo e checagem sintatica
nao substituem esses testes; por isso esta candidata nao esta aprovada para homologacao ou
producao.

## Reproducao obrigatoria

Em uma maquina com Node.js 20.11+ e acesso ao npm:

```bash
npm ci
npm run db:reset
npm run db:migrate
npm run db:seed
npm run typecheck
npm run lint
npm test
npm run test:browser
```

Para o smoke, instale Chrome/Chromium ou informe `CHROME_BIN`. Vincule o resultado ao hash do ZIP
ou ao commit exato; qualquer alteracao posterior invalida a cobertura afetada.

## Gates externos restantes

- OIDC real e contas sinteticas por papel;
- PostgreSQL do ambiente de homologacao;
- backup e restore;
- acessibilidade assistiva e revisao manual em navegadores alvo;
- observabilidade e rollback;
- autorizacao explicita para publicar.
